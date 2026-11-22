/** Exclusive, bounded filesystem transaction lock for small local JSON state files.
 * Not a distributed lock. Stale locks fail closed and require operator review.
 */
import {mkdir,open,rm} from 'node:fs/promises';
import {dirname} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

export async function withStateLock(file,work,{retries=80,delayMs=25}={}){
 if(typeof file!=='string'||!file||typeof work!=='function')throw new TypeError('Invalid state transaction');
 if(!Number.isInteger(retries)||retries<0||retries>500||
    !Number.isInteger(delayMs)||delayMs<1||delayMs>1000)throw new RangeError('Invalid lock bounds');
 await mkdir(dirname(file),{recursive:true});
 const lock=file+'.lock';
 let handle;
 for(let attempt=0;attempt<=retries;attempt++){
  try{handle=await open(lock,'wx',0o600);break;}
  catch(error){
   if(error.code!=='EEXIST')throw error;
   if(attempt===retries)throw new Error('State store locked; verify the owning process before removing the lock');
   await delay(delayMs);
  }
 }
 try{return await work();}
 finally{await handle.close();await rm(lock,{force:true});}
}
