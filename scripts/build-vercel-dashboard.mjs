#!/usr/bin/env node
/** Publish only the static browser client; all OMH workers remain on Linux. */
import {cp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,join,resolve} from 'node:path';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const output=join(root,'public');
await rm(output,{recursive:true,force:true});
await mkdir(output,{recursive:true});
for(const file of ['dashboard.css','dashboard.js','app-icon.webp','orbit.webp','orbitron.ttf','icons.svg'])
 await cp(join(root,'dashboard',file),join(output,file));
const html=(await readFile(join(root,'dashboard','index.html'),'utf8'))
 .replace('<html lang="en">','<html lang="en" data-omh-remote="true">');
if(!html.includes('data-omh-remote="true"'))throw Error('Cannot mark remote dashboard');
await writeFile(join(output,'index.html'),html);
console.log('OMH Vercel frontend built: '+output);
