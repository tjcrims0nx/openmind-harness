/** Durable agent-to-agent mailbox; messages are data, not privileged instructions. */
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {withStateLock} from './state-lock.mjs';
const valid=id=>typeof id==='string'&&/^[a-zA-Z0-9_-]{1,64}$/.test(id);
export class AgentBus{
 constructor(file,{maxMessages=1000}={}){if(!file||!Number.isInteger(maxMessages)||maxMessages<1)throw TypeError('Invalid bus');this.file=file;this.maxMessages=maxMessages;this.messages=[];}
 async load(){try{const d=JSON.parse(await readFile(this.file,'utf8'));if(!Array.isArray(d.messages))throw Error('Invalid bus');this.messages=d.messages;}catch(e){if(e.code!=='ENOENT')throw e;this.messages=[];}return this;}
 async save(){await mkdir(dirname(this.file),{recursive:true});const tmp=this.file+'.'+randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify({version:1,messages:this.messages},null,2),{mode:0o600});await rename(tmp,this.file);}
 async #transaction(change){return withStateLock(this.file,async()=>{await this.load();const result=await change();await this.save();return result;});}
 async send({from,to,content}={}){if(!valid(from)||!valid(to)||typeof content!=='string'||!content||content.length>10000)throw TypeError('Invalid message');const m={id:randomUUID(),from,to,content,at:new Date().toISOString(),read:false};return this.#transaction(async()=>{this.messages.push(m);if(this.messages.length>this.maxMessages)this.messages.shift();return structuredClone(m);});}
 inbox(agent){if(!valid(agent))throw TypeError('Invalid agent');return structuredClone(this.messages.filter(m=>m.to===agent));}
 async ack(agent,id){if(!valid(agent))throw TypeError('Invalid agent');return this.#transaction(async()=>{const m=this.messages.find(m=>m.id===id&&m.to===agent);if(!m)return false;m.read=true;return true;});}
}
