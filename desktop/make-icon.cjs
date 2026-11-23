'use strict';
const sharp=require('sharp');
const {join}=require('node:path');
const source=join(__dirname,'..','dashboard','app-icon.webp');
const dest=join(__dirname,'icon.png');
// Package the first-party OMH cobalt hexagon, not the default Electron icon.
sharp(source).resize(1024,1024,{fit:'contain',background:'#05051a'})
 .png().toFile(dest).then(()=>console.log('Prepared OMH desktop icon: '+dest))
 .catch(error=>{console.error('Icon generation failed:',error.message);process.exitCode=1;});
