import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';

const execFileAsync=promisify(execFile);
const installer=new URL('../scripts/install-omh-runtime.mjs',import.meta.url).pathname;

async function fixture(fn){
 const root=await mkdtemp(join(tmpdir(),'omh-mcp-install-'));
 const configHome=join(root,'custom config with spaces');
 const configDir=join(configHome,'opencode');
 await mkdir(configDir,{recursive:true});
 const file=join(configDir,'opencode.json');
 const original={model:'google/gemini-3.5-flash-lite',mcp:{
  'existing-server':{type:'remote',url:'https://example.invalid/mcp',enabled:false}
 }};
 await writeFile(file,JSON.stringify(original));
 const env={...process.env,XDG_CONFIG_HOME:configHome};
 const run=(...args)=>execFileAsync(process.execPath,[installer,...args],{env,timeout:30000});
 const runEnv=(extra,...args)=>execFileAsync(process.execPath,[installer,...args],{env:{...env,...extra},timeout:30000});
 // An existing (empty) evidence database file: the installer only requires
 // an existing file at OMJB_DB_PATH before enabling the plugin.
 const db=join(root,'evidence.db');
 await writeFile(db,'');
 try{return await fn({root,file,configDir,run,runEnv,db,original});}
 finally{await rm(root,{recursive:true,force:true});}
}

test('installer adds a real absolute MCP command without removing unrelated servers',()=>fixture(async({file,configDir,run})=>{
 const dry=await run('--dry-run');
 assert.match(dry.stdout,/omh-mcp\.mjs/);
 assert.equal((await readFile(file,'utf8')).includes('omh-runtime'),false);
 await run();
 const config=JSON.parse(await readFile(file,'utf8'));
 assert.equal(config.mcp['existing-server'].url,'https://example.invalid/mcp');
 assert.equal(config.mcp['omh-runtime'].type,'local');
 assert.equal(config.mcp['omh-runtime'].enabled,true);
 assert.equal(config.mcp['omh-runtime'].timeout,10000);
 const [node,entry]=config.mcp['omh-runtime'].command;
 assert.equal(node,process.execPath);
 assert.equal(entry,resolve(configDir,'omh-runtime/scripts/omh-mcp.mjs'));
 assert.match(await readFile(entry,'utf8'),/omh_status/);
 assert.match(await readFile(join(configDir,'omh-runtime','lib','omh-chat.mjs'),'utf8'),/export/);
 assert.match(await readFile(join(configDir,'omh-runtime','scripts','omh-dashboard.mjs'),'utf8'),/omh-chat/);
 await run('--check');
 const first=await readFile(file,'utf8');
 await run();
 assert.equal(await readFile(file,'utf8'),first,'Repeated installs must not rewrite unrelated options');
}));

test('verification fails if a copied bridge disappears or a stale command is configured',()=>fixture(async({file,configDir,run})=>{
 await assert.rejects(run('--check'),/registration missing or stale/);
 await run();
 const entry=join(configDir,'omh-runtime','scripts','omh-mcp.mjs');
 await rm(entry);
 await assert.rejects(run('--check'));
 await run();
 await run('--check');
 const cfg=JSON.parse(await readFile(file,'utf8'));
 cfg.mcp['omh-runtime'].command=['node','/wrong/place.mjs'];
 await writeFile(file,JSON.stringify(cfg));
 await assert.rejects(run('--check'),/registration missing or stale/);
}));

// OMJB evidence MCP startup tests (PR #6): the installer must keep the
// read-only evidence plugin disabled unless an operator explicitly opts in,
// persist that preference across restarts, and never touch registrations
// it does not own. The plugin itself must expose only its five read-only
// evidence tools when a client starts it over stdio.

async function readConfig(file){return JSON.parse(await readFile(file,'utf8'));}

