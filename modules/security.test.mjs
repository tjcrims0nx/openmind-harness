import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm,mkdir,writeFile,symlink} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {makeHandlers} from './queue-handlers.mjs';
test('OMH state and credential paths cannot be read',async()=>{const d=await mkdtemp(join(tmpdir(),'omh-'));try{const h=makeHandlers(d);await mkdir(join(d,'.omh'));await writeFile(join(d,'.omh','memory.json'),'secret');await assert.rejects(h['workspace.read']({path:'.omh/memory.json'}),/Sensitive path/);await writeFile(join(d,'.env'),'secret');await assert.rejects(h['workspace.read']({path:'.env'}),/Sensitive path/);}finally{await rm(d,{recursive:true,force:true});}});
test('symlink outside workspace refused',async()=>{const d=await mkdtemp(join(tmpdir(),'omh-'));const x=await mkdtemp(join(tmpdir(),'omh-'));try{await writeFile(join(x,'data'),'outside');await symlink(x,join(d,'out'));await assert.rejects(makeHandlers(d)['workspace.read']({path:'out/data'}),/Symlink escapes/);}finally{await rm(d,{recursive:true,force:true});await rm(x,{recursive:true,force:true});}});
test('workspace aliases cannot expose or write into sensitive paths', async t => {
 const workspace = await mkdtemp(join(tmpdir(), 'omh-'));
 t.after(() => rm(workspace, { recursive: true, force: true }));
 const handlers = makeHandlers(workspace);
 await mkdir(join(workspace, '.omh'));
 await writeFile(join(workspace, '.omh', 'memory.json'), 'private');
 await writeFile(join(workspace, '.env'), 'private');
 await writeFile(join(workspace, 'README.md'), 'public');
 await symlink('.omh', join(workspace, 'runtime'));
 await symlink('.env', join(workspace, 'settings'));
 await symlink('README.md', join(workspace, 'readme'));

 await assert.rejects(handlers['workspace.read']({ path: 'runtime/memory.json' }), /Sensitive path denied/);
 await assert.rejects(handlers['workspace.read']({ path: 'settings' }), /Sensitive path denied/);
 await assert.rejects(
  handlers['workspace.write']({ path: 'runtime/new.json', content: '{}', approved: true }),
  /Sensitive path denied/,
 );
 assert.equal(await handlers['workspace.read']({ path: 'readme' }), 'public');
});

test('sandbox workspace aliases are refused before mounting the guest directory', async t => {
 const workspace = await mkdtemp(join(tmpdir(), 'omh-'));
 t.after(() => rm(workspace, {recursive: true, force: true}));
 await mkdir(join(workspace, '.omh', 'sandboxes'), {recursive: true});
 await symlink(workspace, join(workspace, '.omh', 'sandboxes', 'alias'));
 const run = makeHandlers(workspace)['sandbox.exec'];
 await assert.rejects(
  run({command: 'sh', workspaceId: 'alias', approved: true}),
  /Sandbox workspace symlink denied/,
 );
});

test('privileged local operations require a literal boolean approval', async t => {
 const {PluginRegistry} = await import('./plugin-registry.mjs');
 const {WorkspaceManager} = await import('./workspaces.mjs');
 const root = await mkdtemp(join(tmpdir(), 'omh-approval-'));
 t.after(() => rm(root, {recursive: true, force: true}));
 const plugins = new PluginRegistry(join(root, 'plugins.json'));
 const manager = new WorkspaceManager(join(root, 'workspaces'));
 const manifest = {name: 'demo.plugin', version: '1.0.0', capabilities: ['files.read']};
 const workspace = await manager.create('reviewer');
 await manager.snapshot('reviewer', 'base');
 await writeFile(join(workspace, 'saved.txt'), 'keep');
 for (const approved of ['false', 'true', 1, {}]) {
  await assert.rejects(plugins.register({...manifest, approved}), /approval/);
  await assert.rejects(manager.restore('reviewer', 'base', {approved}), /approval/);
 }
 assert.equal(await makeHandlers(workspace)['workspace.read']({path: 'saved.txt'}), 'keep');
 await plugins.register({...manifest, approved: true});
 await assert.rejects(plugins.enable(manifest.name, {approved: 'true'}), /approval/);
 assert.deepEqual(plugins.allowedCapabilities(), []);
});

test('custom runtime state inside the workspace stays private through aliases', async t => {
 const workspace = await mkdtemp(join(tmpdir(), 'omh-state-path-'));
 t.after(() => rm(workspace, {recursive: true, force: true}));
 const stateDir = join(workspace, 'runtime-data');
 await mkdir(stateDir);
 await writeFile(join(stateDir, 'memory.json'), '{}');
 await symlink(stateDir, join(workspace, 'alias'));
 const handlers = makeHandlers(workspace, {stateDir});
 await assert.rejects(handlers['workspace.read']({path:'runtime-data/memory.json'}), /state path denied/);
 await assert.rejects(handlers['workspace.read']({path:'alias/memory.json'}), /state path denied/);
 await assert.rejects(handlers['workspace.write']({path:'alias/tasks.json',content:'{}',approved:true}), /state path denied/);
 await handlers['workspace.write']({path:'runtime-data-notes',content:'ok',approved:true});
 assert.equal(await handlers['workspace.read']({path:'runtime-data-notes'}), 'ok');
});
