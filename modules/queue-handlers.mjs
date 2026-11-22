/** Approved built-in task handlers. No arbitrary host process execution. */
import {runSandbox} from './sandbox.mjs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';
const rootPath = (root,relative='') => {if(typeof relative!=='string'||relative.includes('\0'))throw new TypeError('Invalid path');const path=resolve(root,relative);if(path!==root&&!path.startsWith(root+sep))throw new Error('Path escapes workspace');return path;};
export function makeHandlers(workspace){
 if(typeof workspace!=='string')throw new TypeError('Workspace required');
 const root=resolve(workspace);
 return {
  'workspace.read':async ({path})=>{const p=rootPath(root,path);const data=await readFile(p,'utf8');if(data.length>100000)throw Error('File too large');return data;},
  'workspace.write':async ({path,content,approved})=>{if(approved!==true)throw Error('Write approval required');if(typeof content!=='string'||content.length>100000)throw TypeError('Invalid content');const p=rootPath(root,path);await mkdir(root,{recursive:true});await writeFile(p,content,{flag:'wx',mode:0o600});return {path};},
  'sandbox.exec':async ({command,args=[],timeoutMs=30000,approved})=>{if(approved!==true)throw Error('Execution approval required');return runSandbox({workspace:root,command,args,timeoutMs});}
 };
}
