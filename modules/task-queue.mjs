/** Durable local task queue. Caller supplies approved task handlers. */
import {readFile, writeFile, rename, mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
const STATES = new Set(['queued','running','completed','failed']);
export class TaskQueue {
  constructor(file, handlers = {}) { if (typeof file !== 'string' || !file) throw new TypeError('file required'); this.file=file; this.handlers=handlers; this.tasks=[]; }
  async load() {
    try { const data=JSON.parse(await readFile(this.file,'utf8')); if (!Array.isArray(data.tasks)) throw new Error('Invalid queue'); this.tasks=data.tasks.map(t=>{if (!t || !STATES.has(t.status) || typeof t.id!=='string' || typeof t.kind!=='string') throw new Error('Invalid task'); return {...t,status:t.status==='running'?'queued':t.status};}); }
    catch(e) { if(e.code!=='ENOENT') throw e; this.tasks=[]; }
    return this;
  }
  async save() { await mkdir(dirname(this.file),{recursive:true}); const temp=`${this.file}.${randomUUID()}.tmp`; await writeFile(temp,JSON.stringify({version:1,tasks:this.tasks},null,2),{mode:0o600}); await rename(temp,this.file); }
  async enqueue(kind, input={}) { if(typeof kind!=='string' || !Object.hasOwn(this.handlers,kind) || typeof this.handlers[kind]!=='function') throw new TypeError('Unregistered task kind'); const t={id:randomUUID(),kind,input,status:'queued',createdAt:new Date().toISOString(),attempts:0};this.tasks.push(t);await this.save();return structuredClone(t); }
  list() {return structuredClone(this.tasks);}
  async runNext() { const t=this.tasks.find(x=>x.status==='queued');return t?this.runById(t.id):null; }
  async runById(id) { const t=this.tasks.find(x=>x.id===id&&x.status==='queued');if(!t)return null; const fn=this.handlers[t.kind]; if(typeof fn!=='function'){t.status='failed';t.error='Handler unavailable';await this.save();return structuredClone(t);} t.status='running';t.attempts++;await this.save();try{t.result=await fn(structuredClone(t.input));t.status='completed';}catch(e){t.error=String(e?.message||e);t.status='failed';}t.finishedAt=new Date().toISOString();await this.save();return structuredClone(t); }
}
