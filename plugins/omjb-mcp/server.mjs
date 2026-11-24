#!/usr/bin/env node
/**
 * OMJB evidence MCP plugin for OpenMind Harness.
 * Opt-in, read-only, stdio JSON-RPC. No provider calls or probe execution.
 * Requires Python 3 and an explicitly configured OMJB_DB_PATH.
 */
import {createInterface} from 'node:readline';
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const PY_QUERY=fileURLToPath(new URL('./query.py',import.meta.url));
const TOOL_DEFS=[
 {name:'omjb_status',description:'Inspect configured local evidence-store counts; read-only.',inputSchema:{type:'object',properties:{},required:[],additionalProperties:false}},
 {name:'omjb_list_runs',description:'List recent evidence run IDs and counts, excluding prompts, targets and credentials.',inputSchema:{type:'object',properties:{limit:{type:'integer',minimum:1,maximum:50}},required:[],additionalProperties:false}},
 {name:'omjb_run_summary',description:'Read aggregate detector and human adjudication counts for a run.',inputSchema:{type:'object',properties:{run_id:{type:'integer',minimum:1,maximum:100000000}},required:['run_id'],additionalProperties:false}},
 {name:'omjb_pending_reviews',description:'Read count of results awaiting manual review, without raw prompt text.',inputSchema:{type:'object',properties:{run_id:{type:'integer',minimum:1,maximum:100000000}},required:['run_id'],additionalProperties:false}},
 {name:'omjb_compare_runs',description:'Compare aggregate detector label changes; not proof of exploitation.',inputSchema:{type:'object',properties:{baseline_id:{type:'integer',minimum:1,maximum:100000000},candidate_id:{type:'integer',minimum:1,maximum:100000000}},required:['baseline_id','candidate_id'],additionalProperties:false}},
];
const COMMANDS={
 omjb_status:['status',()=>[0,0]],
 omjb_list_runs:['runs',a=>[a.limit??20,0]],
 omjb_run_summary:['report',a=>[a.run_id,0]],
 omjb_pending_reviews:['reviews',a=>[a.run_id,0]],
 omjb_compare_runs:['compare',a=>[a.baseline_id,a.candidate_id]],
};
function checkArgs(name,args){
 const tool=TOOL_DEFS.find(t=>t.name===name);
 if(!tool)throw Error('Unknown or forbidden MCP tool');
 if(!args||typeof args!=='object'||Array.isArray(args))throw Error('Expected object arguments');
 for(const required of tool.inputSchema.required)if(!Object.hasOwn(args,required))throw Error('Missing required argument');
 for(const [key,value] of Object.entries(args)){
  const def=tool.inputSchema.properties[key];
  if(!def||def.type!=='integer'||!Number.isInteger(value)||value<def.minimum||value>def.maximum)
   throw Error('Invalid or unexpected argument');
 }
 return args;
}
export function queryEvidence(name,args={}){
 const valid=checkArgs(name,args);
 if(!process.env.OMJB_DB_PATH)
  return Promise.resolve({configured:false,note:'Set OMJB_DB_PATH to an existing OpenMind Jailbreak Lab SQLite database.'});
 const [cmd,makeArgs]=COMMANDS[name],numbers=makeArgs(valid);
 const python=process.env.OMJB_PYTHON||'python3';
 // No shell, no user-supplied command or path arguments. The Python helper
 // opens only the operator-configured SQLite file with mode=ro.
 return new Promise((resolve,reject)=>{
  execFile(python,['-I',PY_QUERY,cmd,...numbers.map(String)],
   {timeout:4000,maxBuffer:32768,windowsHide:true,env:{PATH:process.env.PATH||'',SYSTEMROOT:process.env.SYSTEMROOT||'',OMJB_DB_PATH:process.env.OMJB_DB_PATH||''}},
   (err,stdout)=>{
    try{
     if(err&&!stdout)throw Error('OMJB evidence query unavailable');
     const result=JSON.parse(stdout);
     if(err||result.error)throw Error('OMJB evidence store unavailable or incompatible');
     resolve(result);
    }catch(error){reject(error);}
   });
 });
}
export async function handleRPC(msg){
 if(!msg||msg.jsonrpc!=='2.0'||typeof msg.method!=='string'||!Object.hasOwn(msg,'id'))return null;
 const id=msg.id;
 if(msg.method==='initialize')return {jsonrpc:'2.0',id,result:{
  protocolVersion:['2024-11-05','2025-03-26','2025-06-18','2025-11-25'].includes(msg.params?.protocolVersion)?msg.params.protocolVersion:'2025-11-25',
  capabilities:{tools:{listChanged:false}},serverInfo:{name:'openmind-jailbreak-lab-evidence',version:'0.1.0'}}};
 if(msg.method==='ping')return {jsonrpc:'2.0',id,result:{}};
 if(msg.method==='tools/list')return {jsonrpc:'2.0',id,result:{tools:TOOL_DEFS}};
 if(msg.method==='tools/call'){
  try{
   const result=await queryEvidence(msg.params?.name,msg.params?.arguments??{});
   return {jsonrpc:'2.0',id,result:{content:[{type:'text',text:JSON.stringify(result)}],isError:false}};
  }catch(error){
   return {jsonrpc:'2.0',id,result:{content:[{type:'text',text:String(error.message).slice(0,180)}],isError:true}};
  }
 }
 return {jsonrpc:'2.0',id,error:{code:-32601,message:'Method not found'}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const lines=createInterface({input:process.stdin,crlfDelay:Infinity});
 for await(const line of lines){
  if(Buffer.byteLength(line)>16384)continue;
  try{const response=await handleRPC(JSON.parse(line));if(response)process.stdout.write(JSON.stringify(response)+'\n');}
  catch{process.stderr.write('OMJB MCP invalid input\n');}
 }
}
