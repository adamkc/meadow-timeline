// Watches the scene run as a visitor would see it (no fixed frame) and prints
// how the quality settles. Usage: node live.mjs "<query>" [seconds=16] [shot name]
import puppeteer from 'puppeteer-core';
const [query = '', seconds = '16', shot] = process.argv.slice(2);
const [width, height] = (process.env.SHOT_SIZE ?? '1600x900').split('x').map(Number);
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, defaultViewport: { width, height },
  // Vsync is left on here: the point is to see what a visitor's browser would do.
  args: [`--window-size=${width},${height}`, '--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11', ...(process.env.SHOT_GPU === 'high' ? ['--force_high_performance_gpu'] : [])],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) console.log(`error: ${m.text().slice(0, 600)}`); });
await page.goto(`${process.env.SHOT_URL ?? 'http://localhost:8137/'}?info=1&${query}`);
await page.waitForFunction(() => window.__meadow && window.__meadow.frames > 5, { timeout: 90000 });
for (let t = 0; t < Number(seconds); t += 2) {
  await new Promise((r) => setTimeout(r, 2000));
  const s = await page.evaluate(() => window.__meadow.stats());
  console.log(`${String(t + 2).padStart(3)} s: ${(1000 / s.ms).toFixed(0)} fps, GPU ${s.gpuMs?.toFixed(1) ?? '?'} ms, scale ${s.scale.toFixed(2)}, plants ${(s.detail * 100).toFixed(0)}%, ${(s.triangles / 1e6).toFixed(2)}M tris, ${s.gpu.split(',')[1]}`);
}
if (shot) await page.screenshot({ path: `${process.env.SHOT_DIR ?? '.'}/${shot}.png` });
await browser.close();