async function stdioRpc(command,env,messages,timeoutMs=10000){
 const child=spawn(command[0],command.slice(1),{env,stdio:['pipe','pipe','pipe']});
 const responses=new Map();
 let buffer='';
 const done=new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('evidence MCP did not answer over stdio')),timeoutMs);
  child.stdout.on('data',chunk=>{
   buffer+=chunk;
   let idx;
   while((idx=buffer.indexOf('\n'))>=0){
    const line=buffer.slice(0,idx);buffer=buffer.slice(idx+1);
    if(!line.trim())continue;
    try{const msg=JSON.parse(line);if(msg.id!==undefined)responses.set(msg.id,msg);}catch{}
    if(messages.every(m=>responses.has(m.id))){clearTimeout(timer);resolve();}
   }
  });
  child.on('error',err=>{clearTimeout(timer);reject(err);});
  child.on('exit',()=>{clearTimeout(timer);reject(new Error('evidence MCP exited before answering'));});
 });
 for(const m of messages)child.stdin.write(JSON.stringify(m)+'\n');
 try{await done;return responses;}
 finally{child.kill();await new Promise(r=>child.on('exit',r));}
}

test('evidence MCP is disabled by default on fresh installation',()=>fixture(async({file,run})=>{
 const dry=await run('--dry-run');
 // A fresh dry-run says nothing about the evidence plugin: no entry is
 // proposed (JSON.stringify drops the undefined omjbEvidence key).
 assert.equal(dry.stdout.includes('omjb'),false);
 await run();
 const config=await readConfig(file);
 assert.equal(config.mcp['omjb-evidence'],undefined);
 assert.equal(config.mcp['omh-runtime'].enabled,true);
}));

test('explicit enablement persists across installer restarts',()=>fixture(async({file,run,runEnv,db,configDir})=>{
 await runEnv({OMJB_DB_PATH:db},'--enable-omjb-evidence');
 let config=await readConfig(file);
 assert.equal(config.mcp['omjb-evidence'].enabled,true);
 assert.equal(config.mcp['omjb-evidence'].type,'local');
 assert.equal(config.mcp['omjb-evidence'].timeout,10000);
 const [node,entry]=config.mcp['omjb-evidence'].command;
 assert.equal(node,process.execPath);
 assert.equal(entry,resolve(configDir,'omh-runtime/plugins/omjb-mcp/server.mjs'));
 assert.equal(config.mcp['omjb-evidence'].environment.OMJB_DB_PATH,db);
 // A plain reinstall (a runtime restart) must keep the opt-in intact.
 await run();
 config=await readConfig(file);
 assert.equal(config.mcp['omjb-evidence'].enabled,true);
 assert.equal(config.mcp['omjb-evidence'].environment.OMJB_DB_PATH,db);
 // Enabling again must not duplicate or rewrite the registration.
 await runEnv({OMJB_DB_PATH:db},'--enable-omjb-evidence');
 config=await readConfig(file);
 assert.deepEqual(Object.keys(config.mcp).filter(k=>k==='omjb-evidence'),['omjb-evidence']);
 assert.equal(config.mcp['omjb-evidence'].enabled,true);
}));

test('disablement prevents automatic startup and persists',()=>fixture(async({file,run,runEnv,db})=>{
 await runEnv({OMJB_DB_PATH:db},'--enable-omjb-evidence');
 assert.equal((await readConfig(file)).mcp['omjb-evidence'].enabled,true);
 await run('--disable-omjb-evidence');
 let config=await readConfig(file);
 assert.equal(config.mcp['omjb-evidence'].enabled,false);
 assert.equal(typeof config.mcp['omjb-evidence'].command[1],'string');
 // A plain reinstall must keep the plugin disabled, not re-enable it.
 await run();
 config=await readConfig(file);
 assert.equal(config.mcp['omjb-evidence'].enabled,false);
}));

test('enablement is rejected without an existing evidence database',()=>fixture(async({file,run,runEnv,db})=>{
 // OMJB_DB_PATH unset.
 await assert.rejects(run('--enable-omjb-evidence'),/existing evidence database/);
 assert.equal((await readConfig(file)).mcp['omjb-evidence'],undefined);
 // OMJB_DB_PATH points at a path that does not exist.
 await assert.rejects(runEnv({OMJB_DB_PATH:join(db,'missing.db')},'--enable-omjb-evidence'),/existing evidence database/);
 assert.equal((await readConfig(file)).mcp['omjb-evidence'],undefined);
 // OMJB_DB_PATH points at a directory, not a file.
 await assert.rejects(runEnv({OMJB_DB_PATH:db.replace(/evidence\.db$/,'')},'--enable-omjb-evidence'),/existing evidence database/);
 assert.equal((await readConfig(file)).mcp['omjb-evidence'],undefined);
 // Both flags at once are rejected.
 await assert.rejects(runEnv({OMJB_DB_PATH:db},'--enable-omjb-evidence','--disable-omjb-evidence'),/only one evidence plugin action/);
 assert.equal((await readConfig(file)).mcp['omjb-evidence'],undefined);
}));

