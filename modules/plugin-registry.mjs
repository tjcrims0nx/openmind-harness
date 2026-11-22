/** Declarative plugin studio: review, register and toggle plugin capabilities. */
import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
const valid=x=>typeof x==='string'&&/^[a-z][a-z0-9.-]{1,63}$/.test(x);
export class PluginRegistry {
 constructor(file){if(!file)throw TypeError('Plugin registry path required');this.file=file;this.plugins=[];}
 async load(){try{const d=JSON.parse(await readFile(this.file,'utf8'));if(!Array.isArray(d.plugins))throw Error('Invalid plugin manifest store');this.plugins=d.plugins;}catch(e){if(e.code!=='ENOENT')throw e;}return this;}
 async save(){await mkdir(dirname(this.file),{recursive:true});const tmp=this.file+'.'+randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify({version:1,plugins:this.plugins},null,2),{mode:0o600});await rename(tmp,this.file);}
 async register({name,version,description='',capabilities=[],approved=false}={}){
  if(!approved)throw Error('Plugin installation requires approval');
  if(!valid(name)||typeof version!=='string'||!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?$/.test(version)||typeof description!=='string'||description.length>1000||!Array.isArray(capabilities)||capabilities.length>100||!capabilities.every(valid))throw TypeError('Invalid plugin manifest');
  if(this.plugins.some(p=>p.name===name))throw Error('Plugin already registered');
  const plugin={name,version,description,capabilities:[...new Set(capabilities)],enabled:false,registeredAt:new Date().toISOString()};
  this.plugins.push(plugin);await this.save();return structuredClone(plugin);
 }
 async enable(name,{approved=false}={}){if(!approved)throw Error('Plugin enable requires approval');const p=this.plugins.find(x=>x.name===name);if(!p)throw Error('Plugin unknown');p.enabled=true;await this.save();return structuredClone(p);}
 async disable(name){const p=this.plugins.find(x=>x.name===name);if(!p)throw Error('Plugin unknown');p.enabled=false;await this.save();return structuredClone(p);}
 list(){return structuredClone(this.plugins);}
 allowedCapabilities(){return [...new Set(this.plugins.filter(p=>p.enabled).flatMap(p=>p.capabilities))].sort();}
}
