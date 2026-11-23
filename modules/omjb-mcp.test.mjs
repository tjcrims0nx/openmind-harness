import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {handleRPC,queryEvidence} from '../plugins/omjb-mcp/server.mjs';
const request=(id,method,params)=>handleRPC({jsonrpc:'2.0',id,method,params});

test('OMJB MCP exposes five read-only evidence functions with strict arguments',async()=>{
 const init=await request(1,'initialize',{protocolVersion:'2025-11-25'});
 assert.equal(init.result.serverInfo.name,'openmind-jailbreak-lab-evidence');
 const list=await request(2,'tools/list',{});
 assert.deepEqual(list.result.tools.map(t=>t.name),[
  'omjb_status','omjb_list_runs','omjb_run_summary','omjb_pending_reviews','omjb_compare_runs']);
 for(const tool of list.result.tools)assert.equal(tool.inputSchema.additionalProperties,false);
 assert.equal((await request(3,'tools/call',{name:'omjb_run_summary',arguments:{run_id:1,command:'bash'}})).result.isError,true);
 assert.equal((await request(4,'tools/call',{name:'omjb_compare_runs',arguments:{baseline_id:0,candidate_id:1}})).result.isError,true);
 assert.equal((await request(5,'tools/call',{name:'omjb_run_summary',arguments:{run_id:'1'}})).result.isError,true);
 assert.equal((await request(6,'tools/call',{name:'evil_shell',arguments:{}})).result.isError,true);
 assert.deepEqual((await request(7,'ping',{})).result,{});
 assert.equal(await handleRPC({jsonrpc:'2.0',method:'notifications/initialized'}),null);
});

test('OMJB MCP is disabled without explicit evidence database',async()=>{
 const old=process.env.OMJB_DB_PATH;
 delete process.env.OMJB_DB_PATH;
 try{
  const result=await queryEvidence('omjb_status');
  assert.equal(result.configured,false);
 }finally{if(old===undefined)delete process.env.OMJB_DB_PATH;else process.env.OMJB_DB_PATH=old;}
});

test('OMJB MCP reports aggregates without exporting prompts, responses or notes',async t=>{
 let python;
 for(const candidate of ['python3','python']){
  try{execFileSync(candidate,['--version'],{timeout:3000,stdio:'ignore'});python=candidate;break;}catch{}
 }
 if(!python){t.skip('Python 3 is optional for OMH; this integration requires it');return;}
 const dir=await mkdtemp(join(tmpdir(),'omjb-mcp-test-'));
 const db=join(dir,'evidence.db');
 const oldDb=process.env.OMJB_DB_PATH,oldPy=process.env.OMJB_PYTHON;
 t.after(async()=>{
  if(oldDb===undefined)delete process.env.OMJB_DB_PATH;else process.env.OMJB_DB_PATH=oldDb;
  if(oldPy===undefined)delete process.env.OMJB_PYTHON;else process.env.OMJB_PYTHON=oldPy;
  await rm(dir,{recursive:true,force:true});
 });
 const fixture=[
  'import sqlite3,sys',
  'db=sqlite3.connect(sys.argv[1])',
  "db.executescript(\"\"\"CREATE TABLE runs(id INTEGER PRIMARY KEY,name TEXT,target TEXT,config TEXT,finished_at REAL); CREATE TABLE results(id INTEGER PRIMARY KEY,run_id INTEGER,probe_id TEXT,detector_label TEXT,bypass INTEGER,prompt TEXT,response TEXT); CREATE TABLE adjudications(id INTEGER PRIMARY KEY,result_id INTEGER,label TEXT,notes TEXT); INSERT INTO runs VALUES(1,'PRIVATE_SECRET','target','secret_token',100); INSERT INTO runs VALUES(2,'PRIVATE_SECRET','target','secret_token',100); INSERT INTO results VALUES(1,1,'GL-001','review',1,'SENSITIVE_PROMPT','SENSITIVE_RESPONSE'); INSERT INTO results VALUES(2,2,'GL-001','refusal',0,'SENSITIVE_PROMPT','SENSITIVE_RESPONSE'); INSERT INTO adjudications VALUES(1,1,'unclear','PRIVATE_REVIEW_NOTES');\"\"\")",
  'db.commit()',
  'db.close()'
 ].join('\n');
 execFileSync(python,['-c',fixture,db],{timeout:3000});
 process.env.OMJB_DB_PATH=db;
 process.env.OMJB_PYTHON=python;
 const before=(await stat(db)).mtimeMs;
 const status=await queryEvidence('omjb_status');
 assert.deepEqual(status,{configured:true,runs:2,observations:2,read_only:true});
 const runs=await queryEvidence('omjb_list_runs',{limit:5});
 assert.equal(runs.runs[0].id,2);
 const summary=await queryEvidence('omjb_run_summary',{run_id:1});
 assert.equal(summary.heuristic_flags_unconfirmed,1);
 assert.equal(summary.reviewed_outcomes.unclear,1);
 const review=await queryEvidence('omjb_pending_reviews',{run_id:2});
 assert.equal(review.pending_review,1);
 const compare=await queryEvidence('omjb_compare_runs',{baseline_id:1,candidate_id:2});
 assert.equal(compare.changed_detector_labels,1);
 const all=JSON.stringify({status,runs,summary,review,compare});
 for(const secret of ['SENSITIVE_PROMPT','SENSITIVE_RESPONSE','PRIVATE_SECRET','PRIVATE_REVIEW_NOTES','secret_token'])
  assert.equal(all.includes(secret),false,'no private evidence leak');
 assert.equal((await stat(db)).mtimeMs,before,'read-only query must not alter the database');
 const handler=await request(8,'tools/call',{name:'omjb_run_summary',arguments:{run_id:1}});
 assert.equal(handler.result.isError,false);
 assert.equal(handler.result.content[0].type,'text');
});
