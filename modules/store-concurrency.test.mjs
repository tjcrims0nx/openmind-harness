import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MemoryStore} from './memory.mjs';
import {PluginRegistry} from './plugin-registry.mjs';
import {AgentBus} from './agent-bus.mjs';
import {SkillProposalStore} from './skill-proposals.mjs';
import {withStateLock} from './state-lock.mjs';

async function fixture(fn){
 const dir=await mkdtemp(join(tmpdir(),'omh-multiwriter-'));
 try{return await fn(dir);}
 finally{await rm(dir,{recursive:true,force:true});}
}
test('independent memory clients preserve both concurrent additions',()=>fixture(async d=>{
 const file=join(d,'memory.json');
 const one=await new MemoryStore(file).load(),two=await new MemoryStore(file).load();
 const results=await Promise.all([
  one.add({title:'A',content:'one',approved:true,scope:'project'}),
  two.add({title:'B',content:'two',approved:true,scope:'project'})
 ]);
 const stored=(await new MemoryStore(file).load()).list();
 assert.equal(stored.length,2);
 assert.deepEqual(new Set(stored.map(x=>x.id)),new Set(results.map(x=>x.id)));
}));
test('concurrent mailbox sends do not lose messages',()=>fixture(async d=>{
 const file=join(d,'bus.json');
 const clients=await Promise.all(Array.from({length:8},()=>new AgentBus(file).load()));
 await Promise.all(clients.map((b,i)=>b.send({from:'planner',to:'tester',content:'message-'+i})));
 const inbox=(await new AgentBus(file).load()).inbox('tester');
 assert.equal(inbox.length,8);
 assert.equal(new Set(inbox.map(m=>m.content)).size,8);
}));
test('concurrent plugin manifest updates are serialized and duplicates rejected',()=>fixture(async d=>{
 const file=join(d,'plugins.json');
 const a=await new PluginRegistry(file).load(),b=await new PluginRegistry(file).load();
 await Promise.all([a.register({name:'alpha',version:'1.0.0',approved:true}),
                    b.register({name:'beta',version:'1.0.0',approved:true})]);
 assert.deepEqual(new Set((await new PluginRegistry(file).load()).list().map(p=>p.name)),new Set(['alpha','beta']));
 const results=await Promise.allSettled([a.register({name:'gamma',version:'1.0.0',approved:true}),
                                        b.register({name:'gamma',version:'1.0.0',approved:true})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(results.filter(r=>r.status==='rejected').length,1);
}));
test('only one concurrent skill review can win',()=>fixture(async d=>{
 const file=join(d,'proposals.json');
 const one=await new SkillProposalStore(file).load(),two=await new SkillProposalStore(file).load();
 const proposal=await one.propose({name:'demo-improvement',description:'Safe suggestion',instructions:'Use tests'});
 const results=await Promise.allSettled([
  one.review(proposal.id,{decision:'reject',approved:true}),
  two.review(proposal.id,{decision:'reject',approved:true})
 ]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(results.filter(r=>r.status==='rejected').length,1);
 assert.equal((await new SkillProposalStore(file).load()).list('rejected').length,1);
}));
test('lock exhaustion fails closed instead of overwriting another writer',()=>fixture(async d=>{
 const file=join(d,'shared.json');
 const {open}=await import('node:fs/promises');
 const h=await open(file+'.lock','wx');
 try {
  await assert.rejects(withStateLock(file,async()=>true,{retries:2,delayMs:1}),/State store locked/);
 }finally{await h.close();await rm(file+'.lock',{force:true});}
}));
