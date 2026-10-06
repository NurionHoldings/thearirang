import {cp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {build} from 'esbuild';
await rm('dist',{recursive:true,force:true});await mkdir('dist',{recursive:true});await cp('public','dist',{recursive:true});
const html=await readFile('dist/index.html','utf8');await writeFile('dist/index.html',html.replace('<script type="module" src="app.js">','<script type="module" src="netlify-app.js">'));
await build({entryPoints:['src/netlify-app.js'],outfile:'dist/netlify-app.js',bundle:true,format:'esm',target:['es2022'],minify:true});
console.log('Netlify ready: dist + netlify/functions');

await build({entryPoints:['src/drawings-app.js'],outfile:'dist/drawings.js',bundle:true,format:'esm',target:['es2022'],minify:true});
