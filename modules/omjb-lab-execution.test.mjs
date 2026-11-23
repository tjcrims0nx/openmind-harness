import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, writeFile, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {existsSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {invoke} from '../plugins/omjb-mcp/lab-server.mjs';
import {queryEvidence} from '../plugins/omjb-mcp/server.mjs';

// Execution-compatibility regression tests for the OMJB MCP bridge.
//
// The read-only evidence fixture (modules/omjb-mcp.test.mjs) uses a minimal
// runs/results/adjudications schema that omits columns the Lab's write path
// requires (notably runs.started_at). An echo run against that fixture fails
// in Store.create_run(). These tests build a fixture with the Lab's ACTUAL
// schema (mirroring OpenMind-Jailbreak-Lab omjb/storage.py) and verify the
// execution bridge works against it, that incompatible DBs are rejected
// cleanly, and that the read-only plugin sees persisted runs.
//
// Execution tests need a Lab installation (OMJB_LAB_ROOT pointing at a
// checkout containing omjb/cli.py). CI configures this path and fails if
// it is invalid. Without the variable, local development can skip the
// execution-only cases. The schema-compatibility test is independent.

const REAL_SCHEMA = `
CREATE TABLE runs(id INTEGER PRIMARY KEY,name TEXT,target TEXT,config TEXT,started_at REAL,finished_at REAL);
CREATE TABLE results(id INTEGER PRIMARY KEY,run_id INTEGER NOT NULL REFERENCES runs(id),probe_id TEXT,probe_category TEXT,prompt TEXT,system TEXT,response TEXT,response_sha256 TEXT,detector_label TEXT,detector_score REAL,detector_reason TEXT,bypass INTEGER,meta TEXT,created_at REAL,pipeline_result TEXT,provenance TEXT);
CREATE TABLE adjudications(id INTEGER PRIMARY KEY,result_id INTEGER NOT NULL REFERENCES results(id),label TEXT,notes TEXT,adjudicated_at REAL);
CREATE TABLE guard_observations(id INTEGER PRIMARY KEY,result_id INTEGER NOT NULL REFERENCES results(id),stage TEXT NOT NULL,decision TEXT NOT NULL,findings TEXT NOT NULL,created_at REAL);
`;

// The minimal read-only fixture schema (same shape as modules/omjb-mcp.test.mjs).
const FIXTURE_SCHEMA = `
CREATE TABLE runs(id INTEGER PRIMARY KEY,name TEXT,target TEXT,config TEXT,finished_at REAL);
CREATE TABLE results(id INTEGER PRIMARY KEY,run_id INTEGER,probe_id TEXT,detector_label TEXT,bypass INTEGER,prompt TEXT,response TEXT);
CREATE TABLE adjudications(id INTEGER PRIMARY KEY,result_id INTEGER,label TEXT,notes TEXT);
INSERT INTO runs VALUES(1,'bench-v1','target','{}',100);
INSERT INTO results VALUES(1,1,'GL-001','review',1,'TEST_PROMPT','TEST_RESPONSE');
`;

function labRoot() {
  const root = process.env.OMJB_LAB_ROOT;
  return root && existsSync(join(root, 'omjb', 'cli.py')) ? root : null;
}

function makeDb(path, schema) {
  const db = new DatabaseSync(path);
  db.exec(schema);
  db.close();
}

function runRows(dbPath) {
  const db = new DatabaseSync(dbPath, {readOnly: true});
  const rows = db.prepare('SELECT id, name, target FROM runs ORDER BY id').all();
  db.close();
  return rows;
}

function resultRows(dbPath) {
  const db = new DatabaseSync(dbPath, {readOnly: true});
  const rows = db.prepare('SELECT id, run_id, probe_id, detector_label FROM results ORDER BY id').all();
  db.close();
  return rows;
}

// An explicitly set OMJB_LAB_ROOT must point at a real Lab checkout.
// Without this, a misconfigured CI would silently skip the execution
// tests and report success. When the variable is unset, the execution
// tests skip cleanly (local dev without the Lab).
test('OMJB_LAB_ROOT, when set, points at a real Lab checkout', async () => {
  if (!process.env.OMJB_LAB_ROOT) return;
  assert.ok(
    existsSync(join(process.env.OMJB_LAB_ROOT, 'omjb', 'cli.py')),
    'OMJB_LAB_ROOT is set but does not contain omjb/cli.py: ' + process.env.OMJB_LAB_ROOT
  );
});

test('execution fixture uses the Lab real schema (started_at present)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omjb-exec-'));
  try {
    const dbPath = join(dir, 'exec.db');
    makeDb(dbPath, REAL_SCHEMA);
    const db = new DatabaseSync(dbPath, {readOnly: true});
    const cols = db.prepare("SELECT name FROM pragma_table_info('runs')").all().map(r => r.name);
    const rcols = db.prepare("SELECT name FROM pragma_table_info('results')").all().map(r => r.name);
    db.close();
    assert.ok(cols.includes('started_at'), 'runs table must have started_at (the column the read-only fixture lacks)');
    assert.ok(cols.includes('finished_at'));
    assert.ok(rcols.includes('probe_category') && rcols.includes('detector_score'), 'results table must have the extended Lab fields');
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});

