/** Native OpenCode agent runner. Uses the OpenCode CLI, NOT a security sandbox. */
import {spawn} from 'node:child_process';
import {resolve,isAbsolute} from 'node:path';
import {abortOpenCodeSession,startOpenCode} from './opencode-session.mjs';
export const OMH_AGENTS=Object.freeze(['planner','implementer','tester','reviewer']);
export function agentArgs({agent,prompt,workspace,model}={}){
 if(!OMH_AGENTS.includes(agent))throw new TypeError('Unknown OMH agent');
 if(typeof prompt!=='string'||!prompt.trim()||prompt.length>16000)throw new TypeError('Invalid agent prompt');
 if(typeof workspace!=='string'||!isAbsolute(workspace))throw new TypeError('Absolute workspace path required');
 if(model!==undefined&&(typeof model!=='string'||!/^[\w.-]+\/[\w.:-]+$/.test(model)))throw new TypeError('Invalid model');
 return ['run','--format','json','--agent',agent,'--dir',resolve(workspace),...(model?['--model',model]:[]),'--',prompt];
}
export function requireSuccessfulAgentRun(result) {
 if(result.timedOut)throw new Error('OpenCode agent timed out');
 if(result.outputTruncated)throw new Error('OpenCode agent exceeded its output limit');
 if(result.signal)throw new Error(`OpenCode agent was terminated by ${result.signal}`);
 if(result.exitCode!==0)throw new Error(`OpenCode agent exited with code ${result.exitCode}`);
 if(result.stderr?.includes('Falling back to default agent')){
  throw new Error('OpenCode did not select the requested OMH agent');
 }
 for(const line of result.stdout.split('\n')){
  let event;
  try{event=JSON.parse(line);}
  catch{continue;}
  if(event?.type==='error')throw new Error('OpenCode reported a session error');
 }
}
export async function runAgent(
 {agent,prompt,workspace,model,approved=false,timeoutMs=180000}={},
 {signal}={},
){
 if(approved!==true)throw new Error('Native agent execution requires approval; it runs outside bubblewrap');
 if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>600000)throw new RangeError('Invalid agent timeout');
 const args=agentArgs({agent,prompt,workspace,model});
 const server=await startOpenCode(workspace,signal);
 try{
  signal?.throwIfAborted();
  const session=await server.request('/session',{method:'POST',body:JSON.stringify({permission:['question','plan_enter','plan_exit'].map(permission=>({permission,pattern:'*',action:'deny'}))})});
  if(typeof session.id!=='string'||!/^ses_[a-zA-Z0-9]+$/.test(session.id))throw new Error('Invalid OpenCode session ID');
  signal?.throwIfAborted();
  args.splice(-2,0,'--attach',server.url,'--session',session.id);
  const output=await runAttachedAgent(args,workspace,server,session.id,timeoutMs,signal);
  requireSuccessfulAgentRun(output);
  // Attached clients can exit before their final event subscription drains.
  // Read the new session's committed assistant parts as the source of truth.
  const messages=await server.request('/session/'+session.id+'/message');
  const assistant=messages.filter(message=>message.info?.role==='assistant');
  if(!assistant.length||assistant.some(message=>message.info.error))throw new Error('OpenCode session did not finish successfully');
  if(assistant.at(-1).info.agent!==agent)throw new Error('OpenCode did not select the requested OMH agent');
  const types={'step-start':'step_start','step-finish':'step_finish',text:'text',tool:'tool_use'};
  output.stdout=assistant.flatMap(({parts,info})=>parts.filter(part=>Object.hasOwn(types,part.type)).map(part=>
   JSON.stringify({type:types[part.type],timestamp:part.time?.end??info.time.completed,sessionID:session.id,part})
  )).join('\n')+'\n';
  return output;
 }finally{
  await server.close();
 }
}
async function runAttachedAgent(args,workspace,server,id,timeoutMs,signal){
 const child=spawn('opencode',args,{cwd:workspace,stdio:['ignore','pipe','pipe'],env:server.env});
 let stdout='',stderr='',bytes=0,exited=false;
 let interrupt;
 const interrupted=new Promise(resolve=>{interrupt=resolve;});
 const closed=new Promise(resolve=>child.once('close',resolve));
 const completion=new Promise((resolve,reject)=>{
  child.once('error',reject);
  child.once('exit',()=>{exited=true;});
  child.once('close',(exitCode,signal)=>{
   resolve({exitCode,signal,stdout,stderr,timedOut:false,outputTruncated:false});
  });
 });
 const timer=setTimeout(()=>interrupt('timeout'),timeoutMs);
 const onAbort=()=>interrupt('cancel');
 signal?.addEventListener('abort',onAbort,{once:true});
 const collect=append=>chunk=>{
  bytes+=chunk.length;
  if(bytes>1048576)interrupt('output');
  else append(chunk.toString());
 };
 child.stdout.on('data',collect(chunk=>{stdout+=chunk;}));
 child.stderr.on('data',collect(chunk=>{stderr+=chunk;}));
 try{
  const outcome=await Promise.race([interrupted,completion]);
  if(typeof outcome!=='string')return outcome;

  const confirmed=await abortOpenCodeSession(server,id,()=>exited);
  if(outcome==='timeout')throw new Error('OpenCode agent timed out');
  if(outcome==='output')throw new Error('OpenCode agent exceeded its output limit');
  if(confirmed)throw signal.reason;
  return await completion;
 }finally{
  clearTimeout(timer);
  signal?.removeEventListener('abort',onAbort);
  if(!exited)child.kill('SIGKILL');
  await closed;
 }
}
