'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync,existsSync}=require('node:fs');
const {join}=require('node:path');
const root=join(__dirname,'..');
const main=readFileSync(join(__dirname,'main.cjs'),'utf8');
const config=require('./package.json');
test('desktop entry bundles local OMH runtime on every OS',()=>{
 assert.equal(config.main,'main.cjs');
 assert.match(main,/OMH_DASHBOARD_PORT:'0'/);
 assert.match(main,/ELECTRON_RUN_AS_NODE:'1'/);
 assert.match(main,/app\.isPackaged/);
 assert.match(main,/127\\\.0\\\.0\\\.1/);
 assert.ok(config.build.extraResources.some(x=>x.to==='omh-runtime/modules'));
 assert.ok(config.build.extraResources.some(x=>x.to==='omh-runtime/lib'));
 assert.ok(config.build.extraResources.some(x=>x.to==='omh-runtime/dashboard'));
 assert.ok(config.build.extraResources.some(x=>x.to==='omh-runtime/scripts'));
});
test('renderer uses isolated sandbox and restricts navigations',()=>{
 assert.match(main,/nodeIntegration:false,contextIsolation:true,sandbox:true/);
 assert.match(main,/webSecurity:true/);
 assert.match(main,/setWindowOpenHandler/);
 assert.match(main,/will-navigate/);
 assert.match(main,/setPermissionRequestHandler/);
 assert.doesNotMatch(main,/--no-sandbox/);
});
test('build output includes branded installers on Windows macOS Linux',()=>{
 for(const command of ['dist:win','dist:mac','dist:linux'])assert.ok(config.scripts[command]);
 assert.deepEqual(config.build.win.target,['nsis','portable']);
 assert.deepEqual(config.build.mac.target,['dmg','zip']);
 assert.deepEqual(config.build.linux.target,['AppImage','deb']);
 assert.match(readFileSync(join(__dirname,'make-icon.cjs'),'utf8'),/app-icon\.webp/);
 assert.ok(existsSync(join(root,'dashboard','app-icon.webp')));
});
test('chat is the default dashboard screen with provider selection',()=>{
 const html=readFileSync(join(root,'dashboard','index.html'),'utf8');
 const js=readFileSync(join(root,'dashboard','dashboard.js'),'utf8');
 assert.match(html,/id="chat-provider"/);
 assert.match(html,/id="chat-form"/);
 assert.match(js,/let active = 'chat'/);
 assert.match(js,/runtimeFetch\('\/api\/chat'/);
 assert.match(js,/X-OMH-CSRF/);
});
