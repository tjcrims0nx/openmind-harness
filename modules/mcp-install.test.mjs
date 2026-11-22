import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
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
 try{return await fn({root,file,configDir,run,original});}
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
