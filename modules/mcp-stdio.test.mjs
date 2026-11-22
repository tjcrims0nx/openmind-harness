import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {resolve} from 'node:path';

test('real MCP stdio subprocess negotiates and denies privileged calls', {timeout:15000}, async t => {
 const child=spawn(process.execPath,[resolve('scripts/omh-mcp.mjs')],{
  cwd:resolve('.'),env:{...process.env,OMH_WORKSPACE:resolve('.')},stdio:['pipe','pipe','pipe']
 });
 let stdout='',stderr='';
 const pending=new Map();
 child.stdout.setEncoding('utf8');
 child.stderr.setEncoding('utf8');
 child.stderr.on('data',chunk=>{stderr+=chunk;});
 child.stdout.on('data',chunk=>{
  stdout+=chunk;
  let index;
  while((index=stdout.indexOf('\n'))!==-1){
   const line=stdout.slice(0,index);stdout=stdout.slice(index+1);
   if(!line.trim())continue;
   let message;
   try{message=JSON.parse(line);}catch(e){for(const entry of pending.values())entry.reject(e);pending.clear();return;}
   const waiter=pending.get(message.id);
   if(waiter){pending.delete(message.id);waiter.resolve(message);}
  }
 });
 const send=(id,method,params)=>new Promise((resolve,reject)=>{
  pending.set(id,{resolve,reject});
  child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n',e=>{if(e){pending.delete(id);reject(e);}});
 });
 t.after(async()=>{
  child.stdin.end();
  if(child.exitCode===null){child.kill('SIGKILL');await once(child,'close').catch(()=>{});}
 });
 const init=await send(1,'initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'omh-stdio-test',version:'1.0.0'}});
 assert.equal(init.result?.serverInfo?.name,'omh-runtime',stderr);
 child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
 const list=await send(2,'tools/list',{});
 const names=list.result?.tools?.map(tool=>tool.name)||[];
 assert.ok(names.includes('omh_memory_search'));
 assert.ok(!names.includes('sandbox.exec'));
 assert.ok(!names.includes('agent.run'));
 const denied=await send(3,'tools/call',{name:'sandbox.exec',arguments:{approved:true}});
 assert.equal(denied.result?.isError,true);
 const injection=await send(4,'tools/call',{name:'omh_queue_read',arguments:{path:'README.md',approved:true}});
 assert.equal(injection.result?.isError,true);
 const ping=await send(5,'ping',{});
 assert.deepEqual(ping.result,{});
});
