import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {TaskQueue} from './task-queue.mjs';

async function fixture(fn){
 const dir=await mkdtemp(join(tmpdir(),'omh-deps-'));
 try{return await fn(join(dir,'queue.json'));}
 finally{await rm(dir,{recursive:true,force:true});}
}
test('failed workflow prerequisite cancels every queued descendant instead of leaving orphan work',()=>fixture(async file=>{
 let didRun=0;
 const queue=await new TaskQueue(file,{
  failing:async()=>{throw Error('intentional failure')},
  followup:async()=>{didRun++;return true;}
 }).load();
 const [first,second,third]=await queue.enqueueSequence([
  {kind:'failing',input:{}},
  {kind:'followup',input:{}},
  {kind:'followup',input:{}}
 ]);
 assert.equal((await queue.runNext()).status,'failed');
 assert.equal(await queue.runNext(),null);
 const fresh=await new TaskQueue(file,queue.handlers).load();
 assert.equal(fresh.list().find(t=>t.id===second.id).status,'cancelled');
 assert.equal(fresh.list().find(t=>t.id===third.id).status,'cancelled');
 assert.match(fresh.list().find(t=>t.id===second.id).error,/Dependency.*failed/);
 assert.equal(didRun,0);
 assert.equal(first.dependsOn,undefined);
}));
test('cancelling queued prerequisite settles dependent workflow tasks',()=>fixture(async file=>{
 const queue=await new TaskQueue(file,{step:async()=>true}).load();
 const [first,second]=await queue.enqueueSequence([{kind:'step',input:{}},{kind:'step',input:{}}]);
 await queue.cancel(first.id);
 assert.equal(await queue.runNext(),null);
 const status=queue.list().find(t=>t.id===second.id);
 assert.equal(status.status,'cancelled');
 assert.match(status.error,/Dependency.*cancelled/);
}));
test('successful prerequisite allows each dependent task to run',()=>fixture(async file=>{
 const queue=await new TaskQueue(file,{step:async({n})=>n}).load();
 const sequence=await queue.enqueueSequence([{kind:'step',input:{n:1}},{kind:'step',input:{n:2}}]);
 assert.equal((await queue.runNext()).result,1);
 assert.equal((await queue.runNext()).result,2);
 assert.ok(queue.list().filter(t=>sequence.some(s=>s.id===t.id)).every(t=>t.status==='completed'));
}));
test('unrelated queued tasks continue after a blocked workflow is cancelled',()=>fixture(async file=>{
 const queue=await new TaskQueue(file,{broken:async()=>{throw Error('boom')},work:async()=>42}).load();
 const steps=await queue.enqueueSequence([{kind:'broken',input:{}},{kind:'work',input:{}}]);
 const unrelated=await queue.enqueue('work',{});
 await queue.runNext();
 const executed=await queue.runNext();
 assert.equal(executed.id,unrelated.id);
 assert.equal(executed.result,42);
 assert.equal(queue.list().find(t=>t.id===steps[1].id).status,'cancelled');
}));
