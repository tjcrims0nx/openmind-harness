#!/usr/bin/env node
/** Single-worker OMH daemon. Run under systemd/launchd/supervisor to keep alive. */
import {open,mkdir,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {TaskQueue} from '../modules/task-queue.mjs';
import {makeHandlers} from '../modules/queue-handlers.mjs';
import {Scheduler} from '../modules/scheduler.mjs';
import {TraceJournal} from '../modules/trace-journal.mjs';
const workspace=resolve(process.env.OMH_WORKSPACE||process.cwd());
const state=resolve(process.env.OMH_STATE_DIR||join(workspace,'.omh'));
const tickMs=Number(process.env.OMH_TICK_MS||5000);
if(!Number.isInteger(tickMs)||tickMs<1000||tickMs>60000)throw Error('OMH_TICK_MS must be 1000..60000');
await mkdir(state,{recursive:true});
const lock=join(state,'daemon.lock');
let handle;
try{handle=await open(lock,'wx',0o600);await handle.writeFile(JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}));}
catch(e){throw new Error('OMH daemon already locked; verify no live worker before removing daemon.lock: '+e.message);}
let running=true;
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{running=false;});
const trace=new TraceJournal(join(state,'audit.jsonl'),{enabled:process.env.OMH_TRACE==='1'});
try{
 const queue=await new TaskQueue(join(state,'tasks.json'),makeHandlers(workspace)).load();
 const scheduler=await new Scheduler(join(state,'schedules.json'),queue).load();
 while(running){
  try{
   await scheduler.tick();
   const task=await queue.runNext();
   if(task)await trace.record('task.finished',{id:task.id,kind:task.kind,status:task.status,error:task.error});
  }catch(e){process.stderr.write('OMH daemon: '+e.message+'\n');}
  if(running)await delay(tickMs);
 }
}finally{await handle.close();await rm(lock,{force:true});}