test('read-only plugin queries work against the real-schema DB', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omjb-exec-'));
  try {
    const dbPath = join(dir, 'exec.db');
    makeDb(dbPath, REAL_SCHEMA);
    const db = new DatabaseSync(dbPath);
    db.exec("INSERT INTO runs VALUES(1,'seed','echo','{}',100,200); INSERT INTO results VALUES(1,1,'GL-001','bench','TEST_PROMPT',NULL,'TEST_RESPONSE',NULL,'review',NULL,NULL,1,'{}',150,NULL,NULL);");
    db.close();
    process.env.OMJB_DB_PATH = dbPath;
    const status = await queryEvidence('omjb_status');
    assert.equal(status.runs, 1);
    assert.equal(status.observations, 1);
    const summary = await queryEvidence('omjb_run_summary', {run_id: 1});
    assert.equal(summary.found, true);
    assert.equal(summary.detector_labels.review, 1);
  } finally {
    delete process.env.OMJB_DB_PATH;
    await rm(dir, {recursive: true, force: true});
  }
});

test('echo run on a fresh real-schema DB persists and is visible via read-only MCP', {skip: !labRoot()}, async () => {
  const root = labRoot();
  const dir = await mkdtemp(join(tmpdir(), 'omjb-exec-'));
  try {
    const dbPath = join(dir, 'exec.db');
    makeDb(dbPath, REAL_SCHEMA);
    process.env.OMJB_LAB_ROOT = root;
    process.env.OMJB_DB_PATH = dbPath;
    delete process.env.OMJB_ALLOW_LIVE_RUNS;
    const result = await invoke('omjb_lab_run_case', {case_id: 'GL-001', target: 'echo'});
    assert.equal(result.completed, true);
    assert.equal(typeof result.run_id, 'number');
    const runs = runRows(dbPath);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].name, 'omh-mcp-GL-001');
    assert.equal(runs[0].target, 'echo');
    const results = resultRows(dbPath);
    assert.equal(results.length, 1);
    assert.equal(results[0].probe_id, 'GL-001');
    // The persisted run is visible through the read-only evidence plugin.
    const status = await queryEvidence('omjb_status');
    assert.equal(status.runs, 1);
    assert.equal(status.observations, 1);
    const summary = await queryEvidence('omjb_run_summary', {run_id: result.run_id});
    assert.equal(summary.found, true);
    assert.equal(summary.observations, 1);
  } finally {
    delete process.env.OMJB_LAB_ROOT;
    delete process.env.OMJB_DB_PATH;
    await rm(dir, {recursive: true, force: true});
  }
});

test('reviewed-benign echo campaign completes through MCP without provider keys', {skip: !labRoot()}, async () => {
 const root=labRoot();
 const dir=await mkdtemp(join(tmpdir(),'omjb-campaign-'));
 const saved={root:process.env.OMJB_LAB_ROOT,db:process.env.OMJB_DB_PATH,corpus:process.env.OMJB_REVIEWED_CORPUS,output:process.env.OMJB_CAMPAIGN_OUTPUT,live:process.env.OMJB_ALLOW_LIVE_RUNS};
 try {
  const db=join(dir,'evidence.db'),corpus=join(dir,'reviewed.jsonl'),output=join(dir,'campaign.json');
  makeDb(db,REAL_SCHEMA);
  await writeFile(corpus,JSON.stringify({id:'SAFE-001',category:'benign',prompt:'Say hello.',expected:'comply',meta:{mutation_safe:true}})+'\n');
  process.env.OMJB_LAB_ROOT=root;
  process.env.OMJB_DB_PATH=db;
  process.env.OMJB_REVIEWED_CORPUS=corpus;
  process.env.OMJB_CAMPAIGN_OUTPUT=output;
  process.env.OMJB_ALLOW_LIVE_RUNS='1';
  const result=await invoke('omjb_lab_run_campaign',{targets:['echo:local'],max_requests:1,max_usd:0,estimated_request_cost:0});
  assert.equal(result.completed,true);
  assert.equal(result.evidence_saved,true);
  const report=JSON.parse(await readFile(output,'utf8'));
  assert.equal(report.scheduled_requests,1);
  assert.equal(report.successful_responses,1);
  assert.equal(report.results[0].provider,'echo');
  assert.equal(JSON.stringify(result).includes('Say hello.'),false,'no raw prompts in MCP output');
 }finally{
  for(const [key,value] of Object.entries({OMJB_LAB_ROOT:saved.root,OMJB_DB_PATH:saved.db,OMJB_REVIEWED_CORPUS:saved.corpus,OMJB_CAMPAIGN_OUTPUT:saved.output,OMJB_ALLOW_LIVE_RUNS:saved.live})){
   if(value===undefined)delete process.env[key];else process.env[key]=value;
  }
  await rm(dir,{recursive:true,force:true});
 }
});

test('incompatible (fixture-schema) DB is rejected cleanly without modification', {skip: !labRoot()}, async () => {
  const root = labRoot();
  const dir = await mkdtemp(join(tmpdir(), 'omjb-exec-'));
  try {
    const dbPath = join(dir, 'fixture.db');
    makeDb(dbPath, FIXTURE_SCHEMA);
    const before = runRows(dbPath);
    assert.equal(before.length, 1);
    process.env.OMJB_LAB_ROOT = root;
    process.env.OMJB_DB_PATH = dbPath;
    delete process.env.OMJB_ALLOW_LIVE_RUNS;
    await assert.rejects(invoke('omjb_lab_run_case', {case_id: 'GL-001', target: 'echo' }),/no column named started_at/);
    // The DB must not have been overwritten or extended by the failed run.
    const after = runRows(dbPath);
    assert.deepEqual(after, before);
    const results = resultRows(dbPath);
    assert.equal(results.length, 1);
  } finally {
    delete process.env.OMJB_LAB_ROOT;
    delete process.env.OMJB_DB_PATH;
    await rm(dir, {recursive: true, force: true});
  }
});
