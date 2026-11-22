import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,symlink,rm,access} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {WorkspaceManager} from './workspaces.mjs';

test('workspace snapshots exclude symlinks and common credential files',async()=>{
 const root=await mkdtemp(join(tmpdir(),'omh-snap-'));
 const outside=await mkdtemp(join(tmpdir(),'omh-external-'));
 try{
  const m=new WorkspaceManager(root);
  const dir=await m.create('builder');
  await writeFile(join(dir,'code.txt'),'safe');
  await writeFile(join(dir,'.env.production'),'token=fake');
  await writeFile(join(dir,'credentials.pem'),'fake key');
  await writeFile(join(outside,'private.txt'),'private fixture');
  await symlink(outside,join(dir,'external'));
  await m.snapshot('builder','clean');
  await m.restore('builder','clean',{approved:true});
  assert.equal(await readFile(join(dir,'code.txt'),'utf8'),'safe');
  for(const name of ['.env.production','credentials.pem','external']){
   await assert.rejects(access(join(dir,name)),{code:'ENOENT'});
  }
 }finally{
  await rm(root,{recursive:true,force:true});
  await rm(outside,{recursive:true,force:true});
 }
});

test('snapshot restore requires strict boolean approval',async()=>{
 const root=await mkdtemp(join(tmpdir(),'omh-snap-'));
 try{
  const m=new WorkspaceManager(root);
  await m.create('tester');
  await m.snapshot('tester','baseline');
  await assert.rejects(m.restore('tester','baseline',{approved:'true'}),/approval/);
  await assert.rejects(m.restore('tester','baseline',{approved:1}),/approval/);
 }finally{await rm(root,{recursive:true,force:true});}
});
