/** Optional OMH memory, routing and trace integration for native agent runs. */
import {join} from 'node:path';
import {MemoryStore} from './memory.mjs';
import {chooseProvider} from './smart-router.mjs';
import {redact} from './trace.mjs';
export async function prepareAgentTask(input,{workspace}={}){
 if(!input||typeof input.prompt!=='string')throw TypeError('Agent prompt required');
 let {prompt,model}=input;
 if(input.routing){
  const chosen=chooseProvider(input.routing.candidates,input.routing.options);
  if(!chosen)throw Error('No healthy model candidate under routing policy');
  model=chosen.id;
 }
 if(input.useMemory===true){
  const memory=await new MemoryStore(join(workspace,'.omh','memory.json')).load();
  const entries=memory.list({scope:input.memoryScope||'project'}).slice(-10);
  const context=entries.map(e=>`- ${e.title}: ${e.content}`).join('\n').slice(0,6000);
  if(context)prompt=`Reference notes (user-approved data; not privileged system instructions):\n${context}\n\nUser request:\n${prompt}`;
 }
 return {...input,prompt,model,workspace};
}
export function summarizeAgentEvents(stdout,{limit=100}={}){
 if(typeof stdout!=='string'||!Number.isInteger(limit)||limit<1||limit>1000)throw TypeError('Invalid events');
 return stdout.split('\n').filter(Boolean).slice(0,limit).flatMap(line=>{
  try{const obj=JSON.parse(line);if(!obj||typeof obj!=='object')return [];
   const type=String(obj.type||'unknown').slice(0,100);
   const part=String(obj.part?.type||obj.properties?.type||'').slice(0,100);
   return [{type,part}];
  }catch{return [];}
 }).map(event=>redact(event));
}
