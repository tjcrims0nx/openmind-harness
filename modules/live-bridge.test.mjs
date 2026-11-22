import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createLiveBridge} from '../scripts/omh-live.mjs';
import {TaskQueue} from './task-queue.mjs';
import {PluginRegistry} from './plugin-registry.mjs';
import {SkillProposalStore} from './skill-proposals.mjs';
import {Scheduler} from './scheduler.mjs';

const token='test-only-live-token-'.repeat(3);
async function fixture(fn){
 const root=await mkdtemp(join(tmpdir(),'omh-live-'));
 const state=join(root,'.omh');
 const server=createLiveBridge({state,token});
 try{
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  const base='http://127.0.0.1:'+server.address().port;
  const fetchApi=(path,options={})=>fetch(base+path,{...options,headers:{Authorization:'Bearer '+token,...options.headers}});
  await fn({root,state,base,fetchApi});
 }finally{await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});}
}

test('live gateway requires long secret and rejects unauthorized access and origins',async()=>{
 assert.throws(()=>createLiveBridge({token:'weak'}),/at least 32 bytes/);
 await fixture(async({base,fetchApi})=>{
  assert.equal((await fetch(base+'/api/state')).status,401);
  assert.equal((await fetch(base+'/mcp',{method:'POST',headers:{Authorization:'Bearer invalid','Content-Type':'application/json'},body:'{}'})).status,401);
  assert.equal((await fetchApi('/api/state',{headers:{Origin:'https://untrusted.example'}})).status,403);
  assert.equal((await fetchApi('/health')).status,200);
 });
});

test('live remote state is actual local state and actions cancel queued work',()=>fixture(async({state,fetchApi})=>{
 const q=await new TaskQueue(join(state,'tasks.json'),{'workspace.read':async()=>true}).load();
 const task=await q.enqueue('workspace.read',{path:'README.md'});
 const stateResponse=await fetchApi('/api/state');
 assert.equal(stateResponse.status,200);
 const snapshot=await stateResponse.json();
 assert.equal(snapshot.counts.queued,1);
 assert.equal(snapshot.adminActionsAvailable,false);
 assert.equal(snapshot.tasks[0].id,task.id);
 const action=await fetchApi('/api/actions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'cancel',id:task.id})});
 assert.equal(action.status,200);
 assert.equal((await action.json()).status,'cancelled');
 assert.equal((await new TaskQueue(join(state,'tasks.json')).load()).list()[0].status,'cancelled');
 assert.equal((await fetchApi('/api/actions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'agent.run',id:task.id})})).status,403);
 assert.equal((await fetchApi('/api/actions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'enable',name:'test'})})).status,403);
}));

test('remote gateway exposes MCP initialization and safe tool list without execution',()=>fixture(async({fetchApi})=>{
 const post=payload=>fetchApi('/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
 const initialized=await post({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25'}});
 assert.equal(initialized.status,200);
 assert.equal((await initialized.json()).result.serverInfo.name,'omh-runtime');
 const tools=await(await post({jsonrpc:'2.0',id:2,method:'tools/list'})).json();
 assert.ok(tools.result.tools.some(t=>t.name==='omh_status'));
 assert.ok(!tools.result.tools.some(t=>t.name==='sandbox.exec'));
 const rejected=await(await post({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'sandbox.exec',arguments:{approved:true}}})).json();
 assert.equal(rejected.result.isError,true);
 assert.equal((await post({jsonrpc:'2.0',method:'notifications/initialized'})).status,202);
}));

test('remote governance only permits downward safety controls',()=>fixture(async({state,fetchApi})=>{
 const plugins=await new PluginRegistry(join(state,'plugins.json')).load();
 await plugins.register({name:'example-plugin',version:'1.0',approved:true});
 await plugins.enable('example-plugin',{approved:true});
 const proposal=await(await new SkillProposalStore(join(state,'skill-proposals.json')).load()).propose({
  name:'safe-review',description:'Review',instructions:'Review changes'
 });
 const queue=await new TaskQueue(join(state,'tasks.json'),{'workspace.read':async()=>true}).load();
 const schedule=await(await new Scheduler(join(state,'schedules.json'),queue).load()).add({kind:'workspace.read',input:{path:'README.md'},everyMs:60000});
 const post=(action,rest)=>fetchApi('/api/actions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...rest})});
 assert.equal((await post('disable',{name:'example-plugin'})).status,200);
 assert.equal((await post('reject',{id:proposal.id})).status,200);
 assert.equal((await post('pause',{id:schedule.id})).status,200);
 assert.equal((await post('accept',{id:proposal.id})).status,403);
 assert.equal((await post('resume',{id:schedule.id})).status,403);
}));
