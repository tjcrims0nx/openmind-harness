#!/usr/bin/env node
/** OMH read-mostly MCP bridge. Never exposes execution or approval flags to a model. */
import {createInterface} from 'node:readline';
import {resolve,join} from 'node:path';
import {TaskQueue} from '../modules/task-queue.mjs';
import {makeHandlers} from '../modules/queue-handlers.mjs';
import {MemoryStore} from '../modules/memory.mjs';
import {TraceJournal} from '../modules/trace-journal.mjs';
import {SkillProposalStore} from '../modules/skill-proposals.mjs';
import {AgentBus} from '../modules/agent-bus.mjs';
const workspace=resolve(process.env.OMH_WORKSPACE||process.cwd());
const state=resolve(process.env.OMH_STATE_DIR||join(workspace,'.omh'));
const spec=(name,description,properties,required=[])=>({name,description,inputSchema:{type:'object',properties,required,additionalProperties:false}});
const str={type:'string'};
const TOOLS=[
 spec('omh_status','Read OMH task status.',{}),
 spec('omh_memory_search','Search approved, scoped OMH memory.',{query:str,scope:str},['query']),
 spec('omh_task_list','List queued OMH tasks and their statuses.',{}),
 spec('omh_queue_read','Queue a read-only workspace inspection task. A trusted worker processes it.',{path:str},['path']),
 spec('omh_trace_recent','Read redacted OMH trace summaries.',{limit:{type:'integer',minimum:1,maximum:100}}),
 spec('omh_skill_propose','Propose a skill for human review; does not publish it.',{name:str,description:str,instructions:str,evidence:str},['name','description','instructions']),
 spec('omh_skill_proposals','List pending and reviewed skill proposals.',{}),
 spec('omh_agent_send','Send an informational agent mailbox message.',{from:str,to:str,content:str},['from','to','content']),
 spec('omh_agent_inbox','Read mailbox messages addressed to an agent.',{agent:str},['agent']),
];
export async function callTool(name,args={}){
 if(!args||typeof args!=='object'||Array.isArray(args))throw TypeError('Arguments must be an object');
 const queue=await new TaskQueue(join(state,'tasks.json'),makeHandlers(workspace)).load();
 switch(name){
  case 'omh_status':return {queued:queue.list().filter(x=>x.status==='queued').length,taskCount:queue.list().length};
  case 'omh_memory_search':return (await new MemoryStore(join(state,'memory.json')).load()).search(args.query,{scope:args.scope||'project'});
  case 'omh_task_list':return queue.list().map(({id,kind,status,createdAt,finishedAt})=>({id,kind,status,createdAt,finishedAt}));
  case 'omh_queue_read':return queue.enqueue('workspace.read',{path:args.path});
  case 'omh_trace_recent':return (await new TraceJournal(join(state,'audit.jsonl')).read({limit:args.limit||20}));
  case 'omh_skill_propose':return (await new SkillProposalStore(join(state,'skill-proposals.json')).load()).propose(args);
  case 'omh_skill_proposals':return (await new SkillProposalStore(join(state,'skill-proposals.json')).load()).list();
  case 'omh_agent_send':return (await new AgentBus(join(state,'agent-bus.json')).load()).send(args);
  case 'omh_agent_inbox':return (await new AgentBus(join(state,'agent-bus.json')).load()).inbox(args.agent);
  default:throw new Error('Unknown or forbidden MCP tool');
 }
}
export async function handleRPC(msg){
 if(!msg||msg.jsonrpc!=='2.0'||typeof msg.method!=='string')return null;
 if(!Object.hasOwn(msg,'id'))return null;
 const id=msg.id;
 try{
  let result;
  if(msg.method==='initialize'){const offered=msg.params?.protocolVersion;const version=['2024-11-05','2025-03-26','2025-06-18','2025-11-25'].includes(offered)?offered:'2025-11-25';result={protocolVersion:version,capabilities:{tools:{listChanged:false}},serverInfo:{name:'omh-runtime',version:'0.1.0'}};}
  else if(msg.method==='ping')result={};
  else if(msg.method==='tools/list')result={tools:TOOLS};
  else if(msg.method==='tools/call'){
   const {name,arguments:args={}}=msg.params||{};
   if(!TOOLS.some(t=>t.name===name))throw Error('Unknown MCP tool');
   try{const output=await callTool(name,args);result={content:[{type:'text',text:JSON.stringify(output)}],isError:false};}
   catch(e){result={content:[{type:'text',text:String(e.message)}],isError:true};}
  }else return {jsonrpc:'2.0',id,error:{code:-32601,message:'Method not found'}};
  return {jsonrpc:'2.0',id,result};
 }catch(e){return {jsonrpc:'2.0',id,error:{code:-32603,message:String(e.message)}};}
}
if(process.argv[1]&&import.meta.url===new URL('file://'+resolve(process.argv[1])).href){
 const lines=createInterface({input:process.stdin,crlfDelay:Infinity});
 for await(const line of lines){
  if(Buffer.byteLength(line)>65536)continue;
  try{const request=JSON.parse(line);const response=await handleRPC(request);if(response)process.stdout.write(JSON.stringify(response)+'\n');}
  catch(e){process.stderr.write('OMH MCP parse error: '+String(e.message).slice(0,120)+'\n');}
 }
}
