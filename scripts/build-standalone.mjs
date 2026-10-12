import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
let html = await readFile(resolve(dist, 'index.html'), 'utf8');
const script = html.match(/<script[^>]+src="([^"]+)"[^>]*><\/script>/);
const stylesheet = html.match(/<link[^>]+href="([^"]+)"[^>]*>/);
if (!script || !stylesheet) throw new Error('Run npm run build first. Expected one bundled script and stylesheet.');
let javascript = await readFile(resolve(dist, script[1].replace(/^\//, '')), 'utf8');
const css = await readFile(resolve(dist, stylesheet[1].replace(/^\//, '')), 'utf8');
const svg = await readFile(resolve(root, 'public/sample.svg'), 'utf8');
const sampleUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
const sampleReference = /(["'`])\/sample\.svg\1/g;
if (sampleReference.test(javascript)) {
  javascript = javascript.replace(sampleReference, () => JSON.stringify(sampleUrl));
}
html = html.replace(script[0], () => `<script type="module">${javascript.replace(/<\/script/gi, '<\\/script')}</script>`);
html = html.replace(stylesheet[0], () => `<style>${css.replace(/<\/style/gi, '<\\/style')}</style>`);
const target = process.argv[2] ? resolve(process.argv[2]) : resolve(dist, 'PathForm.html');
await writeFile(target, html);
console.log(`Standalone browser application: ${target}`);
