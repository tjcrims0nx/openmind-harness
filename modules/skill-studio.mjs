/** Human-approved skill writer: no executable content or automatic promotion. */
import {mkdir,writeFile,realpath} from 'node:fs/promises';
import {join} from 'node:path';
export async function publishSkill({root,name,description,instructions,approved=false}={}){
 if(approved!==true)throw new Error('Skill publication requires approval');
 if(typeof name!=='string'||!/^[a-z][a-z0-9-]{1,48}$/.test(name))throw new TypeError('Invalid skill name');
 if(typeof description!=='string'||!description.trim()||description.length>500||/[\r\n]/.test(description))throw new TypeError('Invalid description');
 if(typeof instructions!=='string'||!instructions.trim()||instructions.length>50000)throw new TypeError('Invalid instructions');
 const dir=join(root,name);await mkdir(dir,{recursive:true});const [parent,actual]=await Promise.all([realpath(root),realpath(dir)]);if(!actual.startsWith(parent+'/'))throw new Error('Skill directory escapes root');
 const content=`---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n${instructions}\n`;
 await writeFile(join(actual,'SKILL.md'),content,{flag:'wx',mode:0o600});return {name,path:join(actual,'SKILL.md')};
}
