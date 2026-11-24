import {useCallback,useEffect,useState} from 'react';

type RecordLike=Record<string,unknown>;
type EvidenceMcp={
  name?:string;
  enabled?:boolean;
  connected?:boolean;
  state?:string;
  restarts?:number;
  lastError?:string|null;
  lastPingAt?:string|null;
  tools?:string[];
  dbPath?:string|null;
};
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
  evidenceMcp?:EvidenceMcp|null;
  adminActionsAvailable?:boolean;
};
type View='Workspace'|'Agents'|'Tasks'|'Memory'|'Workflows'|'Plugins'|'Logs';
type Props={view:View; token:string; local:boolean; onConnect:()=>void};

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

export function RuntimeView({view,token,local,onConnect}:Props){
 const [state,setState]=useState<RuntimeState|null>(null);
 const [error,setError]=useState('');
 const [loading,setLoading]=useState(false);
 const [busy,setBusy]=useState(false);
 const [actionError,setActionError]=useState('');
 const refresh=useCallback(async()=>{
  setLoading(true);setError('');
  try{
   if(!local&&!token)throw Error('Connect with your dashboard access token to view remote runtime status.');
   const response=await fetch('/api/state',{headers:local?{}:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(12000)});
   if(!response.ok)throw Error(response.status===503?'Remote Harness runtime is not connected. Chat may still work.':'Runtime request failed (HTTP '+response.status+').');
   const data=await response.json() as RuntimeState;
   setState(data);
  }catch(e){setState(null);setError(e instanceof Error?e.message:'Runtime unavailable');}
  finally{setLoading(false);}
 },[local,token]);
 useEffect(()=>{void refresh();},[refresh]);
 const evidenceAction=useCallback(async(action:'enable'|'disable'|'retry')=>{
  if(!local)return;
  setBusy(true);setActionError('');
  try{
   const session=await fetch('/api/session',{signal:AbortSignal.timeout(5000)});
   if(!session.ok)throw Error('Local session is not available.');
   const payload=await session.json() as {csrf:string};
   const response=await fetch('/api/plugins/omjb/'+action,{method:'POST',
    headers:{'Content-Type':'application/json','X-OMH-CSRF':payload.csrf},
    body:'{}',signal:AbortSignal.timeout(12000)});
   if(!response.ok){
    const text=await response.text().catch(()=> '');
    throw Error(response.status===403
     ?'Administrator authorization required. Enable it with the installer instead: OMJB_DB_PATH=<path> node scripts/install-omh-runtime.mjs --enable-omjb-evidence'
     :response.status===409
     ?(text||'No installer-managed evidence registration. Enable it with the installer first.')
     :(text||'Request failed (HTTP '+response.status+')'));
   }
   await refresh();
  }catch(e){setActionError(e instanceof Error?e.message:'Request failed');}
  finally{setBusy(false);}
 },[local,refresh]);
 const info=DATA[view];
 const entries=state?.[info.key];
 const list=Array.isArray(entries)?entries:[];
 const evidence=state?.evidenceMcp??null;
 const evidenceState=typeof evidence?.state==='string'?evidence.state:'disabled';
 const evidencePill=evidenceState==='connected'?'connected':evidenceState==='failed'?'failed':evidenceState==='starting'||evidenceState==='reconnecting'?'running':'disabled';
 const evidenceTools=evidence?.tools??[];
 const evidenceDetail=[
  evidence?.enabled?'Enabled':'Disabled',
  evidenceTools.length>0?evidenceTools.length+' read-only tools':'No tools',
  typeof evidence?.restarts==='number'?'Restarts: '+evidence.restarts:null,
  evidence?.lastPingAt?'Last check: '+new Date(evidence.lastPingAt).toLocaleTimeString():null,
  evidence?.dbPath?'Database: '+evidence.dbPath:null,
 ].filter(Boolean).join(' · ');
 return <main className="runtime-page">
  <div className="runtime-heading"><div><span className="eyebrow">OPENMIND HARNESS · LOCAL RUNTIME</span><h1>{info.heading}</h1><p>{info.description}</p></div>
  <button className="runtime-refresh" disabled={loading} onClick={()=>void refresh()}>{loading?'Refreshing…':'↻ Refresh'}</button></div>
  {error?<div className="runtime-offline" role="status"><strong>Runtime unavailable</strong><p>{error}</p>
   {!local&&!token&&<button onClick={onConnect}>Connect dashboard</button>}
   <span>These views require an OMH runtime. The model chat API is configured separately.</span>
  </div>:null}
  {state&&<>{view==='Workspace'&&<section className="runtime-metrics" aria-label="Task status summary">
   {['queued','running','completed','failed','cancelled'].map(status=><div key={status} className="runtime-metric"><span>{status}</span><strong>{state.counts?.[status]??0}</strong></div>)}
   </section>}
   {view==='Plugins'&&evidence&&<section className="runtime-list evidence-card" aria-label="OpenMind Jailbreak Lab evidence plugin">
    <div className="runtime-list-title"><strong>OpenMind Jailbreak Lab</strong><span>Evidence MCP · read-only</span></div>
    <article className="runtime-record">
     <div><strong><span className={'small-dot'+(evidence.connected?' connected':'')}/>{evidence.name||'OpenMind Jailbreak Lab'}</strong>
      <p>{evidenceDetail}</p>
      {evidence.lastError&&<p>Last error: {evidence.lastError}</p>}
      {actionError&&<p role="alert">{actionError}</p>}
      {!evidence.dbPath&&<p>Not registered. Enable it with the installer: OMJB_DB_PATH=&lt;path&gt; node scripts/install-omh-runtime.mjs --enable-omjb-evidence</p>}
     </div>
     <span className={'runtime-status '+evidencePill}>{evidenceState}</span>
    </article>
    {local&&<div className="evidence-actions">
     {evidence.enabled
      ?<button disabled={busy} onClick={()=>void evidenceAction('disable')}>Disable</button>
      :<button disabled={busy||!evidence.dbPath} onClick={()=>void evidenceAction('enable')}>Enable</button>}
     <button disabled={busy||!evidence.enabled} onClick={()=>void evidenceAction('retry')}>Retry connection</button>
    </div>}
    {!local&&<p className="evidence-note">Plugin controls are available on a local OMH runtime.</p>}
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
