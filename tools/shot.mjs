// Screenshots and frame timing through a real (headless) Chrome.
// Usage: node shot.mjs name="u=0.3&yaw=20" other="u=0.6"
// Needs puppeteer-core next to this file; see tools/shot.sh for the WSL wrapper.
import puppeteer from 'puppeteer-core';

const base = process.env.SHOT_URL ?? 'http://localhost:8137/';
const outDir = process.env.SHOT_DIR ?? '.';
const [width, height] = (process.env.SHOT_SIZE ?? '1600x900').split('x').map(Number);
const shots = process.argv.slice(2).map((a) => { const i = a.indexOf('='); return [a.slice(0, i), a.slice(i + 1)]; });

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  defaultViewport: { width, height },
  // SHOT_GPU=high picks the discrete GPU on a laptop; the default is whatever Chrome would use.
  args: [`--window-size=${width},${height}`, '--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11',
    '--disable-gpu-vsync', '--disable-frame-rate-limit', ...(process.env.SHOT_GPU === 'high' ? ['--force_high_performance_gpu'] : [])],
});
for (const [name, query] of shots) {
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[${name}] ${m.type()}: ${m.text().slice(0, 700)}`); });
  page.on('pageerror', (e) => console.log(`[${name}] pageerror: ${e.message}`));
  await page.goto(`${base}?${query}`);
  try {
    await page.waitForFunction(() => window.__meadow && window.__meadow.frames > 90, { timeout: 90000 });
    const s = await page.evaluate(() => window.__meadow.stats());
    console.log(`[${name}] stage ${s.stage.toFixed(1)}, ${s.ms.toFixed(1)} ms/frame, ${s.calls} calls, ${(s.triangles / 1e6).toFixed(2)}M tris, ${s.nearTrees} near trees, ${s.gpu}`);
  } catch (e) {
    console.log(`[${name}] did not become ready: ${e.message}`);
  }
  await page.screenshot({ path: `${outDir}/${name}.png` });
  await page.close();
}
await browser.close();
