import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {EvidenceMcpClient,readEvidenceRegistration,setEvidenceEnabled,EVIDENCE_TOOLS} from './omjb-lifecycle.mjs';

const serverPath=resolve(new URL('../plugins/omjb-mcp/server.mjs',import.meta.url).pathname);

async function fixture({enabled=true,managed=true}={}){
 const root=await mkdtemp(join(tmpdir(),'omh-omjb-lifecycle-'));
 const configDir=join(root,'opencode');
 await mkdir(configDir,{recursive:true});
 const configPath=join(configDir,'opencode.json');
 const db=join(root,'evidence.db');
 await writeFile(db,'');
 const command=managed?[process.execPath,serverPath]:[process.execPath,'/custom/evidence.mjs'];
 const entry=enabled?{type:'local',command,enabled:true,timeout:10000,environment:{OMJB_DB_PATH:db}}:null;
 const config={model:'google/gemini-3.5-flash-lite',mcp:entry?{'omjb-evidence':entry}:{}};
 await writeFile(configPath,JSON.stringify(config));
 const clients=[];
 const client=(opts={})=>{
  const c=new EvidenceMcpClient({configPath,maxRestarts:3,baseDelayMs:10,maxDelayMs:50,pingIntervalMs:60000,rpcTimeoutMs:5000,logger:{error(){ }},...opts});
  clients.push(c);
  return c;
 };
 const cleanup=async()=>{
  for(const c of clients)await c.stop().catch(()=>{});
  await rm(root,{recursive:true,force:true});
 };
 return {root,configPath,db,client,cleanup};
}

async function waitFor(fn,timeoutMs=5000){
 const deadline=Date.now()+timeoutMs;
 for(;;){
  if(await fn())return;
  if(Date.now()>deadline)throw new Error('timed out waiting for condition');
  await new Promise(r=>setTimeout(r,25));
 }
}

function isAlive(pid){
 try{process.kill(pid,0);return true;}catch{return false;}
}

test('lifecycle starts the registered server and reports the five read-only tools',async t=>{
 const {client,cleanup}=await fixture();
 t.after(cleanup);
 const c=client({pingIntervalMs:100});
 const status=await c.start();
 assert.equal(status.state,'connected');
 assert.equal(status.enabled,true);
 assert.equal(status.connected,true);
 assert.deepEqual(status.tools,EVIDENCE_TOOLS);
 assert.equal(typeof status.pid,'number');
 assert.ok(isAlive(status.pid));
 assert.equal(status.dbPath.endsWith('evidence.db'),true);
 await waitFor(()=>c.status().lastPingAt!==null);
 await c.stop();
 assert.equal(c.status().state,'stopped');
 assert.equal(c.status().connected,false);
 assert.equal(isAlive(status.pid),false);
});

test('lifecycle stays disabled without an enabled registration',async t=>{
 const {client,cleanup}=await fixture({enabled:false});
 t.after(cleanup);
 const c=client();
 assert.deepEqual(await c.start(),{...c.status(),state:'disabled'});
 assert.equal(c.status().connected,false);
 assert.equal(c.status().pid,null);
 const {entry}=await readEvidenceRegistration(c.configPath);
 assert.equal(entry,null);
});

test('lifecycle refuses a registration it does not manage',async t=>{
 const {client,cleanup}=await fixture({managed:false});
 t.after(cleanup);
 const c=client();
 const status=await c.start();
 assert.equal(status.state,'failed');
 assert.match(status.lastError,/not installer-managed/);
 assert.equal(status.connected,false);
});

test('lifecycle recovers from an unexpected disconnect with a bounded restart',async t=>{
 const {client,cleanup}=await fixture();
 t.after(cleanup);
 const c=client();
 await c.start();
 assert.equal(c.status().state,'connected');
 const firstPid=c.status().pid;
 process.kill(firstPid,'SIGKILL');
 await waitFor(()=>c.status().state==='connected'&&c.status().pid!==firstPid);
 assert.equal(c.status().restarts,1);
 assert.ok(isAlive(c.status().pid));
 await c.stop();
});

