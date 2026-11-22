/** Per-agent workspaces and explicit snapshots. Not a security boundary by themselves. */
import {mkdir,cp,rm,readdir,lstat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const VALID=/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const safe=(root,id)=>{if(typeof id!=='string'||!VALID.test(id))throw new TypeError('Invalid workspace id');return join(root,id);};
const blocked=(name)=>['.git','.ssh','.gnupg','.omh','node_modules','.npmrc'].includes(name)||/^\.env(?:\..*)?$/.test(name)||/\.(?:pem|key|p12|pfx)$/i.test(name);
export class WorkspaceManager{
 constructor(root){if(typeof root!=='string'||!root)throw TypeError('Workspace root required');this.root=resolve(root);}
 async create(id){const dir=safe(join(this.root,'agents'),id);await mkdir(dir,{recursive:true});return dir;}
 async list(){try{return (await readdir(join(this.root,'agents'),{withFileTypes:true})).filter(d=>d.isDirectory()&&VALID.test(d.name)).map(d=>d.name);}catch(e){if(e.code==='ENOENT')return [];throw e;}}
 async snapshot(id,snapshotId){const source=safe(join(this.root,'agents'),id),dest=safe(join(this.root,'snapshots',id),snapshotId);const info=await lstat(source);if(info.isSymbolicLink()||!info.isDirectory())throw Error('Invalid workspace');await mkdir(resolve(dest,'..'),{recursive:true});await cp(source,dest,{recursive:true,force:false,errorOnExist:true,filter:async p=>{const info=await lstat(p);if(info.isSymbolicLink())return false;const rel=p.slice(source.length).split('/').filter(Boolean);return !rel.some(blocked);}});return dest;}
 async restore(id,snapshotId,{approved=false}={}){if(approved!==true)throw Error('Restore requires approval');const snap=safe(join(this.root,'snapshots',id),snapshotId);const info=await lstat(snap);if(info.isSymbolicLink()||!info.isDirectory())throw Error('Snapshot absent');const dest=safe(join(this.root,'agents'),id);await rm(dest,{recursive:true,force:true});await cp(snap,dest,{recursive:true,force:false,errorOnExist:true});return dest;}
}
