import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDashboardServer} from '../scripts/omh-dashboard.mjs';
import {Scheduler} from './scheduler.mjs';
import {TaskQueue} from './task-queue.mjs';
import {PluginRegistry} from './plugin-registry.mjs';
import {SkillProposalStore} from './skill-proposals.mjs';

const key='administrator-secret-'.repeat(3);
async function fixture(fn,adminToken){
 const root=await mkdtemp(join(tmpdir(),'omh-admin-'));
 const server=await createDashboardServer(root,{workspace:root,adminToken});
 try{
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const base='http://127.0.0.1:'+server.address().port;
  const csrf=(await (await fetch(base+'/api/session')).json()).csrf;
  return await fn({root,base,csrf,send:(route,payload,{token=key,origin=base}={})=>fetch(base+route,{
   method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-OMH-CSRF':csrf,'X-OMH-Admin-Token':token},
   body:JSON.stringify(payload)
  })});
 }finally{await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});}
}
test('privileged dashboard actions are disabled by default',()=>fixture(async({root,base,csrf,send})=>{
 const state=await(await fetch(base+'/api/state')).json();
 assert.equal(state.adminActionsAvailable,false);
 const response=await send('/api/plugins/enable',{name:'example'});
 assert.equal(response.status,403);
},undefined));
test('dashboard rejects short administrator credentials at startup',async()=>{
 const root=await mkdtemp(join(tmpdir(),'omh-admin-'));
 try{await assert.rejects(createDashboardServer(root,{adminToken:'short'}),/at least 32 bytes/);}
 finally{await rm(root,{recursive:true,force:true});}
});
test('administrator token authorizes only explicit governance actions',()=>fixture(async({root,base,send})=>{
 const queue=new TaskQueue(join(root,'tasks.json'),{'workspace.read':async()=>true});
 const schedule=await new Scheduler(join(root,'schedules.json'),queue).add({kind:'workspace.read',input:{path:'README.md'},everyMs:60000});
 await (new Scheduler(join(root,'schedules.json'),queue)).pause(schedule.id);
 const registry=await new PluginRegistry(join(root,'plugins.json')).load();
 await registry.register({name:'review-plugin',version:'1.0.0',approved:true});
 const proposal=await (new SkillProposalStore(join(root,'skill-proposals.json')).load()).propose({
  name:'review-task',description:'Reviewed safe checklist',instructions:'Review tests before merging'
 });
 assert.equal((await send('/api/plugins/enable',{name:'review-plugin'},{token:'incorrect-credential'.repeat(3)})).status,403);
 assert.equal((await send('/api/plugins/enable',{name:'review-plugin'},{origin:'https://attacker.example'})).status,403);
 assert.equal((await send('/api/plugins/enable',{name:'review-plugin'})).status,200);
 assert.equal((await new PluginRegistry(join(root,'plugins.json')).load()).list()[0].enabled,true);
 assert.equal((await send('/api/schedules/resume',{id:schedule.id})).status,200);
 assert.equal((await new Scheduler(join(root,'schedules.json'),queue).load()).list()[0].enabled,true);
 assert.equal((await send('/api/skills/accept',{id:proposal.id})).status,200);
 assert.match(await readFile(join(root,'skills','review-task','SKILL.md'),'utf8'),/Review tests before merging/);
 assert.equal((await send('/api/skills/accept',{id:proposal.id})).status,409);
 assert.equal((await send('/api/plugins/enable',{name:'review-plugin'})).status,409);
 assert.equal((await send('/api/schedules/resume',{id:schedule.id})).status,409);
 const serialized=JSON.stringify(await (await fetch(base+'/api/state')).json());
 assert.doesNotMatch(serialized,/administrator-secret/);
 assert.equal((await send('/api/agent/run',{prompt:'hi',approved:true})).status,405);
},key));
