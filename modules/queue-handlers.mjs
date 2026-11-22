/** Approved built-in task handlers. No arbitrary host process execution. */
import {runSandbox} from './sandbox.mjs';
import {readFile,writeFile,mkdir,realpath} from 'node:fs/promises';
import {resolve,dirname,sep} from 'node:path';
const SENSITIVE = /^(?:\.omh|\.git|\.env(?:\..*)?|\.ssh|\.gnupg|\.npmrc|auth\.json|credentials(?:\..*)?|id_[^/]+)$/i;
const rootPath = (root,relative='') => {
 if(typeof relative!=='string'||relative.includes('\0'))throw new TypeError('Invalid path');
 const path=resolve(root,relative);
 if(path!==root&&!path.startsWith(root+sep))throw new Error('Path escapes workspace');
 if(path.slice(root.length).split(sep).some(x=>SENSITIVE.test(x)||/\.(?:pem|key|p12)$/i.test(x)))throw new Error('Sensitive path denied');
 return path;
};
export function makeHandlers(workspace){
 if(typeof workspace!=='string')throw new TypeError('Workspace required');
 const root=resolve(workspace);
 const verified=async (path,existing=false)=>{const rootReal=await realpath(root);const check=await realpath(existing?path:dirname(path));if(check!==rootReal&&!check.startsWith(rootReal+sep))throw new Error('Symlink escapes workspace');return path;};
 return {
  'workspace.read':async ({path})=>{const p=await verified(rootPath(root,path),true);const data=await readFile(p,'utf8');if(data.length>100000)throw Error('File too large');return data;},
  'workspace.write':async ({path,content,approved})=>{if(approved!==true)throw Error('Write approval required');if(typeof content!=='string'||content.length>100000)throw TypeError('Invalid content');await mkdir(root,{recursive:true});const p=await verified(rootPath(root,path));await writeFile(p,content,{flag:'wx',mode:0o600});return {path};},
  'sandbox.exec':async ({command,args=[],timeoutMs=30000,approved})=>{if(approved!==true)throw Error('Execution approval required');return runSandbox({workspace:root,command,args,timeoutMs});}
 };
}