test('lifecycle gives up after the restart limit and stays failed',async t=>{
 const {client,cleanup,root}=await fixture();
 t.after(cleanup);
 // A fake evidence server that answers initialize/tools/list and then dies
 // 50ms after starting, placed at an installer-managed path so the
 // lifecycle will keep trying it. (The timer must be scheduled before the
 // top-level stdin loop, or module evaluation suspends before it runs.)
 const dir=join(root,'plugins','omjb-mcp');
 await mkdir(dir,{recursive:true});
 const dying=join(dir,'server.mjs');
 const tools=EVIDENCE_TOOLS.map(name=>({name,description:'fake',inputSchema:{type:'object',properties:{},required:[],additionalProperties:false}}));
 await writeFile(dying,[
  "import {createInterface} from 'node:readline';",
  'setTimeout(()=>process.exit(1),50);',
  'const lines=createInterface({input:process.stdin,crlfDelay:Infinity});',
  'const tools='+JSON.stringify(tools)+';',
  'for await(const line of lines){',
  ' if(!line.trim())continue;',
  ' let msg;try{msg=JSON.parse(line);}catch{continue;}',
  " if(msg.method==='initialize')process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:msg.id,result:{protocolVersion:'2025-11-25',capabilities:{tools:{listChanged:false}},serverInfo:{name:'openmind-jailbreak-lab-evidence',version:'0.1.0'}}})+'\\n');",
  " else if(msg.method==='tools/list')process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:msg.id,result:{tools}})+'\\n');",
  " else if(msg.method==='ping')process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:msg.id,result:{}})+'\\n');",
  '}',
 ].join('\n'));
 const configPath=join(root,'opencode','opencode.json');
 const config=JSON.parse(await readFile(configPath,'utf8'));
 config.mcp['omjb-evidence'].command=[process.execPath,dying];
 await writeFile(configPath,JSON.stringify(config));
 const c=client({configPath,maxRestarts:2});
 await c.start();
 await waitFor(()=>c.status().state==='failed',8000);
 assert.equal(c.status().restarts,2);
 assert.equal(c.status().connected,false);
 const restarts=c.status().restarts;
 await new Promise(r=>setTimeout(r,500));
 assert.equal(c.status().restarts,restarts,'no restarts after the limit');
 assert.equal(c.status().state,'failed');
});

test('retry resets the failure count and reconnects',async t=>{
 const {client,cleanup}=await fixture();
 t.after(cleanup);
 const c=client();
 await c.start();
 assert.equal(c.status().state,'connected');
 const status=await c.retry();
 assert.equal(status.state,'connected');
 assert.equal(status.restarts,0);
 await c.stop();
});

test('setEvidenceEnabled flips the persisted preference and guards unmanaged entries',async t=>{
 const {configPath,cleanup}=await fixture();
 t.after(cleanup);
 let entry=await setEvidenceEnabled(false,configPath);
 assert.equal(entry.enabled,false);
 entry=await setEvidenceEnabled(true,configPath);
 assert.equal(entry.enabled,true);
 const config=JSON.parse(await readFile(configPath,'utf8'));
 assert.equal(config.mcp['omjb-evidence'].enabled,true);
 // No registration at all.
 const empty=join(configPath,'..','empty.json');
 await writeFile(empty,JSON.stringify({}));
 await assert.rejects(setEvidenceEnabled(true,empty),/enable it with the installer/);
 // Unmanaged registration.
 const custom=join(configPath,'..','custom.json');
 await writeFile(custom,JSON.stringify({mcp:{'omjb-evidence':{type:'local',command:['node','/custom/evidence.mjs'],enabled:true}}}));
 await assert.rejects(setEvidenceEnabled(false,custom),/not installer-managed/);
});

