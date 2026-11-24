import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import test from 'node:test';
import {createDashboardServer,startDashboardServer} from '../scripts/omh-dashboard.mjs';
import {EvidenceMcpClient,EVIDENCE_TOOLS} from './omjb-lifecycle.mjs';

const serverPath=resolve(new URL('../plugins/omjb-mcp/server.mjs',import.meta.url).pathname);
const ADMIN_TOKEN='test-admin-token-for-omjb-dashboard-0123456789';

async function waitFor(fn,timeoutMs=5000){
 const deadline=Date.now()+timeoutMs;
 for(;;){
  if(await fn())return;
  if(Date.now()>deadline)throw new Error('timed out waiting for condition');
  await new Promise(r=>setTimeout(r,25));
 }
}

test('dashboard reports evidence MCP health and controls its lifecycle',async t=>{
 const root=await mkdtemp(join(tmpdir(),'omh-omjb-dashboard-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const configDir=join(root,'opencode');
 await mkdir(configDir,{recursive:true});
 const configPath=join(configDir,'opencode.json');
 const db=join(root,'evidence.db');
 await writeFile(db,'');
 await writeFile(configPath,JSON.stringify({mcp:{'omjb-evidence':{
  type:'local',command:[process.execPath,serverPath],enabled:true,timeout:10000,environment:{OMJB_DB_PATH:db}}}}));
 const state=join(root,'state');
 await mkdir(state,{recursive:true});
 const client=new EvidenceMcpClient({configPath,maxRestarts:3,baseDelayMs:10,maxDelayMs:50,pingIntervalMs:60000,rpcTimeoutMs:5000,logger:{error(){}}});
 t.after(()=>client.stop().catch(()=>{}));
 const server=await createDashboardServer(state,{adminToken:ADMIN_TOKEN,evidenceMcp:client});
 server.listen(0,'127.0.0.1');
 await once(server,'listening');
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base='http://127.0.0.1:'+server.address().port;
 const {csrf}=await (await fetch(base+'/api/session')).json();
 const post=(endpoint,admin=false)=>fetch(base+endpoint,{
  method:'POST',
  headers:{'Content-Type':'application/json','Origin':base,'X-OMH-CSRF':csrf,...(admin?{'X-OMH-Admin-Token':ADMIN_TOKEN}:{})},
  body:'{}',
 });
 // OMH launch: the dashboard starts the enabled evidence MCP.
 await client.start();
 assert.equal(client.status().state,'connected');
 let data=await (await fetch(base+'/api/state')).json();
 assert.equal(data.evidenceMcp.state,'connected');
 assert.equal(data.evidenceMcp.enabled,true);
 assert.deepEqual(data.evidenceMcp.tools,EVIDENCE_TOOLS);
 assert.equal(data.evidenceMcp.dbPath,db);
 let status=await (await fetch(base+'/api/plugins/omjb')).json();
 assert.equal(status.state,'connected');
 // An unexpected disconnect recovers with a bounded restart.
 const firstPid=status.pid;
 process.kill(firstPid,'SIGKILL');
 await waitFor(()=>client.status().state==='connected'&&client.status().pid!==firstPid);
 status=await (await fetch(base+'/api/plugins/omjb')).json();
 assert.equal(status.state,'connected');
 assert.equal(status.restarts,1);
 // Manual retry works without an admin token.
 assert.equal((await post('/api/plugins/omjb/retry')).status,200);
 assert.equal((await (await fetch(base+'/api/plugins/omjb')).json()).state,'connected');
 // CSRF and origin are enforced on the lifecycle actions.
 assert.equal((await fetch(base+'/api/plugins/omjb/retry',{method:'POST',headers:{'Content-Type':'application/json','Origin':base},body:'{}'})).status,403);
 assert.equal((await fetch(base+'/api/plugins/omjb/retry',{method:'POST',headers:{'Content-Type':'application/json','Origin':'https://evil.example','X-OMH-CSRF':csrf},body:'{}'})).status,403);
 // Disable stops the server and persists the preference.
 const disabled=await post('/api/plugins/omjb/disable');
 assert.equal(disabled.status,200);
 assert.equal((await disabled.json()).state,'disabled');
 assert.equal(client.status().connected,false);
 assert.equal(JSON.parse(await readFile(configPath,'utf8')).mcp['omjb-evidence'].enabled,false);
 // Enable is privileged: it needs the admin token.
 assert.equal((await post('/api/plugins/omjb/enable')).status,403);
 const enabled=await post('/api/plugins/omjb/enable',true);
 assert.equal(enabled.status,200);
 assert.equal((await enabled.json()).state,'connected');
 assert.equal(JSON.parse(await readFile(configPath,'utf8')).mcp['omjb-evidence'].enabled,true);
 // Clean shutdown with OMH: stop kills the server process.
 const pid=client.status().pid;
 await client.stop();
 assert.equal(client.status().state,'stopped');
 try{process.kill(pid,0);assert.fail('evidence server should be gone after stop');}catch(error){assert.equal(error.code,'ESRCH');}
});

test('a second dashboard on a taken port spawns no duplicate evidence server',async t=>{
 const root=await mkdtemp(join(tmpdir(),'omh-omjb-port-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const configDir=join(root,'opencode');
 await mkdir(configDir,{recursive:true});
 const configPath=join(configDir,'opencode.json');
 const db=join(root,'evidence.db');
 await writeFile(db,'');
 await writeFile(configPath,JSON.stringify({mcp:{'omjb-evidence':{
  type:'local',command:[process.execPath,serverPath],enabled:true,timeout:10000,environment:{OMJB_DB_PATH:db}}}}));
 const pidFile=join(configDir,'omh-evidence-mcp.pid');
 const state=join(root,'state');
 await mkdir(state,{recursive:true});
 const firstClient=new EvidenceMcpClient({configPath,maxRestarts:3,baseDelayMs:10,maxDelayMs:50,pingIntervalMs:60000,rpcTimeoutMs:5000,logger:{error(){}}});
 t.after(()=>firstClient.stop().catch(()=>{}));
 const first=await startDashboardServer(state,{port:0,evidenceMcp:firstClient});
 t.after(()=>new Promise(resolve=>first.server.close(resolve)));
 const port=first.server.address().port;
 assert.equal(first.evidence.status().state,'connected');
 // A second launch on the same port must fail before starting its own MCP.
 const secondClient=new EvidenceMcpClient({configPath,maxRestarts:3,baseDelayMs:10,maxDelayMs:50,pingIntervalMs:60000,rpcTimeoutMs:5000,logger:{error(){}}});
 t.after(()=>secondClient.stop().catch(()=>{}));
 await assert.rejects(startDashboardServer(state,{port,evidenceMcp:secondClient}),/EADDRINUSE/);
 assert.equal(secondClient.status().state,'disabled');
 assert.equal(secondClient.status().pid,null);
 assert.equal(Number(await readFile(pidFile,'utf8')),first.evidence.status().pid,'only the first dashboard owns an evidence server');
 await first.evidence.stop();
});
