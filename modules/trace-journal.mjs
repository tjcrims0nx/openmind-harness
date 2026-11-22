/** Persistent trace journal for OMH runner; opt-in, newline-delimited. */
import {mkdir,appendFile,readFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {redact} from './trace.mjs';
const TYPES=new Set(['task.queued','task.started','task.finished','workflow.started','workflow.finished','sandbox.denied','memory.updated','skill.published']);
export class TraceJournal {
 constructor(file,{enabled=false}={}){this.file=file;this.enabled=enabled;}
 async record(type,fields={}){if(!TYPES.has(type))throw new TypeError('Unknown event');if(!this.enabled)return false;await mkdir(dirname(this.file),{recursive:true});await appendFile(this.file,JSON.stringify({at:new Date().toISOString(),type,fields:redact(fields)})+'\n',{mode:0o600});return true;}
 async read({limit=100}={}){if(!Number.isInteger(limit)||limit<1||limit>10000)throw new RangeError('Invalid limit');let content;try{content=await readFile(this.file,'utf8')}catch(e){if(e.code==='ENOENT')return [];throw e;}return content.trim().split('\n').filter(Boolean).slice(-limit).map(line=>JSON.parse(line));}
}
