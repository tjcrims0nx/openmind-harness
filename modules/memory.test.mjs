import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MemoryStore} from './memory.mjs';
test('approval required',async()=>{const d=await mkdtemp(join(tmpdir(),'omh-'));try{const m=await new MemoryStore(join(d,'m.json')).load();await assert.rejects(m.add({title:'x',content:'y'}),/approval/);}finally{await rm(d,{recursive:true,force:true});}});
test('persist, search, scope, delete',async()=>{const d=await mkdtemp(join(tmpdir(),'omh-'));try{const f=join(d,'m.json');const m=await new MemoryStore(f).load();const a=await m.add({scope:'project',title:'Architecture',content:'isolated jobs',approved:true});await m.add({title:'Other',content:'text',approved:true});const n=await new MemoryStore(f).load();assert.equal(n.search('isolated',{scope:'project'}).length,1);assert.equal(n.search('isolated',{scope:'global'}).length,0);await n.remove(a.id);assert.equal((await new MemoryStore(f).load()).list().length,1);}finally{await rm(d,{recursive:true,force:true});}});
test('bounded and detached',async()=>{const d=await mkdtemp(join(tmpdir(),'omh-'));try{const m=await new MemoryStore(join(d,'m.json'),{maxEntries:1}).load();await m.add({title:'A',content:'a',approved:true});await m.add({title:'B',content:'b',approved:true});const x=m.list();x[0].title='changed';assert.equal(m.list()[0].title,'B');}finally{await rm(d,{recursive:true,force:true});}});
