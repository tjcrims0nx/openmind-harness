/** Local worker heartbeat. Observational only: never use as a security lock. */
import {readFile,writeFile,rename,mkdir,rm} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';

export async function writeHeartbeat(file,{pid=process.pid,at=Date.now()}={}){
 if(!Number.isInteger(pid)||pid<=0||!Number.isFinite(at))throw TypeError('Invalid heartbeat');
 await mkdir(dirname(file),{recursive:true});
 const tmp=file+'.'+randomUUID()+'.tmp';
 await writeFile(tmp,JSON.stringify({version:1,pid,at}),{mode:0o600});
 await rename(tmp,file);
 return {pid,at};
}
export async function readHeartbeat(file,{now=Date.now(),staleMs=15000}={}){
 if(!Number.isFinite(now)||!Number.isInteger(staleMs)||staleMs<1000)throw TypeError('Invalid heartbeat time');
 let x;
 try{x=JSON.parse(await readFile(file,'utf8'));}
 catch(error){if(error.code==='ENOENT')return {online:false,reason:'worker-not-started'};return {online:false,reason:'status-unavailable'};}
 if(x?.version!==1||!Number.isFinite(x.at)||!Number.isInteger(x.pid)||x.pid<=0)return {online:false,reason:'invalid-status'};
 if(x.at>now+2000||now-x.at>staleMs)return {online:false,reason:'stale-heartbeat',lastSeen:new Date(x.at).toISOString()};
 return {online:true,pid:x.pid,lastSeen:new Date(x.at).toISOString()};
}
export async function clearHeartbeat(file){await rm(file,{force:true});}
