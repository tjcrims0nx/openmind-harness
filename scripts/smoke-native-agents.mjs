import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {MemoryStore} from '../modules/memory.mjs';
import {makeHandlers} from '../modules/queue-handlers.mjs';
import {TaskQueue} from '../modules/task-queue.mjs';

const root=await mkdtemp(join(tmpdir(),'omh-agent-cancel-'));
const workspace=join(root,'workspace');
const heartbeat=join(workspace,'heartbeat');
let scenario='ordinary';
let reviewed=false;
let childCanRunShell=false;
let receivedReview=false;
let readProjectNote=false;
let disclosedPrivateNote=false;
const fixture=createServer(async (request,response)=>{
 const chunks=[];
 for await(const chunk of request)chunks.push(chunk);
 const body=JSON.parse(Buffer.concat(chunks));
 const contents=JSON.stringify(body.contents);
 if(contents.includes('fixture-project-note'))readProjectNote=true;
 if(contents.includes('fixture-private-note'))disclosedPrivateNote=true;
 const tools=body.tools?.flatMap(tool=>tool.functionDeclarations??[])??[];
 let part={text:'OpenCode smoke fixture response.'};
 if(scenario==='heartbeat'&&tools.some(tool=>tool.name==='bash')){
  part={functionCall:{name:'bash',args:{
   command:'while true; do echo running >> heartbeat; sleep 0.05; done',
   description:'Write a temporary smoke test heartbeat',timeout:30000,workdir:workspace,
  }}};
 }
 if(scenario==='delegation'){
  const toolReplies=body.contents.flatMap(turn=>turn.parts??[]).filter(item=>item.functionResponse);
  if(toolReplies.some(item=>JSON.stringify(item.functionResponse).includes('review-fixture-confirmed'))){
   receivedReview=true;
   part={text:'Received the fixture review.'};
  }else if(contents.includes('Inspect the fixture readme marker')&&
           JSON.stringify(body.systemInstruction).includes('Review only')){
   reviewed=true;
   childCanRunShell=tools.some(tool=>tool.name==='bash');
   part={text:'review-fixture-confirmed'};
  }else if(tools.some(tool=>tool.name==='task')&&!toolReplies.length){
   part={functionCall:{name:'task',args:{
    description:'Review fixture',prompt:'Inspect the fixture readme marker',
    subagent_type:'reviewer',
   }}};
  }
 }
 const event={candidates:[{content:{role:'model',parts:[part]},finishReason:'STOP',index:0}]};
 response.writeHead(200,{'Content-Type':'text/event-stream'});
 response.end(`data: ${JSON.stringify(event)}\n\n`);
});
fixture.listen(0,'127.0.0.1');
await once(fixture,'listening');
try{
 const config=join(root,'config');
 await mkdir(join(config,'opencode'),{recursive:true});
 await mkdir(workspace);
 Object.assign(process.env,{
  XDG_CONFIG_HOME:config,XDG_DATA_HOME:join(root,'data'),XDG_STATE_HOME:join(root,'state'),
  XDG_CACHE_HOME:join(root,'cache'),OPENCODE_DISABLE_AUTOUPDATE:'true',
  OPENCODE_DISABLE_MODELS_FETCH:'true',
 });
 const {model,agent:{implementer,reviewer},provider:{google}}=JSON.parse(
  await readFile(new URL('../opencode.json',import.meta.url),'utf8'),
 );
 const baseURL=`http://127.0.0.1:${fixture.address().port}/v1beta`;
 await writeFile(join(config,'opencode','opencode.json'),JSON.stringify({
  model,small_model:model,enabled_providers:['google'],
  agent:{implementer,reviewer},permission:{'*':'deny',bash:'allow',task:{'*':'deny',reviewer:'allow'}},
  provider:{google:{...google,options:{apiKey:'local-fixture',baseURL}}},
 }));
 const queueFile=join(root,'tasks.json');
 const memory=new MemoryStore(join(root,'memory.json'));
 await memory.add({scope:'project',title:'Project',content:'fixture-project-note',approved:true});
 await memory.add({scope:'private',title:'Private',content:'fixture-private-note',approved:true});
 const worker=new TaskQueue(queueFile,makeHandlers(workspace,{stateDir:root}));
 const controller=new TaskQueue(queueFile);
 const input={agent:'implementer',prompt:'Run the harmless smoke fixture.',approved:true,timeoutMs:35000};
 const completed=await worker.enqueue('agent.run',input);
 const result=await worker.runById(completed.id);
 assert.equal(result.status,'completed',result.error);
 assert.match(result.result.stdout,/OpenCode smoke fixture response/,result.result.stderr || 'OpenCode emitted no response');

 assert.equal(readProjectNote,false);
 assert.equal(disclosedPrivateNote,false);
 scenario='delegation';
 const parent=await worker.enqueue('agent.run',{...input,prompt:'Delegate the short fixture review.'});
 const delegated=await worker.runById(parent.id);
 assert.equal(delegated.status,'completed',delegated.error);
 assert.ok(reviewed,'Reviewer received its delegated fixture prompt');
 assert.equal(childCanRunShell,false,'Reviewer must keep its shell restriction');
 assert.ok(receivedReview,'Parent received the reviewer result through OpenCode');
 const events=delegated.result.stdout.trim().split('\n').map(JSON.parse);
 assert.ok(events.some(event=>event.part?.tool==='task'&&event.part.state?.status==='completed'));
 console.log('The implementer received a result from the restricted reviewer using the native task tool.');
 scenario='heartbeat';
 const task=await worker.enqueue('agent.run',{...input,useMemory:true});
 const running=worker.runById(task.id);
 try{
  let started=false;
  for(let attempt=0;attempt<120&&!started;attempt++){
   started=await readFile(heartbeat,'utf8').then(Boolean,()=>false);
   if(!started)await delay(100);
  }
  if(!started)throw new Error(`OpenCode shell tool did not start: ${(await running).error??'task ended'}`);
  assert.equal(readProjectNote,true);
  assert.equal(disclosedPrivateNote,false);
  const request=await controller.cancel(task.id);
  assert.equal(request.status,'running');
  assert.ok(request.cancelRequestedAt);
  const cancelled=await running;
  assert.equal(cancelled.status,'cancelled',cancelled.error);
  const stopped=await readFile(heartbeat,'utf8');
  await delay(350);
  assert.equal(await readFile(heartbeat,'utf8'),stopped);
  assert.equal((await controller.load()).list().find(item=>item.id===task.id).status,'cancelled');
  console.log('OpenCode completed a fixture session and cancelled a running native shell tool.');
 }finally{
  await running;
 }
}finally{
 fixture.close();
 await rm(root,{recursive:true,force:true});
}
