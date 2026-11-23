import {copyFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,resolve,join} from 'node:path';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
await mkdir(join(root,'public'),{recursive:true});
await copyFile(resolve(root,'../dashboard/app-icon.webp'),join(root,'public','app-icon.webp'));
console.log('OMH official logo copied into frontend build assets');
