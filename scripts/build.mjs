import {cp, mkdir, rm} from 'node:fs/promises';
await rm('dist', {recursive:true, force:true});
await mkdir('dist');
for (const name of ['index.html','styles.css','app.js','form-core.js','config.js','assets']) await cp(name, `dist/${name}`, {recursive:true});
console.log('Static site built in dist/. Backend, tests, and secrets excluded.');
