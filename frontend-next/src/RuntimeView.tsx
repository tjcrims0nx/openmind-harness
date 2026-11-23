import {useCallback,useEffect,useState} from 'react';

type RecordLike=Record<string,unknown>;
type RuntimeState={
  counts?: Record<string,number>;
  agents?:RecordLike[];
  tasks?:RecordLike[];
  workflowSteps?:RecordLike[];
  memory?:RecordLike[];
  plugins?:RecordLike[];
  traces?:RecordLike[];
  schedules?:RecordLike[];
  skills?:RecordLike[];
  workspaces?:string[];
  worker?:RecordLike|null;
  platform?:RecordLike;
};
type View='Workspace'|'Agents'|'Tasks'|'Memory'|'Workflows'|'Plugins'|'Logs';
type Props={view:View; token:string; local:boolean; demo:boolean; onConnect:()=>void};

const DATA:Record<View,{key:keyof RuntimeState;heading:string;description:string}>={
 Workspace:{key:'workspaces',heading:'Workspace',description:'Runtime health, tasks and workspaces'},
 Agents:{key:'agents',heading:'Agents',description:'Team roles and current work'},
 Tasks:{key:'tasks',heading:'Tasks',description:'Queue activity and task outcomes'},
 Memory:{key:'memory',heading:'Memory',description:'Scoped notes and context metadata'},
 Workflows:{key:'workflowSteps',heading:'Workflows',description:'Dependent task steps and execution'},
 Plugins:{key:'plugins',heading:'Plugins',description:'Registered OMH capabilities'},
 Logs:{key:'traces',heading:'Logs',description:'Recent redacted runtime events'}
};
function field(value:unknown){
 if(typeof value==='string'||typeof value==='number'||typeof value==='boolean')return String(value);
 return '—';
}
function pick(record:RecordLike, keys:string[]){
 return keys.map(key=>record[key]).find(value=>typeof value==='string'&&value.trim()||typeof value==='number')??'—';
}
function normalizedStatus(value:unknown){
 const status=field(value).toLowerCase();
 return ['queued','running','completed','failed','cancelled','enabled','disabled'].includes(status)?status:'unknown';
}
function cardTitle(item:RecordLike,view:View){
 const choices=view==='Agents'?['name']:view==='Memory'?['title','id']:view==='Plugins'?['name']:view==='Logs'?['type','kind']:['kind','name','id'];
 return field(pick(item,choices));
}
function secondary(item:RecordLike){
 const choices=['id','name','version','createdAt','finishedAt','at','scope','type','nextAt'];
 return choices.filter(key=>item[key]!=null).slice(0,3).map(key=>key+': '+field(item[key])).join(' · ');
}

const DEMO_STATE:RuntimeState={counts:{queued:2,running:1,completed:12,failed:0,cancelled:0},agents:[{name:'reviewer',queued:1,running:0}],tasks:[{id:'demo-task-1',kind:'workspace.read',status:'completed'}],workflowSteps:[{id:'demo-step-1',kind:'review',status:'queued'}],memory:[{id:'demo-memory',title:'Example project notes',scope:'workspace'}],plugins:[{name:'OMH connector (demo)',version:'preview',enabled:true}],traces:[{id:'demo-event',type:'task.completed',at:'Sample event'}],workspaces:['Example workspace']};
export function RuntimeView({view,token,local,demo,onConnect}:Props){
 const [state,setState]=useState<RuntimeState|null>(null);
 const [error,setError]=useState('');
 const [loading,setLoading]=useState(false);
 const refresh=useCallback(async()=>{
  setLoading(true);setError('');
  try{
   if(demo){setState(DEMO_STATE);return;}
   if(!local&&!token)throw Error('Connect with your dashboard access token to view remote runtime status.');
   const response=await fetch('/api/state',{headers:local?{}:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(12000)});
   if(!response.ok)throw Error(response.status===503?'Remote Harness runtime is not connected. Chat may still work.':'Runtime request failed (HTTP '+response.status+').');
   const data=await response.json() as RuntimeState;
   setState(data);
  }catch(e){setState(null);setError(e instanceof Error?e.message:'Runtime unavailable');}
  finally{setLoading(false);}
 },[local,token,demo]);
 useEffect(()=>{void refresh();},[refresh]);
 const info=DATA[view];
 const entries=state?.[info.key];
 const list=Array.isArray(entries)?entries:[];
 return <main className="runtime-page">
  <div className="runtime-heading"><div><span className="eyebrow">{demo?'DEMO · SAMPLE DATA':'OPENMIND HARNESS · LOCAL RUNTIME'}</span><h1>{info.heading}</h1><p>{info.description}</p></div>
  <button className="runtime-refresh" disabled={loading} onClick={()=>void refresh()}>{loading?'Refreshing…':'↻ Refresh'}</button></div>
  {demo&&<div className="runtime-demo-note">These are example records for interface testing. No live Harness is connected.</div>}
  {error?<div className="runtime-offline" role="status"><strong>Runtime unavailable</strong><p>{error}</p>
   {!local&&!token&&<button onClick={onConnect}>Connect dashboard</button>}
   <span>These views require an OMH runtime. The model chat API is configured separately.</span>
  </div>:null}
  {state&&<>{view==='Workspace'&&<section className="runtime-metrics" aria-label="Task status summary">
   {['queued','running','completed','failed','cancelled'].map(status=><div key={status} className="runtime-metric"><span>{status}</span><strong>{state.counts?.[status]??0}</strong></div>)}
   </section>}
   <section className="runtime-list" aria-label={info.heading+' records'}>
    <div className="runtime-list-title"><strong>{info.heading} records</strong><span>{list.length} shown</span></div>
    {list.length===0?<div className="runtime-empty">No records match this view.</div>:
    list.map((raw,index)=>{
     const item:RecordLike=typeof raw==='string'?{name:raw}:raw&&typeof raw==='object'?raw:{name:field(raw)};
     const status=item.status??(typeof item.enabled==='boolean'?(item.enabled?'enabled':'disabled'):undefined);
     return <article className="runtime-record" key={field(item.id??item.name??index)}>
      <div><strong>{cardTitle(item,view)}</strong><p>{secondary(item)}</p></div>
      {status!=null&&<span className={'runtime-status '+normalizedStatus(status)}>{field(status)}</span>}
     </article>;
    })}
   </section></>}
 </main>;
}
