/** Explicitly approved, project-scoped durable memory. No implicit collection. */
import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
export class MemoryStore {
  constructor(file,{maxEntries=1000}={}) {if(!file||!Number.isInteger(maxEntries)||maxEntries<1)throw new TypeError('Invalid memory configuration');this.file=file;this.maxEntries=maxEntries;this.entries=[];}
  async load(){try{const obj=JSON.parse(await readFile(this.file,'utf8'));if(obj.version!==1||!Array.isArray(obj.entries))throw Error('Invalid memory file');this.entries=obj.entries;}catch(e){if(e.code!=='ENOENT')throw e;}return this;}
  async save(){await mkdir(dirname(this.file),{recursive:true});const tmp=`${this.file}.${randomUUID()}.tmp`;await writeFile(tmp,JSON.stringify({version:1,entries:this.entries},null,2),{mode:0o600});await rename(tmp,this.file);}
  list({scope}={}){return structuredClone(this.entries.filter(e=>!scope||e.scope===scope));}
  search(query,{scope,limit=20}={}){if(typeof query!=='string'||!Number.isInteger(limit)||limit<1)throw new TypeError('Invalid query');const q=query.toLowerCase().trim();return this.list({scope}).filter(e=>`${e.title} ${e.content}`.toLowerCase().includes(q)).slice(0,limit);}
  async add({scope='global',title,content,approved=false}={}){if(approved!==true)throw Error('Explicit approval required to store memory');if(![scope,title,content].every(v=>typeof v==='string'&&v.trim()))throw new TypeError('Invalid entry');if(scope.length>120||title.length>200||content.length>20000)throw new RangeError('Entry too large');const entry={id:randomUUID(),scope,title,content,createdAt:new Date().toISOString()};this.entries.push(entry);if(this.entries.length>this.maxEntries)this.entries.splice(0,this.entries.length-this.maxEntries);await this.save();return structuredClone(entry);}
  async remove(id){const n=this.entries.length;this.entries=this.entries.filter(e=>e.id!==id);if(n!==this.entries.length)await this.save();return n!==this.entries.length;}
}
