/** Authenticated, server-side provider chat for the OMH web UI.
 * Vercel keeps provider keys private. This route never accepts custom URLs,
 * header overrides, tool calls, arbitrary model names or provider credentials.
 */
import {verifyWebAccess} from './omh-vercel-proxy.mjs';

const configs=[
 {id:'openai',label:'OpenAI',key:'OPENAI_API_KEY',modelKey:'OMH_CHAT_OPENAI_MODEL',fallback:'gpt-4.1-mini',url:'https://api.openai.com/v1/chat/completions'},
 {id:'anthropic',label:'Anthropic',key:'ANTHROPIC_API_KEY',modelKey:'OMH_CHAT_ANTHROPIC_MODEL',fallback:'claude-haiku-4-5',url:'https://api.anthropic.com/v1/messages'},
 {id:'gemini',label:'Gemini',key:'GEMINI_API_KEY',modelKey:'OMH_CHAT_GEMINI_MODEL',fallback:'gemini-2.5-flash',url:'https://generativelanguage.googleapis.com/v1beta/models/'},
 {id:'deepseek',label:'DeepSeek',key:'DEEPSEEK_API_KEY',modelKey:'OMH_CHAT_DEEPSEEK_MODEL',fallback:'deepseek-chat',url:'https://api.deepseek.com/chat/completions'},
 {id:'groq',label:'Groq',key:'GROQ_API_KEY',modelKey:'OMH_CHAT_GROQ_MODEL',fallback:'llama-3.3-70b-versatile',url:'https://api.groq.com/openai/v1/chat/completions'},
 {id:'together',label:'Together',key:'TOGETHER_API_KEY',modelKey:'OMH_CHAT_TOGETHER_MODEL',fallback:'meta-llama/Llama-3.3-70B-Instruct-Turbo',url:'https://api.together.xyz/v1/chat/completions'},
 {id:'openrouter',label:'OpenRouter',key:'OPENROUTER_API_KEY',modelKey:'OMH_CHAT_OPENROUTER_MODEL',fallback:'openai/gpt-4.1-mini',url:'https://openrouter.ai/api/v1/chat/completions'},
 {id:'zai',label:'GLM / Z.AI',key:'ZAI_API_KEY',modelKey:'OMH_CHAT_ZAI_MODEL',fallback:'glm-4.6',url:'https://api.z.ai/api/paas/v4/chat/completions'},
 {id:'moonshot',label:'Kimi / Moonshot',key:'MOONSHOT_API_KEY',modelKey:'OMH_CHAT_MOONSHOT_MODEL',fallback:'moonshot-v1-8k',url:'https://api.moonshot.ai/v1/chat/completions'},
 {id:'qwen',label:'Qwen',key:'DASHSCOPE_API_KEY',modelKey:'OMH_CHAT_QWEN_MODEL',fallback:'qwen-plus',url:'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions'}
];
const MAX_TOTAL=18000, MAX_MESSAGES=16;
function safeModel(env,config){
 const supplied=env[config.modelKey];
 return typeof supplied==='string' && /^[a-zA-Z0-9][a-zA-Z0-9._\/-]{0,95}$/.test(supplied)?supplied:config.fallback;
}
export function listChatProviders(env=process.env){
 return configs.map(c=>({id:c.id,label:c.label,model:safeModel(env,c),available:typeof env[c.key]==='string'&&env[c.key].length>0}));
}
function checkMessages(messages){
 if(!Array.isArray(messages)||messages.length<1||messages.length>MAX_MESSAGES)return null;
 let size=0;
 for(const m of messages){
  if(!m||typeof m!=='object'||Array.isArray(m)||!['user','assistant'].includes(m.role)||typeof m.content!=='string'||!m.content.trim()||m.content.length>8000)return null;
  size+=m.content.length;
 }
 if(size>MAX_TOTAL||messages.at(-1).role!=='user')return null;
 return messages.map(m=>({role:m.role,content:m.content}));
}
function makeRequest(c,key,model,messages){
 if(c.id==='anthropic')return {url:c.url,headers:{'x-api-key':key,'anthropic-version':'2023-06-01'},body:{model,max_tokens:1024,messages}};
 if(c.id==='gemini')return {url:c.url+encodeURIComponent(model)+':generateContent',headers:{'x-goog-api-key':key},body:{contents:messages.map(m=>({role:m.role==='assistant'?'model':'user',parts:[{text:m.content}]})),generationConfig:{maxOutputTokens:1024}}};
 return {url:c.url,headers:{Authorization:'Bearer '+key},body:{model,messages,max_tokens:1024,stream:false}};
}
function extractText(c,result){
 if(c.id==='anthropic')return result?.content?.filter(x=>x?.type==='text').map(x=>x.text).join('\n');
 if(c.id==='gemini')return result?.candidates?.[0]?.content?.parts?.map(x=>x.text||'').join('\n');
 const text=result?.choices?.[0]?.message?.content;
 return typeof text==='string'?text:undefined;
}
export async function handleChat(req,res,{env=process.env,fetcher=fetch}={}){
 res.setHeader('Cache-Control','no-store');
 res.setHeader('X-Content-Type-Options','nosniff');
 if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'Method not allowed'});
 const access=verifyWebAccess(req,env);
 if(!access.ok)return res.status(access.status).json({error:access.status===503?'Dashboard access not configured':'Unauthorized'});
 if(req.method==='GET')return res.status(200).json({providers:listChatProviders(env)});
 if(req.headers?.['content-type']?.split(';')[0].trim()!=='application/json')return res.status(415).json({error:'JSON required'});
 const body=req.body;
 if(!body||typeof body!=='object'||Array.isArray(body))return res.status(400).json({error:'Invalid chat request'});
 const c=configs.find(x=>x.id===body.provider);
 const messages=checkMessages(body.messages);
 if(!c||!messages||JSON.stringify(body).length>22000)return res.status(400).json({error:'Invalid provider or messages'});
 const key=env[c.key];
 if(typeof key!=='string'||!key)return res.status(503).json({error:'Selected provider is not configured on the server'});
 const model=safeModel(env,c);
 const upstream=makeRequest(c,key,model,messages);
 try{
  const answer=await fetcher(upstream.url,{method:'POST',headers:{'Content-Type':'application/json',...upstream.headers},body:JSON.stringify(upstream.body),redirect:'error',signal:AbortSignal.timeout(25000)});
  if(!answer.ok)return res.status(502).json({error:'Provider request failed (HTTP '+answer.status+')'});
  const data=await answer.json();
  const text=extractText(c,data);
  if(typeof text!=='string'||!text.trim())return res.status(502).json({error:'Provider returned no text'});
  return res.status(200).json({provider:c.id,model,text:text.slice(0,20000)});
 }catch(error){
  console.error('OMH chat provider request failed:',error?.name||'Error');
  return res.status(502).json({error:'Provider unavailable; check server configuration'});
 }
}
