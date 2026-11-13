// Renders short runs of consecutive frames so flicker can be measured rather
// than guessed at (tools/flicker.py turns them into maps).
// Usage: node flicker.mjs <name> "<query>" [positions=8] [frames=6] [mode=move|wind|both]
//   move: the camera advances as in the tour, the clock stands still
//   wind: the camera stands still, the clock advances
//   both: as it plays
// The picture is stepped one frame per call (window.__meadow.step), so the
// timings of a real run do not matter.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const [name, query = '', positions = '8', count = '6', mode = 'both'] = process.argv.slice(2);
const base = process.env.SHOT_URL ?? 'http://localhost:8137/';
const outDir = `${process.env.SHOT_DIR ?? '.'}/${name}`;
const [width, height] = (process.env.SHOT_SIZE ?? '1600x900').split('x').map(Number);
const period = Number(process.env.PERIOD ?? 170), fps = Number(process.env.FPS ?? 60);
fs.mkdirSync(outDir, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  defaultViewport: { width, height },
  args: [`--window-size=${width},${height}`, '--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11',
    '--disable-gpu-vsync', '--disable-frame-rate-limit', ...(process.env.SHOT_GPU === 'high' ? ['--force_high_performance_gpu'] : [])],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') console.log(`error: ${m.text().slice(0, 500)}`); });
await page.goto(`${base}?u=0&grain=0&${query}`);
await page.waitForFunction(() => window.__meadow && window.__meadow.frames > 60, { timeout: 90000 });
await page.addStyleTag({ content: '#timeline { display: none }' });
// One call draws exactly one frame, as playback would: the picture is built
// from several frames blended over time, so each run starts with frames that
// are not kept.
const WARM = 24;
const draw = (u, time, stage) => page.evaluate((u, time, stage) => new Promise((done) => {
  window.__meadow.step(u, time, stage ?? undefined);
  requestAnimationFrame(() => requestAnimationFrame(done)); // let the browser show it
}), u, time, stage);
// STAGE_FROM and STAGE_RATE (stages a second; Play runs at 0.1) move the timeline during each run too.
const stageFrom = process.env.STAGE_FROM === undefined ? null : Number(process.env.STAGE_FROM), stageRate = Number(process.env.STAGE_RATE ?? 0.1);
for (let p = 0; p < Number(positions); p++) {
  for (let f = -WARM; f < Number(count); f++) {
    const u = p / Number(positions) + (mode === 'wind' ? 0 : f / fps / period);
    const time = 10 + p * 7.3 + (mode === 'move' ? 0 : f / fps);
    await draw(u, time, stageFrom === null ? null : stageFrom + p * 0.35 + stageRate * f / fps);
    if (f >= 0) await page.screenshot({ path: `${outDir}/p${String(p).padStart(2, '0')}_f${f}.png` });
  }
}
console.log(JSON.stringify(await page.evaluate(() => window.__meadow.stats())));
await browser.close();