test('relaunch reaps a stale evidence server instead of duplicating it',async t=>{
 const {client,cleanup,root,configPath}=await fixture();
 t.after(cleanup);
 const pidFile=join(root,'opencode','omh-evidence-mcp.pid');
 // A server left behind by a previous OMH run (its parent is gone, but the
 // server survived): spawn it directly and record it as stale.
 const {spawn}=await import('node:child_process');
 const stale=spawn(process.execPath,[serverPath],{stdio:['pipe','pipe','pipe'],env:{...process.env,OMJB_DB_PATH:join(root,'evidence.db')}});
 t.after(()=>{try{stale.kill('SIGKILL');}catch{}});
 await writeFile(pidFile,String(stale.pid));
 assert.ok(isAlive(stale.pid));
 const c=client();
 const status=await c.start();
 assert.equal(status.state,'connected');
 assert.notEqual(status.pid,stale.pid);
 assert.equal(isAlive(stale.pid),false,'stale server must be stopped, not left running');
 assert.ok(isAlive(status.pid));
 assert.equal(Number(await readFile(pidFile,'utf8')),status.pid);
 await c.stop();
 // A pid file pointing at a dead process must not block the next launch.
 await writeFile(pidFile,'999999');
 const again=client();
 assert.equal((await again.start()).state,'connected');
 await again.stop();
});

test('settings and evidence survive a crash and restart unchanged',async t=>{
 const {client,cleanup,root,configPath,db}=await fixture();
 t.after(cleanup);
 let python;
 for(const candidate of ['python3','python']){
  try{execFileSync(candidate,['--version'],{timeout:3000,stdio:'ignore'});python=candidate;break;}catch{}
 }
 if(!python){t.skip('Python 3 is optional for OMH; this test needs it to build a real evidence database');return;}
 const fixtureSql=[
  'import sqlite3,sys',
  'db=sqlite3.connect(sys.argv[1])',
  "db.executescript(\"CREATE TABLE runs(id INTEGER PRIMARY KEY,name TEXT,target TEXT,config TEXT,finished_at REAL); CREATE TABLE results(id INTEGER PRIMARY KEY,run_id INTEGER,probe_id TEXT,detector_label TEXT,bypass INTEGER,prompt TEXT,response TEXT); CREATE TABLE adjudications(id INTEGER PRIMARY KEY,result_id INTEGER,label TEXT,notes TEXT); INSERT INTO runs VALUES(1,'live-run','target','cfg',100); INSERT INTO results VALUES(1,1,'GL-001','review',1,'p','r');\")",
  'db.commit()',
  'db.close()'
 ].join('\n');
 execFileSync(python,['-c',fixtureSql,db],{timeout:5000});
 const configBefore=await readFile(configPath,'utf8');
 const dbBefore=await readFile(db);
 const mtimeBefore=(await stat(db)).mtimeMs;
 const c=client();
 await c.start();
 assert.equal(c.status().state,'connected');
 // Crash the server; the client restarts it with a bounded retry.
 const firstPid=c.status().pid;
 process.kill(firstPid,'SIGKILL');
 await waitFor(()=>c.status().state==='connected'&&c.status().pid!==firstPid);
 await c.stop();
 assert.equal(await readFile(configPath,'utf8'),configBefore,'installer registration must survive a crash and restart');
 assert.deepEqual(await readFile(db),dbBefore,'evidence database content must survive a crash and restart');
 assert.equal((await stat(db)).mtimeMs,mtimeBefore,'evidence database must not be modified');
 // The evidence is still readable through the plugin after the cycle.
 const {queryEvidence}=await import('../plugins/omjb-mcp/server.mjs');
 const oldDb=process.env.OMJB_DB_PATH,oldPy=process.env.OMJB_PYTHON;
 process.env.OMJB_DB_PATH=db;
 process.env.OMJB_PYTHON=python;
 try{
  const status=await queryEvidence('omjb_status');
  assert.deepEqual(status,{configured:true,runs:1,observations:1,read_only:true});
 }finally{
  if(oldDb===undefined)delete process.env.OMJB_DB_PATH;else process.env.OMJB_DB_PATH=oldDb;
  if(oldPy===undefined)delete process.env.OMJB_PYTHON;else process.env.OMJB_PYTHON=oldPy;
 }
});

test('stop removes the pid file and starts no further restarts',async t=>{
 const {client,cleanup,root}=await fixture();
 t.after(cleanup);
 const pidFile=join(root,'opencode','omh-evidence-mcp.pid');
 const c=client();
 await c.start();
 assert.equal(await readFile(pidFile,'utf8'),String(c.status().pid));
 await c.stop();
 await assert.rejects(readFile(pidFile,'utf8'),/ENOENT/);
 const state=c.status().state;
 await new Promise(r=>setTimeout(r,500));
 assert.equal(c.status().state,state,'no restart after stop');
});
