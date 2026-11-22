import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {TaskQueue} from './task-queue.mjs';

async function fixture(fn) {
 const d=await mkdtemp(join(tmpdir(),'omh-control-'));
 try {return await fn(join(d,'tasks.json'));}
 finally {await rm(d,{recursive:true,force:true});}
}
test('queued cancellation persists and is never executed',()=>fixture(async file=>{
 let calls=0;
 const q=await new TaskQueue(file,{work:async()=>{calls++;return true;}}).load();
 const job=await q.enqueue('work',{});
 assert.equal((await q.cancel(job.id)).status,'cancelled');
 assert.equal(await q.runNext(),null);
 assert.equal(calls,0);
 assert.equal((await new TaskQueue(file,{work:async()=>true}).load()).list()[0].status,'cancelled');
}));
test('running tasks reject metadata-only cancellation',()=>fixture(async file=>{
 let resume;
 let entered;
 const started=new Promise(r=>entered=r);
 const waiting=new Promise(r=>resume=r);
 const q=await new TaskQueue(file,{work:async()=>{entered();await waiting;return 'ok';}}).load();
 const job=await q.enqueue('work',{});
 const running=q.runById(job.id);
 await started;
 await assert.rejects(q.cancel(job.id),/running task/);
 resume();
 assert.equal((await running).status,'completed');
}));
test('a second queue can request cancellation and the worker confirms it',()=>fixture(async file=>{
 let entered;
 const started=new Promise(resolve=>{entered=resolve;});
 const handler=Object.assign(async (_input,{signal})=>{
  entered();
  await new Promise((_,reject)=>{
   signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
  });
 },{cancellable:true});
 const worker=new TaskQueue(file,{work:handler});
 const client=new TaskQueue(file);
 const task=await worker.enqueue('work');
 const running=worker.runNext();
 await started;
 const requested=await client.cancel(task.id);
 assert.equal(requested.status,'running');
 assert.ok(requested.cancelRequestedAt);
 const finished=await running;
 assert.equal(finished.status,'cancelled');
 assert.ok(finished.finishedAt);
 assert.equal((await client.load()).list()[0].status,'cancelled');
}));
test('a handler that completed during a cancellation request keeps its result',()=>fixture(async file=>{
 let entered,resume;
 const started=new Promise(resolve=>{entered=resolve;});
 const waiting=new Promise(resolve=>{resume=resolve;});
 const handler=Object.assign(async ()=>{
  entered();
  await waiting;
  return 'written';
 },{cancellable:true});
 const worker=new TaskQueue(file,{work:handler});
 const task=await worker.enqueue('work');
 const running=worker.runNext();
 await started;
 await new TaskQueue(file).cancel(task.id);
 resume();
 const finished=await running;
 assert.equal(finished.status,'completed');
 assert.equal(finished.result,'written');
}));
test('failed task can retry at most requested count',()=>fixture(async file=>{
 let attempts=0;
 const q=await new TaskQueue(file,{work:async()=>{attempts++;throw Error('fail');}}).load();
 const job=await q.enqueue('work');
 assert.equal((await q.runNext()).status,'failed');
 assert.equal((await q.retry(job.id)).status,'queued');
 assert.equal((await q.runNext()).status,'failed');
 await assert.rejects(q.retry(job.id,{maxAttempts:2}),/Retry limit reached/);
 assert.equal(attempts,2);
 assert.equal((await new TaskQueue(file,{work:async()=>{}}).load()).list()[0].status,'failed');
}));
test('only failed tasks retry; unknown task returns null',()=>fixture(async file=>{
 const q=await new TaskQueue(file,{echo:async()=>1}).load();
 const job=await q.enqueue('echo');
 await assert.rejects(q.retry(job.id),/Only failed/);
 assert.equal(await q.cancel('missing'),null);
 assert.equal(await q.retry('missing'),null);
 assert.equal((await q.cancel(job.id)).status,'cancelled');
 await assert.rejects(q.retry(job.id),/Only failed/);
}));
test('two loaded queue instances cannot both claim one task',()=>fixture(async file=>{
 let count=0;
 const handler=async()=>{count++;return 'done';};
 const a=await new TaskQueue(file,{work:handler}).load();
 const b=await new TaskQueue(file,{work:handler}).load();
 const job=await a.enqueue('work');
 const [ra,rb]=await Promise.all([a.runById(job.id),b.runById(job.id)]);
 assert.equal(count,1);
 assert.equal([ra,rb].filter(x=>x?.status==='completed').length,1);
}));
