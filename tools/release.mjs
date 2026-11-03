// Stamps a new version on every file reference in index.html and in version.json.
// Run before each push:  node tools/release.mjs
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const version = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14); // e.g. 20261103153042 (to the second, so every release is unique)

const indexUrl = new URL('index.html', root);
const html = readFileSync(indexUrl, 'utf8')
  .replace(/\?v=[\w.-]+/g, `?v=${version}`)
  .replace(/(<meta name="app-version" content=")[^"]*(")/, `$1${version}$2`);
// Every module must be in the import map, or phones could keep running an old copy of it.
const missing = readdirSync(root).filter((f) => f.endsWith('.js') && f !== 'app.js' && !html.includes(`"./${f}": "./${f}?v=`));
if (missing.length) {
  console.error(`Add these to the import map in index.html first: ${missing.join(', ')}`);
  process.exit(1);
}
writeFileSync(indexUrl, html);
writeFileSync(new URL('version.json', root), JSON.stringify({ v: version }) + '\n');
console.log(`version ${version}`);
