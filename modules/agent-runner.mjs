/** Native OpenCode agent runner. Uses the OpenCode CLI, NOT a security sandbox. */
import {spawn} from 'node:child_process';
import {resolve,isAbsolute} from 'node:path';
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
 for(const line of result.stdout.split('\n')){
  let event;
  try{event=JSON.parse(line);}
  catch{continue;}
  if(event?.type==='error')throw new Error('OpenCode reported a session error');
 }
}
export async function runAgent({agent,prompt,workspace,model,approved=false,timeoutMs=180000}={}){
 if(approved!==true)throw new Error('Native agent execution requires approval; it runs outside bubblewrap');
 if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>600000)throw new RangeError('Invalid agent timeout');
 const args=agentArgs({agent,prompt,workspace,model});
 return new Promise((ok,fail)=>{
  const child=spawn('opencode',args,{cwd:workspace,stdio:['ignore','pipe','pipe'],env:process.env});
  let stdout='',stderr='',bytes=0,timedOut=false,overflow=false,settled=false;
  const timer=setTimeout(()=>{timedOut=true;child.kill('SIGKILL');},timeoutMs);
  const onData=key=>chunk=>{bytes+=chunk.length;if(bytes>1048576){overflow=true;child.kill('SIGKILL');return;}if(key==='out')stdout+=chunk.toString();else stderr+=chunk.toString();};
  child.stdout.on('data',onData('out'));child.stderr.on('data',onData('err'));
  child.on('error',e=>{clearTimeout(timer);if(!settled){settled=true;fail(e)}});
  child.on('close',(code,signal)=>{clearTimeout(timer);if(!settled){settled=true;ok({exitCode:code,signal,stdout,stderr,timedOut,outputTruncated:overflow});}});
 });
}