test('custom omjb-evidence registrations are never overwritten',()=>fixture(async({file,run,runEnv,db,original})=>{
 const custom={...original,mcp:{...original.mcp,'omjb-evidence':{type:'local',command:['node','/custom/evidence.mjs'],enabled:true,timeout:10000}}};
 await writeFile(file,JSON.stringify(custom));
 await assert.rejects(runEnv({OMJB_DB_PATH:db},'--enable-omjb-evidence'),/not installer-managed/);
 await assert.rejects(run('--disable-omjb-evidence'),/not installer-managed/);
 const config=await readConfig(file);
 assert.deepEqual(config.mcp['omjb-evidence'],custom.mcp['omjb-evidence']);
 // A plain install must leave the custom registration (and unrelated
 // servers) exactly as they were.
 await run();
 const after=await readConfig(file);
 assert.deepEqual(after.mcp['omjb-evidence'],custom.mcp['omjb-evidence']);
 assert.equal(after.mcp['existing-server'].url,'https://example.invalid/mcp');
}));

test('dry-run and check modes never modify plugin configuration',()=>fixture(async({file,run,runEnv,db})=>{
 const before=await readFile(file,'utf8');
 // Dry-run with enablement previews the entry but writes nothing.
 const dry=await runEnv({OMJB_DB_PATH:db},'--dry-run','--enable-omjb-evidence');
 assert.match(dry.stdout,/omjbEvidence/);
 assert.match(dry.stdout,/true/);
 assert.equal(await readFile(file,'utf8'),before);
 // Check mode refuses to change plugin preferences.
 await run();
 const installed=await readFile(file,'utf8');
 await assert.rejects(runEnv({OMJB_DB_PATH:db},'--check','--enable-omjb-evidence'),/Check mode cannot change plugin preferences/);
 assert.equal(await readFile(file,'utf8'),installed);
 // A plain dry-run after install also writes nothing.
 await run('--dry-run');
 assert.equal(await readFile(file,'utf8'),installed);
}));

test('repeated installation does not duplicate the evidence registration',()=>fixture(async({file,run,runEnv,db})=>{
 await runEnv({OMJB_DB_PATH:db},'--enable-omjb-evidence');
 const first=await readConfig(file);
 await run();
 await runEnv({OMJB_DB_PATH:db},'--enable-omjb-evidence');
 await run();
 const config=await readConfig(file);
 assert.deepEqual(Object.keys(config.mcp).filter(k=>k==='omjb-evidence'),['omjb-evidence']);
 assert.deepEqual(config.mcp['omjb-evidence'],first.mcp['omjb-evidence']);
 assert.equal(config.mcp['omh-runtime'].enabled,true);
}));

test('registered evidence server exposes only the five read-only tools over stdio',()=>fixture(async({file,runEnv,db,configDir})=>{
 await runEnv({OMJB_DB_PATH:db},'--enable-omjb-evidence');
 const config=await readConfig(file);
 const entry=config.mcp['omjb-evidence'];
 assert.equal(entry.enabled,true);
 const env={...process.env,...(entry.environment||{})};
 const responses=await stdioRpc(entry.command,env,[
  {jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25'}},
  {jsonrpc:'2.0',id:2,method:'tools/list'},
  {jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'evil_shell',arguments:{}}},
 ]);
 assert.equal(responses.get(1).result.serverInfo.name,'openmind-jailbreak-lab-evidence');
 assert.deepEqual(responses.get(2).result.tools.map(t=>t.name),[
  'omjb_status','omjb_list_runs','omjb_run_summary','omjb_pending_reviews','omjb_compare_runs']);
 assert.equal(responses.get(3).result.isError,true);
 // The installed plugin file is the one the registration points at.
 assert.match(await readFile(entry.command[1],'utf8'),/openmind-jailbreak-lab-evidence/);
}));
