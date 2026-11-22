#!/usr/bin/env node
/**
 * Assemble a portable OMH runtime distribution.
 * Requires Node.js 22+ on the target; does not bundle OpenCode or providers.
 * No code is executed from the user's home during packaging.
 */
import {cp,mkdir,rm,writeFile,readFile,access} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const target=process.argv[2] || process.platform;
if(!/^(linux|darwin|win32|android)$/.test(target))throw Error('Unsupported package target: '+target);
const dest=resolve(root,'dist','omh-runtime-'+({darwin:'macos',win32:'windows',android:'termux',linux:'linux'}[target]));
await rm(dest,{recursive:true,force:true});
await mkdir(join(dest,'bin'),{recursive:true});
await mkdir(join(dest,'scripts'),{recursive:true});
for(const path of ['modules','dashboard','LICENSE','opencode.json'])
 await cp(join(root,path),join(dest,path),{recursive:true});
for(const name of ['omh-runtime.mjs','omh-daemon.mjs','omh-dashboard.mjs','omh-mcp.mjs','omh-live.mjs'])
 await cp(join(root,'scripts',name),join(dest,'scripts',name),{recursive:true});
const unix='#!/usr/bin/env sh\nset -eu\nDIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"\nexec node "$DIR/scripts/omh-runtime.mjs" "$@"\n';
const dashboard='#!/usr/bin/env sh\nset -eu\nDIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"\nexec node "$DIR/scripts/omh-dashboard.mjs" "$@"\n';
const windows='@echo off\r\nset "OMH_DIR=%~dp0.."\r\nnode "%OMH_DIR%\\scripts\\omh-runtime.mjs" %*\r\nexit /b %ERRORLEVEL%\r\n';
const windowsDash='@echo off\r\nset "OMH_DIR=%~dp0.."\r\nnode "%OMH_DIR%\\scripts\\omh-dashboard.mjs" %*\r\nexit /b %ERRORLEVEL%\r\n';
await writeFile(join(dest,'bin','omh'),unix,{mode:0o755});
await writeFile(join(dest,'bin','omh-dashboard'),dashboard,{mode:0o755});
await writeFile(join(dest,'bin','omh.cmd'),windows);
await writeFile(join(dest,'bin','omh-dashboard.cmd'),windowsDash);
await writeFile(join(dest,'README.txt'),[
 'OpenMind Harness portable runtime',
 'Target: '+target,
 'Requires: Node.js 22 or newer installed separately.',
 'This is a portable runnable package, NOT a standalone native executable.',
 'OpenCode and provider credentials are NOT bundled.',
 'Linux/macOS/Termux: sh bin/omh status',
 'Windows: bin\\omh.cmd status',
 'Dashboard: sh bin/omh-dashboard (Unix) or bin\\omh-dashboard.cmd (Windows)',
 'Dashboard is local-only on 127.0.0.1; run from a trusted workspace.',
 'Native agent tasks require a separately installed compatible OpenCode binary.',
 'Linux Bubblewrap isolation depends on actual kernel support; unsupported platforms fail closed.',
 'See https://github.com/tjcrims0nx/openmind-harness for documentation.',
 ''
].join('\n'));
for(const p of ['scripts/omh-runtime.mjs','scripts/omh-dashboard.mjs','modules/sandbox.mjs'])await access(join(dest,p));
const config=JSON.parse(await readFile(join(dest,'opencode.json'),'utf8'));
if(!config.model)throw Error('Missing default model in portable config');
console.log(dest);
