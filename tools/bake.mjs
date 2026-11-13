// Runs tools/bake_cards.html in headless Chrome and saves its raw outputs.
// Usage: node bake.mjs <asset> [alpha map file]   (see tools/bake.sh)
import puppeteer from 'puppeteer-core';
import { writeFileSync, mkdirSync } from 'node:fs';

const [asset, alpha] = process.argv.slice(2);
const name = process.env.BAKE_NAME || asset; // what to call the output files
const base = process.env.SHOT_URL ?? 'http://localhost:8137/';
const out = process.env.BAKE_DIR ?? 'bake';
mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true, protocolTimeout: 1800000,
  args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11', '--force_high_performance_gpu',
    '--disable-gpu-vsync', '--js-flags=--max-old-space-size=16000'],
});
const page = await browser.newPage();
let shaderErrors = 0;
page.on('console', (m) => {
  const t = m.text();
  if (t.includes('THREE.WebGLProgram: Shader Error')) shaderErrors++;
  if (t.startsWith('bake:') || m.type() === 'error') console.log(t.slice(0, 500));
});
page.on('pageerror', (e) => console.log('pageerror: ' + e.stack));
await page.goto(`${base}tools/bake_cards.html?asset=${asset}${alpha ? `&alpha=${alpha}` : ''}${process.env.BAKE_QUERY ?? ''}`);
await page.waitForFunction(() => window.__bake && (window.__bake.done || window.__bake.error), { timeout: 1800000, polling: 1000 });
const info = await page.evaluate(() => ({ error: window.__bake.error, gpu: window.__bake.gpu,
  trees: window.__bake.trees.map(({ A, B, ...rest }) => rest) }));
if (info.error) { console.log(info.error); process.exit(1); }
if (shaderErrors) { console.log(`${shaderErrors} shader error(s): the bake would be blank. Nothing saved.`); process.exit(1); }
console.log('gpu: ' + info.gpu);
const STEP = 6 << 20;
for (const [i, t] of info.trees.entries()) {
  for (const which of ['A', 'B']) {
    const total = t.width * t.height * 4, parts = [];
    for (let s = 0; s < total; s += STEP) {
      parts.push(Buffer.from(await page.evaluate((i, w, s, n) => window.__bake.chunk(i, w, s, n), i, which, s, Math.min(STEP, total - s)), 'base64'));
    }
    writeFileSync(`${out}/${name}_${i}_${which}.rgba`, Buffer.concat(parts));
  }
  console.log(`saved ${t.name}: ${t.width}x${t.height}, ${t.top.toFixed(1)} m tall`);
}
writeFileSync(`${out}/${name}.json`, JSON.stringify(info.trees));
await browser.close();
