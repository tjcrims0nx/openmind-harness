#!/usr/bin/env node
/**
 * Opt-in operational MCP bridge for the independent OpenMind Jailbreak Lab.
 * Uses the Lab's own Python CLI. Never accepts a shell command, remote URL,
 * arbitrary input path, prompt, or inline probe from an MCP caller.
 */
import {createInterface} from 'node:readline';
import {execFile} from 'node:child_process';
import {resolve,isAbsolute,join} from 'node:path';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const tools=[
 {name:'omjb_lab_capabilities',description:'Check Lab installation and which execution modes are enabled.',inputSchema:{type:'object',properties:{},additionalProperties:false}},
 {name:'omjb_lab_run_case',description:'Execute a reviewed Guardrail Lab case through the native OMJB runner. Live providers require explicit operator opt-in.',inputSchema:{type:'object',properties:{case_id:{type:'string',pattern:'^GL-[0-9]{3}$'},target:{type:'string',enum:['echo','openai','anthropic','ollama','gemini']}},required:['case_id','target'],additionalProperties:false}},
 {name:'omjb_lab_run_campaign',description:'Run a bounded multi-provider campaign against the operator-selected, human-reviewed benign corpus.',inputSchema:{type:'object',properties:{targets:{type:'array',items:{type:'string',maxLength:96},minItems:1,maxItems:4},max_requests:{type:'integer',minimum:1,maximum:100},max_usd:{type:'number',minimum:0,maximum:100},estimated_request_cost:{type:'number',minimum:0,maximum:10}},required:['targets','max_requests','max_usd','estimated_request_cost'],additionalProperties:false}}
];
const providers=/^(openai|anthropic|gemini|ollama|deepseek|groq|together|echo):[a-zA-Z0-9][a-zA-Z0-9._/-]{0,75}$/;
function validate(name,args){
 const t=tools.find(x=>x.name===name);
 if(!t)throw Error('Unknown Lab operation');
 if(!args||typeof args!=='object'||Array.isArray(args))throw Error('Arguments must be an object');
 for(const k of Object.keys(args))if(!Object.hasOwn(t.inputSchema.properties,k))throw Error('Unexpected argument');
 for(const k of t.inputSchema.required||[])if(!Object.hasOwn(args,k))throw Error('Missing argument: '+k);
 if(name==='omjb_lab_run_case'&&(!/^GL-[0-9]{3}$/.test(args.case_id)||!['echo','openai','anthropic','ollama','gemini'].includes(args.target)))throw Error('Invalid case or target');
 if(name==='omjb_lab_run_campaign'){
  if(!Array.isArray(args.targets)||args.targets.length<1||args.targets.length>4||!args.targets.every(t=>typeof t==='string'&&providers.test(t)))throw Error('Invalid targets');
  if(!Number.isInteger(args.max_requests)||args.max_requests<1||args.max_requests>100)throw Error('Invalid request cap');
  if(!Number.isFinite(args.max_usd)||args.max_usd<0||args.max_usd>100||!Number.isFinite(args.estimated_request_cost)||args.estimated_request_cost<0||args.estimated_request_cost>10)throw Error('Invalid cost budget');
  const localOnly=args.targets.every(t=>t.startsWith('ollama:')||t.startsWith('echo:'));
  if(!localOnly&&(args.max_usd<=0||args.estimated_request_cost<=0))throw Error('Remote targets require positive estimated cost and budget');
  if((args.max_usd===0)!==(args.estimated_request_cost===0))throw Error('Budget and estimated cost must both be zero for free/local runs');
  // This is the requested campaign ceiling, not merely the cost of one request.
  // Compare with tolerance for binary floating point rounding.
  if(args.max_requests*args.estimated_request_cost>args.max_usd+1e-10)
   throw Error('Campaign budget below maximum estimated total cost');
 }
 return args;
}
function config(){
 const root=process.env.OMJB_LAB_ROOT;
 if(!root||!isAbsolute(root)||!existsSync(join(root,'omjb','cli.py')))throw Error('OMJB_LAB_ROOT must be an installed absolute Lab repository path');
 const db=process.env.OMJB_DB_PATH;
 if(!db||!isAbsolute(db))throw Error('OMJB_DB_PATH must be an absolute SQLite file path');
 return {root,db,python:process.env.OMJB_PYTHON||'python3'};
}
function safeLabFailure(stderr){
 // Preserve actionable known Lab errors, never expose raw tracebacks,
 // prompts, tokens or arbitrary provider-supplied messages through MCP.
 const last=String(stderr||'').trim().split(/\r?\n/).at(-1)||'';
 const matched=last.match(/^(?:sqlite3\.)?(OperationalError|IntegrityError|ValueError|RuntimeError): (.{1,180})$/);
 if(!matched)return 'Lab command failed; inspect local logs';
 const detail=matched[2];
 if(/^(?:table [a-z_][\w]* has no column named [a-z_][\w]*|no such (?:table|column): [a-z_][\w.]*|missing environment variable [A-Z_][A-Z_0-9]*|campaign budget [a-z -]+|remote provider campaigns require positive [a-z -]+)$/i.test(detail))
  return 'Lab '+matched[1]+': '+detail;
 return 'Lab '+matched[1]+'; inspect local logs';
}
function run(c,args,timeout){
 const env={...process.env,PYTHONPATH:c.root};
 return new Promise((ok,fail)=>execFile(c.python,['-m',...args],{cwd:c.root,env,timeout,maxBuffer:65536,windowsHide:true},(err,out,stderr)=>{
  if(err)return fail(Error(err.killed?'Lab operation timed out':safeLabFailure(stderr)));
  ok(out);
 }));
}
export async function invoke(name,raw={}){
 const args=validate(name,raw);
 if(name==='omjb_lab_capabilities'){
  const root=process.env.OMJB_LAB_ROOT||'';
  return {installed:!!root&&isAbsolute(root)&&existsSync(join(root,'omjb','cli.py')),live_enabled:process.env.OMJB_ALLOW_LIVE_RUNS==='1',reviewed_corpus_configured:!!process.env.OMJB_REVIEWED_CORPUS,operations:tools.map(t=>t.name)};
 }
 const c=config();
 if(name==='omjb_lab_run_case'){
  if(args.target!=='echo'&&process.env.OMJB_ALLOW_LIVE_RUNS!=='1')throw Error('Live execution disabled: operator must set OMJB_ALLOW_LIVE_RUNS=1');
  const id=args.case_id;
  // Case IDs are fixed identifiers, not arbitrary prompt text.
  const out=await run(c,['omjb.cli','--db',c.db,'run','--suite','guardrail-lab','--case',id,'--name','omh-mcp-'+id,'--target',args.target],120000);
  // Return a bounded status; detailed evidence remains accessible in the existing read-only MCP interface.
  const data=JSON.parse(out);
  return {completed:true,run_id:data?.run?.id??data?.run_id??null,summary_available_via_evidence_plugin:true};
 }
 if(name==='omjb_lab_run_campaign'){
  if(process.env.OMJB_ALLOW_LIVE_RUNS!=='1')throw Error('Campaign execution disabled: operator must set OMJB_ALLOW_LIVE_RUNS=1');
  const corpus=process.env.OMJB_REVIEWED_CORPUS;
  if(!corpus||!isAbsolute(corpus)||!existsSync(corpus))throw Error('Configure an existing absolute OMJB_REVIEWED_CORPUS path');
  const output=process.env.OMJB_CAMPAIGN_OUTPUT;
  if(!output||!isAbsolute(output))throw Error('Configure an absolute OMJB_CAMPAIGN_OUTPUT path');
  const cmd=['omjb.mutation_engine.cli','chat-eval','--corpus',corpus,'--max-requests',String(args.max_requests),'--workers','2','--timeout','30','--max-seconds','180','--max-usd',String(args.max_usd),'--estimated-request-cost',String(args.estimated_request_cost),'--output',output];
  for(const t of args.targets)cmd.push('--target',t);
  await run(c,cmd,210000);
  return {completed:true,evidence_saved:true,requested_max:args.max_requests,targets_count:args.targets.length};
 }
 throw Error('Unknown Lab operation');
}
export async function handleRPC(req){
 if(!req||req.jsonrpc!=='2.0'||typeof req.method!=='string'||!Object.hasOwn(req,'id'))return null;
 const id=req.id,base={jsonrpc:'2.0',id};
 if(req.method==='initialize')return {...base,result:{protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'openmind-jailbreak-lab',version:'0.1.0'}}};
 if(req.method==='ping')return {...base,result:{}};
 if(req.method==='tools/list')return {...base,result:{tools}};
 if(req.method==='tools/call'){
  try{return {...base,result:{content:[{type:'text',text:JSON.stringify(await invoke(req.params?.name,req.params?.arguments??{}))}],isError:false}};}
  catch(e){return {...base,result:{content:[{type:'text',text:e.message.slice(0,180)}],isError:true}};}
 }
 return {...base,error:{code:-32601,message:'Method not found'}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 for await(const line of createInterface({input:process.stdin,crlfDelay:Infinity})){
  if(Buffer.byteLength(line)>16384)continue;
  try{const result=await handleRPC(JSON.parse(line));if(result)process.stdout.write(JSON.stringify(result)+'\n');}
  catch{process.stderr.write('Invalid Lab MCP request\n');}
 }
}
