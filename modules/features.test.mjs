import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {makeHandlers} from './queue-handlers.mjs';import {sandboxArgs,runSandbox} from './sandbox.mjs';import {validateWorkflow,WorkflowRunner} from './workflows.mjs';import {TaskQueue} from './task-queue.mjs';import {publishSkill} from './skill-studio.mjs';
test('bwrap arguments isolate network and bind workspace',()=>{const a=sandboxArgs({workspace:'/tmp/demo',command:'node',args:['-v']});assert.ok(a.includes('--unshare-all'));assert.ok(!a.includes('--share-net'));assert.ok(a.includes('/workspace'));assert.deepEqual(a.slice(-3),['--','node','-v']);});
test('invalid commands and network denied',()=>{assert.throws(()=>sandboxArgs({workspace:'/tmp/a',command:'bash'}));assert.throws(()=>sandboxArgs({workspace:'/tmp/a',command:'git',network:true}));});
test('workspace write approval and traversal',async()=>{const d=await mkdtemp(join(tmpdir(),'omh-'));try{const h=makeHandlers(d);await assert.rejects(h['workspace.write']({path:'x',content:'hi'}));await assert.rejects(h['workspace.write']({path:'../escape',content:'hi',approved:true}));await h['workspace.write']({path:'x',content:'hi',approved:true});assert.equal(await h['workspace.read']({path:'x'}),'hi');}finally{await rm(d,{recursive:true,force:true});}});
test('workflow performs registered handlers',async()=>{const d=await mkdtemp(join(tmpdir(),'omh-'));try{const q=await new TaskQueue(join(d,'q.json'),{echo:async ({value})=>value}).load();const runner=new WorkflowRunner(q);const a=await runner.executeSequential({name:'demo',steps:[{kind:'echo',input:{value:1}},{kind:'echo',input:{value:2}}]});assert.deepEqual(a.results.map(x=>x.result),[1,2]);}finally{await rm(d,{recursive:true,force:true});}});
test('unknown workflow handler denied',()=>assert.throws(()=>validateWorkflow({name:'bad',steps:[{kind:'shell',input:{}}]},['echo'])));
test('submitted workflows stay ordered across reloads and failed steps', async t => {
 const directory = await mkdtemp(join(tmpdir(), 'omh-'));
 t.after(() => rm(directory, { recursive: true, force: true }));
 const file = join(directory, 'tasks.json');
 let firstAttempts = 0;
 const handlers = { step: async ({ value }) => {
  if(value === 'first' && firstAttempts++ === 0) throw new Error('Try again');
  return value;
 } };
 const producer = new TaskQueue(file, handlers);
 const {taskIds: [first, second]} = await new WorkflowRunner(producer).submit({
  name: 'ordered',
  steps: ['first', 'second'].map(value => ({kind: 'step', input: {value}})),
 });
 const worker = await new TaskQueue(file, handlers).load();
 assert.equal(await worker.runById(second), null);
 assert.equal((await worker.runNext()).status, 'failed');
 const unrelated = await producer.enqueue('step', {value: 'unrelated'});
 assert.equal((await worker.runNext()).id, unrelated.id);
 assert.equal(await worker.runNext(), null);
 await producer.retry(first);
 assert.equal((await worker.runNext()).id, first);
 assert.equal((await worker.runNext()).id, second);
});
test('skill requires approval and creates SKILL.md',async()=>{const d=await mkdtemp(join(tmpdir(),'omh-'));try{await assert.rejects(publishSkill({root:d,name:'demo-skill',description:'Demo',instructions:'Use safely.'}));const r=await publishSkill({root:d,name:'demo-skill',description:'Demo',instructions:'Use safely.',approved:true});assert.ok(r.path.endsWith('SKILL.md'));await assert.rejects(publishSkill({root:d,name:'../escape',description:'Demo',instructions:'X',approved:true}));}finally{await rm(d,{recursive:true,force:true});}});
