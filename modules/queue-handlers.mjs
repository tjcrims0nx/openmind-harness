/** Approved built-in task handlers. No arbitrary host process execution. */
import {runSandbox} from './sandbox.mjs';
import {requireSuccessfulAgentRun,runAgent} from './agent-runner.mjs';
import {ToolPolicy} from './tool-policy.mjs';
import {prepareAgentTask,summarizeAgentEvents} from './agent-integration.mjs';
import {readFile,writeFile,mkdir,realpath} from 'node:fs/promises';
import {resolve,dirname,basename,sep,join} from 'node:path';
const SENSITIVE = /^(?:\.omh|\.git|\.env(?:\..*)?|\.ssh|\.gnupg|\.npmrc|auth\.json|credentials(?:\..*)?|id_[^/]+)$/i;
function denySensitivePath(root, path) {
 if(path.slice(root.length).split(sep).some(part=>SENSITIVE.test(part)||/\.(?:pem|key|p12)$/i.test(part))) {
  throw new Error('Sensitive path denied');
 }
}
const rootPath = (root,relative='') => {
 if(typeof relative!=='string'||relative.includes('\0'))throw new TypeError('Invalid path');
 const path=resolve(root,relative);
 if(path!==root&&!path.startsWith(root+sep))throw new Error('Path escapes workspace');
 denySensitivePath(root, path);
 return path;
};
async function prepareSandboxWorkspace(root, workspaceId) {
 await mkdir(root, {recursive:true});
 let directory=await realpath(root);
 for(const part of ['.omh','sandboxes',workspaceId]){
  directory=join(directory,part);
  try{await mkdir(directory,{mode:0o700});}
  catch(error){if(error.code!=='EEXIST')throw error;}
  if(await realpath(directory)!==directory)throw new Error('Sandbox workspace symlink denied');
 }
 return directory;
}
export function makeHandlers(workspace){
 if(typeof workspace!=='string')throw new TypeError('Workspace required');
 const root=resolve(workspace);
 const policy=new ToolPolicy({allow:['workspace.read'],ask:['workspace.write','sandbox.exec','agent.run']});
 const verified=async (path,existing=false)=>{
  const rootReal=await realpath(root);
  const target=await realpath(existing?path:dirname(path));
  if(target!==rootReal&&!target.startsWith(rootReal+sep))throw new Error('Symlink escapes workspace');
  denySensitivePath(rootReal, target);
  return existing ? target : join(target, basename(path));
 };
 return {
  'workspace.read':async ({path})=>{policy.require('workspace.read');const p=await verified(rootPath(root,path),true);const data=await readFile(p,'utf8');if(data.length>100000)throw Error('File too large');return data;},
  'workspace.write':async ({path,content,approved})=>{policy.require('workspace.write',{approved});if(approved!==true)throw Error('Write approval required');if(typeof content!=='string'||content.length>100000)throw TypeError('Invalid content');await mkdir(root,{recursive:true});const p=await verified(rootPath(root,path));await writeFile(p,content,{flag:'wx',mode:0o600});return {path};},
  'sandbox.exec':Object.assign(async ({command,args=[],timeoutMs=30000,workspaceId='default',approved},{signal}={})=>{
   policy.require('sandbox.exec',{approved});
   if(typeof workspaceId!=='string'||!/^[a-zA-Z0-9_-]{1,64}$/.test(workspaceId))throw TypeError('Invalid sandbox workspace id');
   const workspace=await prepareSandboxWorkspace(root,workspaceId);
   const result=await runSandbox({workspace,command,args,timeoutMs,signal});
   if(result.timedOut)throw new Error('Sandbox command timed out');
   if(result.outputTruncated)throw new Error('Sandbox command exceeded its output limit');
   if(result.signal)throw new Error(`Sandbox command was terminated by ${result.signal}`);
   if(result.exitCode!==0)throw new Error(`Sandbox exited with code ${result.exitCode}`);
   return result;
  },{cancellable:true}),
  'agent.run':async (input)=>{
   policy.require('agent.run',{approved:input.approved});
   const args=await prepareAgentTask(input,{workspace:root});
   const result=await runAgent(args);
   requireSuccessfulAgentRun(result);
   return {...result,events:summarizeAgentEvents(result.stdout)};
  }
 };
}
