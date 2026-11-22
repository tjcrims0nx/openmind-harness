import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {addVercelMcp,vercelMcpUrl} from '../scripts/connect-vercel-mcp.mjs';
const exec=promisify(execFile);
const script=new URL('../scripts/connect-vercel-mcp.mjs',import.meta.url).pathname;
test('official Vercel MCP endpoint supports shared and project-scoped OAuth URLs',()=>{
 assert.equal(vercelMcpUrl(),'https://mcp.vercel.com');
 assert.equal(vercelMcpUrl('tjcrims0nx/openmind-harness-live'),'https://mcp.vercel.com/tjcrims0nx/openmind-harness-live');
 assert.throws(()=>vercelMcpUrl('https://attacker.example'),/Invalid/);
 assert.throws(()=>vercelMcpUrl('../bad'),/Invalid/);
 assert.throws(()=>vercelMcpUrl('team/proj?token=secret'),/Invalid/);
});
test('adding Vercel OAuth MCP preserves OMH and existing MCP servers',()=>{
 const original={model:'google/gemini-3.5-flash-lite',mcp:{
  'omh-runtime':{type:'local',command:['node','/opt/omh-mcp.mjs'],enabled:true},
  'other-server':{type:'remote',url:'https://example.com/mcp',enabled:false}
 }};
 const next=addVercelMcp(original,{project:'tjcrims0nx/openmind-harness-live'});
 assert.equal(next.mcp.vercel.type,'remote');
 assert.equal(next.mcp.vercel.url,'https://mcp.vercel.com/tjcrims0nx/openmind-harness-live');
 assert.equal(next.mcp.vercel.enabled,true);
 assert.equal(next.mcp['other-server'].enabled,false);
 assert.deepEqual(next.mcp['omh-runtime'],original.mcp['omh-runtime']);
 assert.equal(original.mcp.vercel,undefined);
});
test('installed configuration can be checked and updated without leaking OAuth secrets',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'omh-vercel-mcp-'));
 try{
  const configDir=join(dir,'custom xdg','opencode');
  await mkdir(configDir,{recursive:true});
  const file=join(configDir,'opencode.json');
  await writeFile(file,JSON.stringify({mcp:{'omh-runtime':{type:'local',command:['node','/opt/omh.mjs']}}}));
  const env={...process.env,XDG_CONFIG_HOME:join(dir,'custom xdg'),HOME:dir};
  const run=(...args)=>exec(process.execPath,[script,...args],{env,timeout:10000});
  const preview=await run('--dry-run','--project','team-name/project-name');
  assert.match(preview.stdout,/https:\/\/mcp.vercel.com\/team-name\/project-name/);
  assert.equal(JSON.parse(await readFile(file,'utf8')).mcp.vercel,undefined);
  await assert.rejects(run('--check','--project','team-name/project-name'));
  await run('--project','team-name/project-name');
  const saved=JSON.parse(await readFile(file,'utf8'));
  assert.equal(saved.mcp.vercel.url,'https://mcp.vercel.com/team-name/project-name');
  assert.equal(saved.mcp['omh-runtime'].type,'local');
  assert.equal(JSON.stringify(saved).includes('client_secret'),false);
  await run('--check','--project','team-name/project-name');
  await assert.rejects(run('--check'));
  await run();
  const global=JSON.parse(await readFile(file,'utf8'));
  assert.equal(global.mcp.vercel.url,'https://mcp.vercel.com');
 }finally{await rm(dir,{recursive:true,force:true});}
});
