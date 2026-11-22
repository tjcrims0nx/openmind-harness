import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {createDashboardServer} from '../scripts/omh-dashboard.mjs';
import {Scheduler} from './scheduler.mjs';
import {TaskQueue} from './task-queue.mjs';
import {PluginRegistry} from './plugin-registry.mjs';
import {SkillProposalStore} from './skill-proposals.mjs';

test('dashboard governance can pause, disable, or reject but cannot grant privileges',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'omh-gov-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const queue=await new TaskQueue(join(dir,'tasks.json'),{'workspace.read':async()=>true}).load();
 const scheduler=await new Scheduler(join(dir,'schedules.json'),queue).load();
 const schedule=await scheduler.add({kind:'workspace.read',input:{path:'README.md'},everyMs:60000});
 const plugins=await new PluginRegistry(join(dir,'plugins.json')).load();
 await plugins.register({name:'review-tools',version:'1.0.0',approved:true});
 await plugins.enable('review-tools',{approved:true});
 const proposals=await new SkillProposalStore(join(dir,'skill-proposals.json')).load();
 const proposal=await proposals.propose({name:'review-check',description:'Review checklist',instructions:'Keep tests green'});
 const server=await createDashboardServer(dir);
 server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base='http://127.0.0.1:'+server.address().port;
 const csrf=(await (await fetch(base+'/api/session')).json()).csrf;
 const post=(path,payload,headers={})=>fetch(base+path,{method:'POST',
  headers:{'Content-Type':'application/json',Origin:base,'X-OMH-CSRF':csrf,...headers},
  body:JSON.stringify(payload)});
 assert.equal((await post('/api/schedules/pause',{id:schedule.id},{Origin:'https://untrusted.test'})).status,403);
 assert.equal((await post('/api/schedules/pause',{id:schedule.id})).status,200);
 assert.equal((await post('/api/schedules/pause',{id:schedule.id})).status,409);
 assert.equal((await new Scheduler(join(dir,'schedules.json'),queue).load()).list()[0].enabled,false);
 assert.equal((await post('/api/plugins/disable',{name:'review-tools'})).status,200);
 assert.equal((await post('/api/plugins/disable',{name:'review-tools'})).status,409);
 assert.equal((await new PluginRegistry(join(dir,'plugins.json')).load()).list()[0].enabled,false);
 assert.equal((await post('/api/skills/reject',{id:proposal.id})).status,200);
 assert.equal((await post('/api/skills/reject',{id:proposal.id})).status,409);
 assert.equal((await new SkillProposalStore(join(dir,'skill-proposals.json')).load()).list()[0].status,'rejected');
 assert.equal((await post('/api/plugins/enable',{name:'review-tools'})).status,405);
 assert.equal((await post('/api/skills/accept',{id:proposal.id})).status,405);
 assert.equal((await post('/api/schedules/pause',{id:'../wrong'})).status,400);
});
