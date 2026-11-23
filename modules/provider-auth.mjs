// Provider credentials are read only from the guest process environment.
// Never return, persist, or log bearer credentials.
export const PROVIDER_CREDENTIALS = Object.freeze({
 openai:'OPENAI_API_KEY',anthropic:'ANTHROPIC_API_KEY',
 google:'GEMINI_API_KEY',deepseek:'DEEPSEEK_API_KEY',
 zai:'ZAI_API_KEY',moonshotai:'MOONSHOT_API_KEY',
 qwen:'DASHSCOPE_API_KEY',custom:'OPENMIND_CUSTOM_API_KEY'
});
export function connectorStatuses(env=process.env){
 return Object.entries(PROVIDER_CREDENTIALS).map(([id,key])=>({
  id,method:'api_key',status:typeof env[key]==='string'&&env[key].trim()?'configured':'disconnected',
  verified:false
 }));
}
const PROBES=Object.freeze({
 openai:{url:'https://api.openai.com/v1/models',headers:token=>({Authorization:'Bearer '+token})},
 anthropic:{url:'https://api.anthropic.com/v1/models',headers:token=>({'x-api-key':token,'anthropic-version':'2023-06-01'})},
 google:{url:'https://generativelanguage.googleapis.com/v1beta/models',headers:token=>({'x-goog-api-key':token})},
 deepseek:{url:'https://api.deepseek.com/models',headers:token=>({Authorization:'Bearer '+token})},
 zai:{url:'https://api.z.ai/api/paas/v4/models',headers:token=>({Authorization:'Bearer '+token})},
 moonshotai:{url:'https://api.moonshot.ai/v1/models',headers:token=>({Authorization:'Bearer '+token})},
 qwen:{url:'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/models',headers:token=>({Authorization:'Bearer '+token})}
});
export async function verifyConnector(id,{env=process.env,fetchImpl=fetch,timeoutMs=8000}={}){
 if(!Object.hasOwn(PROVIDER_CREDENTIALS,id))return {id,status:'unsupported',verified:false};
 const token=env[PROVIDER_CREDENTIALS[id]];
 if(typeof token!=='string'||!token.trim())return {id,status:'disconnected',verified:false};
 // User-supplied endpoints must not be probed automatically (SSRF / token leakage).
 if(id==='custom')return {id,status:'configured',verified:false,reason:'Custom endpoint requires an explicitly authorized verification target'};
 const probe=PROBES[id];
 try{
  const response=await fetchImpl(probe.url,{method:'GET',headers:probe.headers(token),signal:AbortSignal.timeout(timeoutMs),redirect:'error'});
  return {id,status:response.ok?'connected':response.status===401||response.status===403?'unauthorized':'verification_failed',verified:response.ok};
 }catch{return {id,status:'unreachable',verified:false};}
}
