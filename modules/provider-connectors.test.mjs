import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const config=JSON.parse(readFileSync(new URL('../opencode.json',import.meta.url),'utf8'));
test('provider connectors preserve the universal endpoint and supported credential references',()=>{
 const p=config.provider;
 for(const [name,key] of Object.entries({anthropic:'ANTHROPIC_API_KEY',google:'GEMINI_API_KEY',deepseek:'DEEPSEEK_API_KEY',zai:'ZAI_API_KEY',moonshotai:'MOONSHOT_API_KEY',qwen:'DASHSCOPE_API_KEY'})){
  assert.equal(p[name]?.options?.apiKey,'{env:'+key+'}',name);
 }
 assert.deepEqual(p.openai,{},'OpenAI provider must permit native OAuth auth, not force an env key');
 assert.equal(p.custom.options.baseURL,'{env:OPENMIND_CUSTOM_BASE_URL}');
 assert.equal(p.custom.options.apiKey,'{env:OPENMIND_CUSTOM_API_KEY}');
 for(const name of ['zai','moonshotai','qwen']){
  assert.equal(p[name].npm,'@ai-sdk/openai-compatible');
  assert.ok(p[name].options.baseURL.startsWith('https://'));
 }
});
