/** Persistent interval scheduler, safe for a CLI producer and daemon consumer. */
import {readFile,writeFile,mkdir,rename,open,rm,stat} from 'node:fs/promises';
import {dirname} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {randomUUID} from 'node:crypto';
export class Scheduler{
 constructor(file,queue){this.file=file;this.queue=queue;this.jobs=[];}
 async load(){try{const data=JSON.parse(await readFile(this.file,'utf8'));if(!Array.isArray(data.jobs))throw Error('Invalid scheduler');this.jobs=data.jobs;}catch(e){if(e.code!=='ENOENT')throw e;this.jobs=[];}return this;}
 async save(){await mkdir(dirname(this.file),{recursive:true});const tmp=this.file+'.'+randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify({version:1,jobs:this.jobs},null,2),{mode:0o600});await rename(tmp,this.file);}
 async #locked(fn){
  await mkdir(dirname(this.file),{recursive:true});const lock=this.file+'.lock';let h;
  for(let i=0;i<100;i++){
   try{h=await open(lock,'wx',0o600);break;}
   catch(e){if(e.code!=='EEXIST')throw e;try{if(Date.now()-(await stat(lock)).mtimeMs>900000)await rm(lock,{force:true});}catch(e){if(e.code!=='ENOENT')throw e;}await delay(50);}
  }
  if(!h)throw Error('Scheduler lock unavailable');
  try{await this.load();return await fn();}finally{await h.close();await rm(lock,{force:true});}
 }
 async add({kind,input={},everyMs,enabled=true}={}){
  if(!Object.hasOwn(this.queue.handlers,kind)||!Number.isInteger(everyMs)||everyMs<60000||everyMs>31536000000)throw TypeError('Invalid schedule');
  return this.#locked(async()=>{const j={id:randomUUID(),kind,input:structuredClone(input),everyMs,enabled,nextAt:Date.now()+everyMs};this.jobs.push(j);await this.save();return structuredClone(j);});
 }
 async tick(now=Date.now()){
  if(!Number.isFinite(now))throw TypeError('Invalid timestamp');
  return this.#locked(async()=>{
   const ready=[];
   for(const job of this.jobs){
    if(!job.enabled||job.nextAt>now)continue;
    // If the queue write succeeded before the schedule write failed, reuse that occurrence.
    const idempotencyKey=`schedule:${job.id}:${job.nextAt}`;
    ready.push(await this.queue.enqueue(job.kind,job.input,{idempotencyKey}));
    job.nextAt=now+job.everyMs;
   }
   if(ready.length)await this.save();
   return ready;
  });
 }
 list(){return structuredClone(this.jobs);}
}
