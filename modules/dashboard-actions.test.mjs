import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {createDashboardServer} from '../scripts/omh-dashboard.mjs';
import {TaskQueue} from './task-queue.mjs';

test('dashboard actions require same-origin anti-CSRF and restrict privileged retries',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'omh-dashboard-actions-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const server=await createDashboardServer(dir);
 server.listen(0,'127.0.0.1');
 await once(server,'listening');
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base='http://127.0.0.1:'+server.address().port;
 const session=await fetch(base+'/api/session');
 assert.equal(session.status,200);
 const {csrf}=await session.json();
 assert.match(csrf,/^[a-f0-9]{64}$/);
 const queue=await new TaskQueue(join(dir,'tasks.json'),{
  'workspace.read':async()=>{throw Error('test missing file')},
  'agent.run':async()=>{throw Error('model service failed')}
 }).load();
 const cancelled=await queue.enqueue('workspace.read',{path:'missing.txt'});
 const failed=await queue.enqueue('workspace.read',{path:'missing.txt'});
 const privileged=await queue.enqueue('agent.run',{approved:true,prompt:'Run agent'});
 await queue.runById(failed.id);
 await queue.runById(privileged.id);
 const send=(endpoint,id,opts={})=>fetch(base+'/api/tasks/'+endpoint,{
  method:'POST',
  headers:{'Content-Type':'application/json','Origin':base,'X-OMH-CSRF':csrf,...opts.headers},
  body:JSON.stringify({id}),
 });
 assert.equal((await fetch(base+'/api/tasks/cancel',{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify({id:cancelled.id})})).status,403);
 assert.equal((await send('cancel',cancelled.id,{headers:{Origin:'https://evil.example'}})).status,403);
 assert.equal((await send('cancel',cancelled.id,{headers:{'X-OMH-CSRF':'invalid'}})).status,403);
 assert.equal((await send('cancel',cancelled.id)).status,200);
 assert.equal((await new TaskQueue(join(dir,'tasks.json')).load()).list().find(x=>x.id===cancelled.id).status,'cancelled');
 assert.equal((await send('cancel',failed.id)).status,409);
 assert.equal((await send('retry',privileged.id)).status,409);
 assert.equal((await send('retry',failed.id)).status,200);
 assert.equal((await new TaskQueue(join(dir,'tasks.json')).load()).list().find(x=>x.id===failed.id).status,'queued');
 assert.equal((await send('retry',failed.id)).status,409);
 assert.equal((await fetch(base+'/api/tasks/retry',{method:'POST',headers:{'Content-Type':'text/plain',Origin:base,'X-OMH-CSRF':csrf},body:'{}'})).status,403);
 assert.equal((await fetch(base+'/api/tasks/cancel',{method:'GET'})).status,404);
});
