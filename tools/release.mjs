// Stamps a new version on every file reference in index.html and in version.json.
// Run before each push:  node tools/release.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const version = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12); // e.g. 202611031530

const indexUrl = new URL('index.html', root);
const html = readFileSync(indexUrl, 'utf8')
  .replace(/\?v=[\w.-]+/g, `?v=${version}`)
  .replace(/(<meta name="app-version" content=")[^"]*(")/, `$1${version}$2`);
writeFileSync(indexUrl, html);
writeFileSync(new URL('version.json', root), JSON.stringify({ v: version }) + '\n');
console.log(`version ${version}`);
