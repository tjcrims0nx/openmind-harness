import {useCallback,useEffect,useRef,useState,type FormEvent,type KeyboardEvent} from 'react';
import {MarkDownRenderer} from '@openuidev/react-ui';
import {RuntimeView} from './RuntimeView';

type Provider={id:string;label:string;model:string;available:boolean};
type ChatMessage={role:'user'|'assistant';content:string};
const MENU=['Chat','Workspace','Agents','Tasks','Memory','Workflows','Plugins','Logs'] as const;

function sameOriginChat(){
 const host=window.location.hostname;
 return host==='127.0.0.1'||host==='localhost';
}

export function App(){
 const local=sameOriginChat();
 const [token,setToken]=useState('');
 const [tokenDraft,setTokenDraft]=useState('');
 const [providers,setProviders]=useState<Provider[]>([]);
 const [providerId,setProviderId]=useState('');
 const [draft,setDraft]=useState('');
 const [history,setHistory]=useState<ChatMessage[]>([]);
 const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState('Connect to load your configured models.');
 const [showConnect,setShowConnect]=useState(false);
 const [menu,setMenu]=useState(false);
 const [view,setView]=useState<(typeof MENU)[number]>('Chat');
 const thread=useRef<HTMLDivElement>(null);
 const abort=useRef<AbortController|null>(null);
 const selected=providers.find(p=>p.id===providerId&&p.available);

 const api=useCallback(async (method:'GET'|'POST',body?:unknown,signal?:AbortSignal)=>{
  const headers:Record<string,string>={};
  if(!local){
   if(!token)throw new Error('Dashboard access token required.');
   headers.Authorization='Bearer '+token;
  }
  if(method==='POST'){
   headers['Content-Type']='application/json';
   if(local){
    const session=await fetch('/api/session',{signal});
    if(!session.ok)throw new Error('Local session is not available.');
    const payload=await session.json() as {csrf:string};
    headers['X-OMH-CSRF']=payload.csrf;
   }
  }
  const response=await fetch('/api/chat',{method,headers,body:body?JSON.stringify(body):undefined,signal});
  const data=await response.json().catch(()=>({})) as Record<string,unknown>;
  if(!response.ok)throw new Error(typeof data.error==='string'?data.error:'Chat request failed (HTTP '+response.status+')');
  return data;
 },[local,token]);

 const refreshProviders=useCallback(async()=>{
  try{
   const data=await api('GET');
   const list=Array.isArray(data.providers)?data.providers as Provider[]:[];
   setProviders(list);
   const first=list.find(p=>p.available);
   setProviderId(current=>list.some(p=>p.id===current&&p.available)?current:'');
   setNotice(first?'Providers ready. Select the model you want to use.':'No configured model yet. Add a provider API key to your OMH runtime.');
   if(first)setShowConnect(false);
  }catch(error){
   setProviders([]);
   setProviderId('');
   const message=error instanceof Error?error.message:'Connection failed';
   setNotice(message);
   if(!local)setShowConnect(true);
  }
 },[api,local]);
 useEffect(()=>{void refreshProviders();},[refreshProviders]);
 useEffect(()=>{thread.current?.scrollTo({top:thread.current.scrollHeight,behavior:'smooth'});},[history,busy]);
 useEffect(()=>()=>abort.current?.abort(),[]);

 async function submit(event:FormEvent){
  event.preventDefault();
  const content=draft.trim();
  if(!content||!selected||busy)return;
  const requestedProvider=selected.id;
  const input:ChatMessage[]=[...history,{role:'user',content}].slice(-16);
  setBusy(true);
  setDraft('');
  setHistory(input);
  setNotice('Contacting '+selected.label+'…');
  const controller=new AbortController();abort.current=controller;
  try{
   const result=await api('POST',{provider:requestedProvider,messages:input},controller.signal);
   if(typeof result.text!=='string'||!result.text.trim())throw new Error('Model returned an empty answer.');
   setHistory([...input,{role:'assistant',content:result.text}].slice(-16));
   setNotice('Response from '+selected.label+' · '+(typeof result.model==='string'?result.model:selected.model));
  }catch(error){
   setHistory(history); // failed request does not silently enter conversation context
   setDraft(content);
   setNotice(error instanceof Error?error.message:'Request failed.');
  }finally{setBusy(false);abort.current=null;}
 }

 function keyDown(event:KeyboardEvent<HTMLTextAreaElement>){
  if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();event.currentTarget.form?.requestSubmit();}
 }

 function changeProvider(id:string){setProviderId(id);setHistory([]);setDraft('');setNotice('New conversation.');}
 function newChat(){setHistory([]);setDraft('');setNotice('New conversation.');}
 function selectView(next:(typeof MENU)[number]){setView(next);setMenu(false);}

 return <div className="omh-shell">
  <aside className={'sidebar'+(menu?' expanded':'')}>
   <div className="brand"><img src="/app-icon.webp" alt="OpenMind Harness"/><div><strong>OMH</strong><span>OPENMIND HARNESS</span></div></div>
   <div className="sidebar-label">WORKSPACE</div>
   <nav aria-label="Main navigation">
    {MENU.map((item,index)=><button key={item} className={view===item?'selected':''} onClick={()=>selectView(item)}>
      <span className="nav-symbol" aria-hidden>{['◇','▣','♙','☷','▤','⎇','⬡','≋'][index]}</span>{item}
    </button>)}
   </nav>
   <div className="sidebar-foot"><span className="small-dot"/> Local-first runtime<br/><small>Providers remain under your control.</small></div>
  </aside>
  {menu&&<button className="nav-backdrop" aria-label="Close navigation" onClick={()=>setMenu(false)}/>}
  <div className="stage">
   <header className="app-header"><div className="header-left">
    <button className="menu-toggle" aria-label="Toggle navigation" aria-expanded={menu} onClick={()=>setMenu(!menu)}>☰</button>
    <img src="/app-icon.webp" alt="" className="header-logo"/>
    <strong>OpenMind Harness</strong><span className="divider">/</span><span>{view}</span>
   </div><div className="header-right"><span className="status"><span className={'small-dot'+(selected?' connected':'')}/>{selected?'Model ready':'Not connected'}</span>
   <button onClick={()=>{setShowConnect(true);setTokenDraft('');}} className="settings-button">Connect</button></div></header>
   {view==='Chat'?<main className="chat-layout">
    <div className="chat-top">
     <div><span className="eyebrow">UNIVERSAL AI WORKSPACE</span><h1>Chat</h1></div>
     <div className="model-controls"><label htmlFor="chat-provider">Model</label>
       <select id="chat-provider" value={providerId} onChange={e=>changeProvider(e.target.value)} disabled={busy}>
        <option value="">Choose a provider</option>
        {providers.map(p=><option key={p.id} value={p.id} disabled={!p.available}>{p.label}{!p.available?' · configure key':''}</option>)}
       </select>
       <button onClick={newChat} disabled={busy} title="New chat">+ New</button>
     </div>
    </div>
    <section className="conversation" ref={thread} role="log" aria-live="polite" aria-label="Conversation">
     {history.length===0?<div className="empty-state">
       <img src="/app-icon.webp" alt="OMH hexagon" className="hero-logo"/>
       <h2>What can I help you build?</h2>
       <p>Start a conversation with your chosen AI model.</p>
       <div className="suggestions">{['Plan a project','Review some code','Explain a concept'].map(x=><button key={x} onClick={()=>setDraft(x)}>{x}</button>)}</div>
     </div>:<div className="messages">{history.map((m,i)=><article className={'message '+m.role} key={i}>
       <span className="message-role">{m.role==='user'?'YOU':(selected?.label??'ASSISTANT').toUpperCase()}</span>
       <div>{m.role==='assistant'?<MarkDownRenderer textMarkdown={m.content}/>:<p>{m.content}</p>}</div>
      </article>)}</div>}
     {busy&&<div className="typing" role="status"><span className="pulse"/> Working on your reply…</div>}
    </section>
    <div className="chat-bottom">
     <p className="notice" role="status">{notice}</p>
     <form className="composer" onSubmit={submit}><label htmlFor="message" className="sr-only">Send a message</label>
       <textarea id="message" value={draft} onChange={e=>setDraft(e.target.value)} onKeyDown={keyDown} rows={2} maxLength={8000} placeholder="Message OpenMind Harness…" />
       <div className="compose-row"><span>{selected?selected.model:'Select a provider to begin'} · Shift+Enter for a new line</span>
       <button type="submit" disabled={!selected||!draft.trim()||busy}>{busy?'Sending…':'Send ↑'}</button></div>
     </form>
     <div className="privacy-note">Keys stay on your server. Messages are sent only to the provider you select.</div>
    </div>
   </main>:<RuntimeView view={view} token={token} local={local} onConnect={()=>setShowConnect(true)}/>}
  </div>
  {showConnect&&<div className="dialog-cover" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setShowConnect(false);}}>
    <section className="connect-dialog" role="dialog" aria-modal="true" aria-labelledby="connect-title">
      <button className="close-dialog" aria-label="Close" onClick={()=>setShowConnect(false)}>×</button>
      <img src="/app-icon.webp" alt="" width="44" height="44"/>
      <h2 id="connect-title">Connect your workspace</h2>
      <p>{local?'This local OMH session reads credentials from the server environment.':'Enter your dashboard access token. This is not your provider API key and is kept only in this browser tab.'}</p>
      {!local&&<><label htmlFor="access-token">Dashboard access token</label><input id="access-token" type="password" autoComplete="off" value={tokenDraft} onChange={e=>setTokenDraft(e.target.value)} placeholder="Paste OMH_WEB_ACCESS_TOKEN"/></>}
      <div className="dialog-actions"><button onClick={()=>setShowConnect(false)}>Cancel</button>
       <button className="primary" onClick={()=>{if(!local)setToken(tokenDraft.trim());else void refreshProviders();setShowConnect(false);}}>{local?'Refresh providers':'Connect'}</button></div>
    </section>
   </div>}
 </div>;
}
