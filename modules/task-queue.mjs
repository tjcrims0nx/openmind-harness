/** Durable, single-executor-per-task queue with atomic file locks. */
import {readFile,writeFile,rename,mkdir,open,rm,stat} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
const STATES=new Set(['queued','running','completed','failed']);
const STALE_MS=15*60*1000;
export class TaskQueue {
 constructor(file,handlers={}){if(typeof file!=='string'||!file)throw TypeError('File required');this.file=file;this.handlers=handlers;this.tasks=[];}
 async #read(){
  try{
   const data=JSON.parse(await readFile(this.file,'utf8'));
   if(!Array.isArray(data.tasks))throw Error('Invalid queue');
   return data.tasks.map(t=>{
    if(!t||!STATES.has(t.status)||typeof t.id!=='string'||typeof t.kind!=='string')throw Error('Invalid task');
    if(t.status==='running'&&(!t.startedAt||Date.now()-Date.parse(t.startedAt)>STALE_MS))
      return {...t,status:'queued',recovered:true};
    return t;
   });
  }catch(e){if(e.code==='ENOENT')return [];throw e;}
 }
 async load(){this.tasks=await this.#read();return this;}
 async #persist(){await mkdir(dirname(this.file),{recursive:true});const tmp=this.file+'.'+randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify({version:1,tasks:this.tasks},null,2),{mode:0o600});await rename(tmp,this.file);}
 async save(){await this.#persist();}
 async #locked(fn){
  await mkdir(dirname(this.file),{recursive:true});
  const lock=this.file+'.lock';let h;
  for(let attempt=0;attempt<100;attempt++){
   try{h=await open(lock,'wx',0o600);break;}
   catch(e){
    if(e.code!=='EEXIST')throw e;
    try{if(Date.now()-(await stat(lock)).mtimeMs>STALE_MS)await rm(lock,{force:true});}
    catch(e){if(e.code!=='ENOENT')throw e;}
    await delay(50);
   }
  }
  if(!h)throw Error('Queue lock unavailable');
  try{this.tasks=await this.#read();return await fn();}
  finally{await h.close();await rm(lock,{force:true});}
 }
 async enqueue(kind,input={}){
  if(typeof kind!=='string'||!Object.hasOwn(this.handlers,kind)||typeof this.handlers[kind]!=='function')throw TypeError('Unregistered task kind');
  return this.#locked(async()=>{
   const t={id:randomUUID(),kind,input:structuredClone(input),status:'queued',createdAt:new Date().toISOString(),attempts:0};
   this.tasks.push(t);await this.#persist();return structuredClone(t);
  });
 }
 list(){return structuredClone(this.tasks);}
 async refresh(){return this.load();}
 async runNext(){await this.refresh();const t=this.tasks.find(t=>t.status==='queued');return t?this.runById(t.id):null;}
 async runById(id){
  const task=await this.#locked(async()=>{
   const t=this.tasks.find(x=>x.id===id&&x.status==='queued');
   if(!t)return null;
   t.status='running';t.startedAt=new Date().toISOString();t.attempts=(t.attempts||0)+1;
   await this.#persist();return structuredClone(t);
  });
  if(!task)return null;
  let result,error;
  try{
   const fn=this.handlers[task.kind];
   if(typeof fn!=='function')throw Error('Handler unavailable');
   result=await fn(structuredClone(task.input));
  }catch(e){error=String(e?.message||e);}
  return this.#locked(async()=>{
   const t=this.tasks.find(x=>x.id===task.id);
   if(!t)throw Error('Task disappeared');
   // A stale lease may have been recovered/reclaimed by another worker.
   if(t.status!=='running'||t.startedAt!==task.startedAt)return structuredClone(t);
   if(error){t.error=error;t.status='failed';}
   else{t.result=result;t.status='completed';delete t.error;}
   t.finishedAt=new Date().toISOString();
   await this.#persist();return structuredClone(t);
  });
 }
}
