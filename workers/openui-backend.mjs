/**
 * OMH free hosted preview API for Cloudflare Workers.
 *
 * Same-origin React static assets and a real, authenticated provider chat
 * endpoint. API keys are Worker secrets; the browser only gets provider status.
 * This is NOT the OMH agent/OS runtime. Live state is optional via an
 * operator-controlled TLS gateway. No arbitrary proxy targets are accepted.
 */
const PROVIDERS=[
 {id:'openai',label:'OpenAI',env:'OPENAI_API_KEY',model:'OMH_CHAT_OPENAI_MODEL',fallback:'gpt-4.1-mini',url:'https://api.openai.com/v1/chat/completions'},
 {id:'anthropic',label:'Anthropic',env:'ANTHROPIC_API_KEY',model:'OMH_CHAT_ANTHROPIC_MODEL',fallback:'claude-haiku-4-5',url:'https://api.anthropic.com/v1/messages'},
 {id:'gemini',label:'Gemini',env:'GEMINI_API_KEY',model:'OMH_CHAT_GEMINI_MODEL',fallback:'gemini-3.5-flash-lite',url:'https://generativelanguage.googleapis.com/v1beta/models/'},
 {id:'deepseek',label:'DeepSeek',env:'DEEPSEEK_API_KEY',model:'OMH_CHAT_DEEPSEEK_MODEL',fallback:'deepseek-chat',url:'https://api.deepseek.com/chat/completions'},
 {id:'groq',label:'Groq',env:'GROQ_API_KEY',model:'OMH_CHAT_GROQ_MODEL',fallback:'llama-3.3-70b-versatile',url:'https://api.groq.com/openai/v1/chat/completions'},
 {id:'together',label:'Together',env:'TOGETHER_API_KEY',model:'OMH_CHAT_TOGETHER_MODEL',fallback:'meta-llama/Llama-3.3-70B-Instruct-Turbo',url:'https://api.together.xyz/v1/chat/completions'},
 {id:'openrouter',label:'OpenRouter',env:'OPENROUTER_API_KEY',model:'OMH_CHAT_OPENROUTER_MODEL',fallback:'openai/gpt-4.1-mini',url:'https://openrouter.ai/api/v1/chat/completions'},
 {id:'zai',label:'GLM / Z.AI',env:'ZAI_API_KEY',model:'OMH_CHAT_ZAI_MODEL',fallback:'glm-4.6',url:'https://api.z.ai/api/paas/v4/chat/completions'},
 {id:'moonshot',label:'Kimi / Moonshot',env:'MOONSHOT_API_KEY',model:'OMH_CHAT_MOONSHOT_MODEL',fallback:'moonshot-v1-8k',url:'https://api.moonshot.ai/v1/chat/completions'},
 {id:'qwen',label:'Qwen',env:'DASHSCOPE_API_KEY',model:'OMH_CHAT_QWEN_MODEL',fallback:'qwen-plus',url:'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions'}
];
const noStore={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cross-Origin-Resource-Policy':'same-origin'};
function reply(status,data){return Response.json(data,{status,headers:noStore});}
function modelFor(env,c){
 const override=env[c.model];
 return typeof override==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,95}$/.test(override)?override:c.fallback;
}
function validMessages(items){
 if(!Array.isArray(items)||items.length<1||items.length>16)return false;
 let size=0;
 for(const m of items){
  if(!m||typeof m!=='object'||Array.isArray(m)||Object.keys(m).some(k=>!['role','content'].includes(k))||!['user','assistant'].includes(m.role)||typeof m.content!=='string'||!m.content.trim()||m.content.length>8000)return false;
  size+=m.content.length;
 }
 return size<=18000 && items.at(-1).role==='user';
}
function safeToken(a,b){
 if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;
 // Avoid early exit and timing leakage over the token comparison.
 let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);
 return diff===0;
}
function authorize(request,env){
 if(typeof env.OMH_WEB_ACCESS_TOKEN!=='string'||env.OMH_WEB_ACCESS_TOKEN.length<32)return 503;
 const auth=request.headers.get('Authorization')?.match(/^Bearer (.+)$/i)?.[1];
 if(!safeToken(auth,env.OMH_WEB_ACCESS_TOKEN))return 401;
 const fetchSite=request.headers.get('Sec-Fetch-Site');
 if(fetchSite&&!['same-origin','none'].includes(fetchSite))return 403;
 const origin=request.headers.get('Origin');
 if(request.method==='POST'&&origin!==new URL(request.url).origin)return 403;
 return 200;
}
function upstream(c,key,model,messages){
 if(c.id==='anthropic')return {url:c.url,headers:{'x-api-key':key,'anthropic-version':'2023-06-01'},payload:{model,max_tokens:1024,messages}};
 if(c.id==='gemini')return {url:c.url+encodeURIComponent(model)+':generateContent',headers:{'x-goog-api-key':key},payload:{contents:messages.map(m=>({role:m.role==='assistant'?'model':'user',parts:[{text:m.content}]})),generationConfig:{maxOutputTokens:1024}}};
 return {url:c.url,headers:{Authorization:'Bearer '+key},payload:{model,messages,max_tokens:1024,stream:false}};
}
function textOf(c,result){
 if(c.id==='anthropic')return result?.content?.filter(x=>x?.type==='text').map(x=>x.text).join('\n');
 if(c.id==='gemini')return result?.candidates?.[0]?.content?.parts?.map(x=>x.text||'').join('\n');
 return result?.choices?.[0]?.message?.content;
}
export async function handleApi(request,env,{fetcher=fetch}={}){
 const url=new URL(request.url);
 if(!['/api/chat','/api/state'].includes(url.pathname))return reply(404,{error:'Unknown API route'});
 if(!['GET','POST'].includes(request.method) || (url.pathname==='/api/state'&&request.method!=='GET'))
  return reply(405,{error:'Method not allowed'});
 const auth=authorize(request,env);
 if(auth!==200)return reply(auth,{error:auth===503?'Dashboard access not configured':'Unauthorized'});
 if(url.pathname==='/api/state'){
  if(typeof env.OMH_LIVE_URL!=='string'||typeof env.OMH_LIVE_TOKEN!=='string'||env.OMH_LIVE_TOKEN.length<32)
   return reply(503,{error:'OMH live runtime not connected; configure the HTTPS gateway'});
  let remote;
  try{remote=new URL(env.OMH_LIVE_URL);}catch{return reply(503,{error:'Invalid runtime configuration'});}
  if(remote.protocol!=='https:'||remote.username||remote.password||remote.search||remote.hash||
   /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1)/i.test(remote.hostname))
   return reply(503,{error:'Runtime URL must be public HTTPS'});
  try{
   const result=await fetcher(remote.origin+'/api/state',{headers:{Authorization:'Bearer '+env.OMH_LIVE_TOKEN},redirect:'error',signal:AbortSignal.timeout(10000)});
   if(!result.ok)return reply(502,{error:'Runtime gateway returned HTTP '+result.status});
   const content=await result.text();
   if(content.length>200000)return reply(502,{error:'Runtime response exceeded limit'});
   return reply(200,JSON.parse(content));
  }catch{return reply(502,{error:'Configured runtime gateway unreachable'});}
 }
 if(request.method==='GET')
  return reply(200,{providers:PROVIDERS.map(c=>({id:c.id,label:c.label,model:modelFor(env,c),available:typeof env[c.env]==='string'&&!!env[c.env]}))});
 if(request.headers.get('Content-Type')?.split(';')[0].trim()!=='application/json')
  return reply(415,{error:'JSON required'});
 const length=Number(request.headers.get('Content-Length')||0);
 if(length>22000)return reply(413,{error:'Payload too large'});
 let body;try{const raw=await request.text();if(raw.length>22000)return reply(413,{error:'Payload too large'});body=JSON.parse(raw);}catch{return reply(400,{error:'Invalid JSON body'});}
 const c=PROVIDERS.find(x=>x.id===body?.provider);
 if(!c||!validMessages(body?.messages))return reply(400,{error:'Invalid provider or messages'});
 if(typeof env[c.env]!=='string'||!env[c.env])return reply(503,{error:'Selected provider not configured'});
 const model=modelFor(env,c),target=upstream(c,env[c.env],model,body.messages);
 try{
  const result=await fetcher(target.url,{method:'POST',headers:{'Content-Type':'application/json',...target.headers},body:JSON.stringify(target.payload),redirect:'error',signal:AbortSignal.timeout(25000)});
  if(!result.ok)return reply(502,{error:'Provider request failed (HTTP '+result.status+')'});
  const response=await result.json(),text=textOf(c,response);
  if(typeof text!=='string'||!text.trim())return reply(502,{error:'Provider returned no text'});
  return reply(200,{provider:c.id,model,text:text.slice(0,20000)});
 }catch{return reply(502,{error:'Provider unavailable; verify the server configuration'});}
}
export default{
 async fetch(request,env){
  const path=new URL(request.url).pathname;
  if(path.startsWith('/api/'))return handleApi(request,env);
  return env.ASSETS.fetch(request);
 }
};
