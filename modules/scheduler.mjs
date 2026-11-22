/** Persistent interval schedule, evaluated only on explicit tick. */
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
export class Scheduler {
 constructor(file,queue){this.file=file;this.queue=queue;this.jobs=[];}
 async load(){try{let data=JSON.parse(await readFile(this.file,'utf8'));if(!Array.isArray(data.jobs))throw Error('Invalid scheduler');this.jobs=data.jobs;}catch(e){if(e.code!=='ENOENT')throw e;}return this;}
 async save(){await mkdir(dirname(this.file),{recursive:true});const tmp=this.file+'.'+randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify({version:1,jobs:this.jobs},null,2),{mode:0o600});await rename(tmp,this.file);}
 async add({kind,input={},everyMs,enabled=true}={}){if(!Object.hasOwn(this.queue.handlers,kind)||!Number.isInteger(everyMs)||everyMs<60000||everyMs>31536000000)throw TypeError('Invalid schedule');const job={id:randomUUID(),kind,input,everyMs,enabled,nextAt:Date.now()+everyMs};this.jobs.push(job);await this.save();return structuredClone(job);}
 async tick(now=Date.now()){if(!Number.isFinite(now))throw TypeError('Invalid timestamp');const ready=[];for(const job of this.jobs){if(job.enabled&&job.nextAt<=now){const task=await this.queue.enqueue(job.kind,job.input);ready.push(task);job.nextAt=now+job.everyMs;}}if(ready.length)await this.save();return ready;}
 list(){return structuredClone(this.jobs);}
}
