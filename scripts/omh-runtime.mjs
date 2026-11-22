#!/usr/bin/env node
/** OMH runtime CLI: persistent tasks, workflows, memory, skills and audit. */
import {resolve,join} from 'node:path';
import {TaskQueue} from '../modules/task-queue.mjs';
import {makeHandlers} from '../modules/queue-handlers.mjs';
import {MemoryStore} from '../modules/memory.mjs';
import {WorkflowRunner} from '../modules/workflows.mjs';
import {Scheduler} from '../modules/scheduler.mjs';
import {TraceJournal} from '../modules/trace-journal.mjs';
import {publishSkill} from '../modules/skill-studio.mjs';
const [action,raw='{}']=process.argv.slice(2);
const workspace=resolve(process.env.OMH_WORKSPACE||process.cwd());
const state=resolve(process.env.OMH_STATE_DIR||join(workspace,'.omh'));
const handlers=makeHandlers(workspace);
const queue=await new TaskQueue(join(state,'tasks.json'),handlers).load();
const memory=await new MemoryStore(join(state,'memory.json')).load();
const scheduler=await new Scheduler(join(state,'schedules.json'),queue).load();
const trace=new TraceJournal(join(state,'audit.jsonl'),{enabled:process.env.OMH_TRACE==='1'});
try {
 const data=JSON.parse(raw);
 let result;
 switch(action){
  case 'status':result={workspace,state,handlers:Object.keys(handlers),queued:queue.list().filter(t=>t.status==='queued').length,scheduled:scheduler.list().length,traceEnabled:trace.enabled};break;
  case 'task:add':result=await queue.enqueue(data.kind,data.input);await trace.record('task.queued',{id:result.id,kind:result.kind});break;
  case 'task:run':await trace.record('task.started',{});result=await queue.runNext();await trace.record('task.finished',{id:result?.id,status:result?.status,error:result?.error});break;
  case 'task:list':result=queue.list();break;
  case 'workflow:run':await trace.record('workflow.started',{name:data.name});result=await new WorkflowRunner(queue).executeSequential(data);await trace.record('workflow.finished',{name:data.name,statuses:result.results.map(x=>x.status)});break;
  case 'memory:add':result=await memory.add(data);await trace.record('memory.updated',{id:result.id});break;
  case 'memory:list':result=memory.list(data);break;
  case 'memory:search':result=memory.search(data.query,data);break;
  case 'memory:remove':result={removed:await memory.remove(data.id)};break;
  case 'skill:publish':result=await publishSkill({...data,root:join(workspace,'skills')});await trace.record('skill.published',{name:result.name});break;
  case 'schedule:add':result=await scheduler.add(data);break;
  case 'schedule:tick':result=await scheduler.tick();break;
  case 'schedule:list':result=scheduler.list();break;
  case 'trace:list':result=await trace.read(data);break;
  default:throw new Error('Usage: node scripts/omh-runtime.mjs status | task:add | task:run | task:list | workflow:run | memory:add | memory:list | memory:search | memory:remove | skill:publish | schedule:add | schedule:tick | schedule:list | trace:list [JSON]');
 }
 process.stdout.write(JSON.stringify(result,null,2)+'\n');
} catch(error){process.stderr.write('OMH: '+error.message+'\n');process.exitCode=1;}
