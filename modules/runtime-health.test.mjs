import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readHeartbeat,writeHeartbeat,clearHeartbeat} from './runtime-health.mjs';

const dir=async(fn)=>{const d=await mkdtemp(join(tmpdir(),'omh-health-'));try{return await fn(d);}finally{await rm(d,{recursive:true,force:true});}};
test('worker health rejects absent, stale, malformed and future heartbeat values',()=>dir(async d=>{
 const file=join(d,'heartbeat.json');
 assert.equal((await readHeartbeat(file)).online,false);
 await writeHeartbeat(file,{pid:123,at:1000});
 assert.equal((await readHeartbeat(file,{now:25000,staleMs:2000})).reason,'stale-heartbeat');
 await writeHeartbeat(file,{pid:123,at:30000});
 assert.equal((await readHeartbeat(file,{now:20000,staleMs:2000})).reason,'stale-heartbeat');
 await writeHeartbeat(file,{pid:123,at:20000});
 assert.equal((await readHeartbeat(file,{now:21000,staleMs:2000})).online,true);
 await writeFile(file,'{broken');
 assert.equal((await readHeartbeat(file)).reason,'status-unavailable');
 await clearHeartbeat(file);
 assert.equal((await readHeartbeat(file)).reason,'worker-not-started');
}));
test('daemon creates and removes a real heartbeat on clean shutdown',()=>dir(async d=>{
 const state=join(d,'state');
 const child=spawn(process.execPath,[new URL('../scripts/omh-daemon.mjs',import.meta.url).pathname],{
  cwd:d,env:{...process.env,OMH_WORKSPACE:d,OMH_STATE_DIR:state,OMH_TICK_MS:'1000'},
  stdio:['ignore','ignore','pipe']
 });
 let stderr='';
 child.stderr.on('data',chunk=>{stderr+=chunk;});
 const exit=new Promise(resolve=>child.once('close',resolve));
 try{
  let online=false;
  for(let i=0;i<80;i++){
   if(child.exitCode!==null)throw Error('Daemon exited prematurely: '+stderr);
   online=(await readHeartbeat(join(state,'daemon-health.json'))).online;
   if(online)break;
   await delay(100);
  }
  assert.equal(online,true,stderr);
  child.kill('SIGTERM');
  const code=await Promise.race([exit,delay(7000).then(()=>{throw Error('Daemon shutdown timed out');})]);
  assert.equal(code,0,stderr);
  assert.equal((await readHeartbeat(join(state,'daemon-health.json'))).online,false);
  await assert.rejects(readFile(join(state,'daemon.lock')),{code:'ENOENT'});
 }finally{
  if(child.exitCode===null)child.kill('SIGKILL');
  await exit;
 }
}));
