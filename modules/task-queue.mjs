/** Durable, single-executor-per-task queue with atomic file locks. */
import {readFile,writeFile,rename,mkdir,open,rm,stat} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
const STATES=new Set(['queued','running','completed','failed','cancelled']);
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
  const [task]=await this.#enqueue([{kind,input}],false);
  return task;
 }
 async enqueueSequence(steps){
  return this.#enqueue(steps,true);
 }
 async #enqueue(steps,sequential){
  for(const {kind} of steps){
   if(typeof kind!=='string'||!Object.hasOwn(this.handlers,kind)||typeof this.handlers[kind]!=='function')throw TypeError('Unregistered task kind');
  }
  return this.#locked(async()=>{
   const tasks=[];
   for(const {kind,input} of steps){
    const task={id:randomUUID(),kind,input:structuredClone(input),status:'queued',createdAt:new Date().toISOString(),attempts:0};
    if(sequential&&tasks.length)task.dependsOn=tasks.at(-1).id;
    tasks.push(task);
   }
   this.tasks.push(...tasks);
   await this.#persist();
   return structuredClone(tasks);
  });
 }
 list(){return structuredClone(this.tasks);}
 /**
  * Cancel a queued task. Running tasks cannot be cancelled safely by changing
  * queue metadata because the handler may still be mutating the workspace.
  */
 async cancel(id){
  if(typeof id!=='string'||!id)throw new TypeError('Task id required');
  return this.#locked(async()=>{
   const t=this.tasks.find(x=>x.id===id);
   if(!t)return null;
   if(t.status==='running')throw new Error('Cannot cancel a running task; stop its worker first');
   if(t.status!=='queued')return structuredClone(t);
   t.status='cancelled';
   t.finishedAt=new Date().toISOString();
   await this.#persist();return structuredClone(t);
  });
 }
 /** Explicit retry of a failed task; no unbounded automatic retries. */
 async retry(id,{maxAttempts=3}={}){
  if(typeof id!=='string'||!id)throw new TypeError('Task id required');
  if(!Number.isInteger(maxAttempts)||maxAttempts<1||maxAttempts>10)throw new RangeError('Invalid retry limit');
  return this.#locked(async()=>{
   const t=this.tasks.find(x=>x.id===id);
   if(!t)return null;
   if(t.status!=='failed')throw new Error('Only failed tasks can be retried');
   if(t.attempts>=maxAttempts)throw new Error('Retry limit reached');
   t.status='queued';delete t.error;delete t.finishedAt;
   await this.#persist();return structuredClone(t);
  });
 }

 async refresh(){return this.load();}
 async runNext(){return this.#run();}
 async runById(id){
  if(typeof id!=='string')return null;
  return this.#run(id);
 }
 async #run(id){
  const task=await this.#locked(async()=>{
   const completed=new Set(this.tasks.filter(t=>t.status==='completed').map(t=>t.id));
   const t=this.tasks.find(x=>(id===undefined||x.id===id)&&x.status==='queued'&&
    (x.dependsOn===undefined||completed.has(x.dependsOn)));
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
