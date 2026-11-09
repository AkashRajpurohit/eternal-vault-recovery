import { createHash } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = new URL('../dist-tool/', import.meta.url).pathname;
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const target = join(dir, 'recover.html');
renameSync(join(dir, 'index.html'), target);

const html = readFileSync(target);
const sha256 = createHash('sha256').update(html).digest('hex');
writeFileSync(join(dir, 'SHA256SUMS'), `${sha256}  recover.html\n`);
writeFileSync(
  join(dir, 'recover.json'),
  `${JSON.stringify({ version: pkg.version, sha256, bytes: html.length }, null, 2)}\n`,
);
console.log(`recover.html v${pkg.version} ${html.length} bytes sha256=${sha256}`);
