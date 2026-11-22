import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MemoryStore} from './memory.mjs';
import {AgentBus} from './agent-bus.mjs';
import {PluginRegistry} from './plugin-registry.mjs';
import {SkillProposalStore} from './skill-proposals.mjs';
const fixture=async fn=>{const d=await mkdtemp(join(tmpdir(),'omh-purge-'));try{await fn(d);}finally{await rm(d,{recursive:true,force:true});}};
test('deleted memory cannot be resurrected by a stale writer',()=>fixture(async d=>{
 const file=join(d,'memory.json');
 const m=await new MemoryStore(file).load();
 await m.add({title:'old',content:'old secret',approved:true});
 await rm(file);
 await m.add({title:'new',content:'new note',approved:true});
 const fresh=await new MemoryStore(file).load();
 assert.deepEqual(fresh.list().map(x=>x.title),['new']);
}));
test('deleted mailbox cannot be resurrected by stale sender',()=>fixture(async d=>{
 const file=join(d,'bus.json');
 const b=await new AgentBus(file).load();
 await b.send({from:'a',to:'b',content:'old'});
 await rm(file);
 await b.send({from:'a',to:'b',content:'new'});
 assert.deepEqual((await new AgentBus(file).load()).inbox('b').map(x=>x.content),['new']);
}));
test('deleted plugin registry is not rebuilt with old permissions',()=>fixture(async d=>{
 const file=join(d,'plugins.json');
 const store=await new PluginRegistry(file).load();
 await store.register({name:'old-plugin',version:'1.0.0',approved:true});
 await store.enable('old-plugin',{approved:true});
 await rm(file);
 await store.register({name:'new-plugin',version:'1.0.0',approved:true});
 const fresh=await new PluginRegistry(file).load();
 assert.deepEqual(fresh.list().map(x=>x.name),['new-plugin']);
 assert.deepEqual(fresh.allowedCapabilities(),[]);
}));
test('deleted proposal store is not rebuilt with old review material',()=>fixture(async d=>{
 const file=join(d,'proposals.json');
 const store=await new SkillProposalStore(file).load();
 await store.propose({name:'old-note',description:'old',instructions:'private'});
 await rm(file);
 await store.propose({name:'new-note',description:'new',instructions:'safe'});
 assert.deepEqual((await new SkillProposalStore(file).load()).list().map(x=>x.name),['new-note']);
}));
