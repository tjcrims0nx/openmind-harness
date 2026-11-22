import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import {MemoryStore} from './memory.mjs';import {prepareAgentTask,summarizeAgentEvents} from './agent-integration.mjs';
test('native agent routing chooses healthy candidate',async()=>{const x=await prepareAgentTask({prompt:'hello',routing:{candidates:[{id:'google/model',healthy:true,costPerMillion:1,latencyMs:1,quality:0.5}],options:{mode:'balanced'}}},{workspace:'/tmp'});assert.equal(x.model,'google/model');});
test('memory opt-in inserts approved scoped notes only',async()=>{const d=await mkdtemp(join(tmpdir(),'omh-'));try{const m=await new MemoryStore(join(d,'.omh','memory.json')).load();await m.add({scope:'project',title:'Style',content:'ES modules',approved:true});await m.add({scope:'private',title:'Secret',content:'not included',approved:true});const a=await prepareAgentTask({prompt:'code',useMemory:true},{workspace:d});assert.ok(a.prompt.includes('ES modules'));assert.ok(!a.prompt.includes('not included'));const b=await prepareAgentTask({prompt:'code'},{workspace:d});assert.equal(b.prompt,'code');}finally{await rm(d,{recursive:true,force:true});}});
test('agent trace summary does not include prompt or raw text',()=>{const rows=summarizeAgentEvents('{"type":"step","part":{"type":"tool","text":"secret"}}\ninvalid\n');assert.deepEqual(rows,[{type:'step',part:'tool'}]);});

test('agent memory uses the runtime state directory selected by the worker', async t => {
 const workspace = await mkdtemp(join(tmpdir(), 'omh-project-'));
 const stateDir = await mkdtemp(join(tmpdir(), 'omh-state-'));
 t.after(() => Promise.all([workspace, stateDir].map(dir => rm(dir, {recursive: true, force: true}))));
 const stored = new MemoryStore(join(stateDir, 'memory.json'));
 await stored.add({scope: 'project', title: 'Format', content: 'exported convention', approved: true});
 const local = new MemoryStore(join(workspace, '.omh', 'memory.json'));
 await local.add({scope: 'project', title: 'Different state', content: 'unselected convention', approved: true});
 const task = await prepareAgentTask({prompt: 'Review', useMemory: true}, {workspace, stateDir});
 assert.match(task.prompt, /exported convention/);
 assert.doesNotMatch(task.prompt, /unselected convention/);
});
