'use strict';
// OpenMind Harness — cross-platform desktop shell.
// Only the bundled 127.0.0.1 dashboard is loaded into the renderer.
const {app,BrowserWindow,Menu,shell,dialog,nativeImage}=require('electron');
const {spawn}=require('node:child_process');
const {join,resolve}=require('node:path');
const {mkdirSync,existsSync}=require('node:fs');
const {writeFile}=require('node:fs/promises');
const {createInterface}=require('node:readline');

let windowRef;
let runtime;
let dashboardURL;
let quitting=false;
const runtimeFolder=()=>app.isPackaged?join(process.resourcesPath,'omh-runtime'):resolve(__dirname,'..');
function startRuntime(){
 const root=runtimeFolder();
 const dashboard=join(root,'scripts','omh-dashboard.mjs');
 if(!existsSync(dashboard))throw Error('Bundled OMH dashboard entry is missing');
 const workspace=process.env.OMH_WORKSPACE||join(app.getPath('userData'),'workspace');
 mkdirSync(workspace,{recursive:true});
 const env={...process.env,OMH_WORKSPACE:workspace,OMH_STATE_DIR:process.env.OMH_STATE_DIR||join(workspace,'.omh'),OMH_DASHBOARD_PORT:'0',ELECTRON_RUN_AS_NODE:'1'};
 // The Electron binary can run its bundled Node runtime as an isolated child.
 // No shell or external remote host is used.
 runtime=spawn(process.execPath,[dashboard],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 const output=createInterface({input:runtime.stdout});
 let ready=false;
 output.on('line',line=>{
  const match=/^OpenMind Harness dashboard at (http:\/\/127\.0\.0\.1:\d+)$/.exec(line);
  if(!match||ready)return;
  ready=true;
  dashboardURL=match[1];
  if(windowRef&&!windowRef.isDestroyed())void windowRef.loadURL(dashboardURL);
 });
 runtime.stderr.on('data',data=>process.stderr.write('[OMH] '+String(data).slice(0,2000)));
 runtime.on('error',err=>{
  if(!quitting)showFailure('The OMH runtime could not start: '+err.message);
 });
 runtime.on('exit',(code)=>{
  if(!quitting)showFailure('The local OMH runtime exited (code '+String(code)+').');
 });
}
function showFailure(message){
 if(process.env.OMH_DESKTOP_SCREENSHOT_DIR){console.error(message);app.exit(1);return;}
 if(!windowRef||windowRef.isDestroyed())return;
 void dialog.showMessageBox(windowRef,{type:'error',title:'OMH runtime unavailable',message,detail:'Use View > Reload after fixing the problem, or restart OpenMind Harness.'});
}
function createWindow(){
 windowRef=new BrowserWindow({
  width:1320,height:870,minWidth:390,minHeight:600,
  backgroundColor:'#06051a',title:'OpenMind Harness',
  icon:join(__dirname,'icon.png'),
  show:false,autoHideMenuBar:process.platform!=='darwin',
  webPreferences:{
   nodeIntegration:false,contextIsolation:true,sandbox:true,
   webSecurity:true,allowRunningInsecureContent:false,
   devTools:process.env.OMH_DESKTOP_DEVTOOLS==='1'
  }
 });
 windowRef.once('ready-to-show',()=>windowRef.show());
 // CI-only evidence: capture real Chromium-rendered OMH desktop/mobile layouts.
 // No provider tokens or prompts are included in the default offline fixture.
 if(process.env.OMH_DESKTOP_SCREENSHOT_DIR){
  let captured=false;
  windowRef.webContents.on('did-finish-load',async()=>{
   if(captured||!dashboardURL||windowRef.webContents.getURL()!==dashboardURL+'/')return;
   captured=true;
   try{
    const folder=resolve(process.env.OMH_DESKTOP_SCREENSHOT_DIR);
    mkdirSync(folder,{recursive:true});
    for(const [name,width,height] of [['desktop',1440,900],['mobile',420,880]]){
     windowRef.setSize(width,height);
     await new Promise(resolve=>setTimeout(resolve,1000));
     const screenshot=await windowRef.webContents.capturePage();
     await writeFile(join(folder,'omh-chat-'+name+'.png'),screenshot.toPNG());
    }
    console.log('Saved OMH desktop screenshot evidence to '+folder);
    app.quit();
   }catch(error){console.error('OMH screenshot capture failed:',error);app.exit(1);}
  });
 }
 windowRef.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 windowRef.webContents.on('will-navigate',(event,url)=>{
  if(!dashboardURL||!url.startsWith(dashboardURL+'/'))event.preventDefault();
 });
 windowRef.webContents.on('will-redirect',(event,url)=>{
  if(!dashboardURL||!url.startsWith(dashboardURL+'/'))event.preventDefault();
 });
 windowRef.webContents.on('will-attach-webview',event=>event.preventDefault());
 windowRef.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
 windowRef.webContents.on('context-menu',event=>event.preventDefault());
 // Avoid a blank application while the local dashboard starts.
 void windowRef.loadURL('data:text/html;charset=UTF-8,'+encodeURIComponent(
  '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{background:#06051a;color:#7defff;font:16px system-ui;display:grid;place-items:center;min-height:95vh}</style><main>◈ OMH · Starting local workspace…</main>'
 ));
 windowRef.on('closed',()=>{windowRef=null;});
}
function menu(){
 const template=[
  {label:'File',submenu:[
   {label:'Open Workspace',click:()=>{if(dashboardURL)void windowRef?.loadURL(dashboardURL);}},
   {label:'Reload Dashboard',accelerator:'CmdOrCtrl+R',click:()=>windowRef?.webContents.reload()},
   {type:'separator'},
   {role:'quit'}
  ]},
  {label:'View',submenu:[{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'},
    ...(process.env.OMH_DESKTOP_DEVTOOLS==='1'?[{role:'toggleDevTools'}]:[])]},
  {label:'Window',submenu:[{role:'minimize'},{role:'close'}]},
  {label:'Help',submenu:[{label:'OMH source repository',click:()=>shell.openExternal('https://github.com/tjcrims0nx/openmind-harness')}]}
 ];
 Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
function stopRuntime(){
 quitting=true;
 if(runtime&&!runtime.killed){
  runtime.kill();
  runtime=null;
 }
}
app.on('before-quit',stopRuntime);
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
app.on('activate',()=>{if(!BrowserWindow.getAllWindows().length)createWindow();});
app.whenReady().then(()=>{
 app.setAppUserModelId('app.openmind.harness.desktop');
 menu();
 createWindow();
 if(process.env.OMH_DESKTOP_SCREENSHOT_DIR)setTimeout(()=>{console.error('OMH desktop screenshot startup timed out');app.exit(1);},45000).unref();
 try{startRuntime();}catch(e){showFailure(e.message);}
}).catch(error=>{console.error('OMH Electron startup error:',error);app.quit();});
