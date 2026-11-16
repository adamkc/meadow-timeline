// Renders the scene's sound offline (tools/sound_test.html) and reports levels:
// each situation's loudness and peak, and each layer on its own. Also saves
// each situation as a WAV file in out/sound/. Run with Windows Node from
// %TEMP%\meadow_tools (needs puppeteer-core): node sound_test.mjs
import puppeteer from 'puppeteer-core';
import { writeFileSync, mkdirSync } from 'node:fs';
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('error: ' + m.text().slice(0, 300)); });
await page.goto((process.env.SHOT_URL ?? 'http://localhost:8137/') + 'tools/sound_test.html');
await page.waitForFunction(() => window.__sound, { timeout: 120000 });
const r = await page.evaluate(() => window.__sound);
const dB = (v) => (v > 0 ? (20 * Math.log10(v)).toFixed(1).padStart(6) : '  -inf');
console.log('situation                        loudness (RMS dBFS)   peak dBFS');
for (const [k, v] of Object.entries(r.cases)) console.log(`${k.padEnd(32)} ${dB(v.rms)}                ${dB(v.peak)}${v.bad ? '   BAD SAMPLES: ' + v.bad : ''}`);
console.log('each layer alone, at full:');
for (const [k, v] of Object.entries(r.solo)) console.log(`  ${k.padEnd(14)} ${dB(v.rms)} RMS  ${dB(v.peak)} peak`);
mkdirSync('out/sound', { recursive: true });
for (const name of Object.keys(r.cases)) {
  const n = r.sampleRate * 24, parts = [];
  for (let s = 0; s < n; s += 200000) parts.push(Buffer.from(await page.evaluate((a, b, c) => window.__chunk(a, b, c), name, s, Math.min(200000, n - s)), 'base64'));
  const data = Buffer.concat(parts), head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVEfmt ', 8); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(r.sampleRate, 24); head.writeUInt32LE(r.sampleRate * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34); head.write('data', 36); head.writeUInt32LE(data.length, 40);
  writeFileSync(`out/sound/${name}.wav`, Buffer.concat([head, data]));
}
await browser.close();
