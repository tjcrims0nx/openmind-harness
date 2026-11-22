/** Reviewable skill improvement proposals; never install automatically. */
import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {publishSkill} from './skill-studio.mjs';
export class SkillProposalStore {
 constructor(file){if(!file)throw TypeError('File required');this.file=file;this.proposals=[];}
 async load(){try{const x=JSON.parse(await readFile(this.file,'utf8'));if(!Array.isArray(x.proposals))throw Error('Invalid proposal file');this.proposals=x.proposals;}catch(e){if(e.code!=='ENOENT')throw e;}return this;}
 async save(){await mkdir(dirname(this.file),{recursive:true});const tmp=this.file+'.'+randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify({version:1,proposals:this.proposals},null,2),{mode:0o600});await rename(tmp,this.file);}
 async propose({name,description,instructions,evidence=''}={}){if(typeof name!=='string'||!/^[a-z][a-z0-9-]{1,48}$/.test(name)||typeof description!=='string'||description.length>500||!description.trim()||typeof instructions!=='string'||instructions.length>50000||!instructions.trim()||typeof evidence!=='string'||evidence.length>4000)throw TypeError('Invalid skill proposal');const p={id:randomUUID(),name,description,instructions,evidence,status:'pending',createdAt:new Date().toISOString()};this.proposals.push(p);await this.save();return structuredClone(p);}
 list(status){return structuredClone(this.proposals.filter(p=>!status||p.status===status));}
 async review(id,{decision,approved=false,root}={}){if(approved!==true)throw Error('Human review approval required');if(!['accept','reject'].includes(decision))throw TypeError('Invalid review decision');const p=this.proposals.find(x=>x.id===id&&x.status==='pending');if(!p)throw Error('Proposal missing or reviewed');if(decision==='accept'){const r=await publishSkill({root,name:p.name,description:p.description,instructions:p.instructions,approved:true});p.path=r.path;p.status='accepted';}else p.status='rejected';p.reviewedAt=new Date().toISOString();await this.save();return structuredClone(p);}
}
