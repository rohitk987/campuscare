import {copyFile,mkdir,writeFile} from 'node:fs/promises';

// Reuse the reviewed proxy so Workers and Pages retain identical access checks.
const directory=new URL('./dist/',import.meta.url);
await mkdir(directory,{recursive:true});
await copyFile(new URL('../worker.mjs',import.meta.url),new URL('_worker.js',directory));
await writeFile(new URL('_routes.json',directory),JSON.stringify({version:1,include:['/*'],exclude:[]},null,2)+'\n');
console.log('CampusCare Pages proxy prepared. No secrets or application data are included.');
