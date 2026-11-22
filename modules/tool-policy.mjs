/** Explicit MCP/tool permissions. Unknown tools are denied. */
export class ToolPolicy {
 constructor({allow=[],ask=[]}={}) {
   if(!Array.isArray(allow)||!Array.isArray(ask))throw new TypeError('Permission lists must be arrays');
   this.allow=new Set(allow);this.ask=new Set(ask);
 }
 check(name,{approved=false}={}) {
   if(typeof name!=='string'||!name.trim())throw new TypeError('Tool name required');
   if(this.allow.has(name))return {allowed:true,reason:'allowlist'};
   if(this.ask.has(name)&&approved===true)return {allowed:true,reason:'approved'};
   return {allowed:false,reason:this.ask.has(name)?'approval-required':'unregistered-tool'};
 }
 require(name,opts){const result=this.check(name,opts);if(!result.allowed)throw Error(`Tool denied: ${name} (${result.reason})`);return true;}
}
