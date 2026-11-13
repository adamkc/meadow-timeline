// Walks forward for six seconds in open meadow, a thicket, mature forest and upland forest and prints the speed.
// Run with Windows Node from %TEMP%\meadow_tools (needs puppeteer-core): node walk_test.mjs
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  defaultViewport: { width: 1600, height: 900 },
  args: ['--window-size=1600,900', '--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11', '--force_high_performance_gpu'] });
for (const [label, query] of [['open meadow (stage 1)', 'walk=-178,-39,90&stage=0'], ['thicket (stage 5)', 'walk=-178,-39,90&stage=4'], ['mature forest (stage 7)', 'walk=-178,-39,90&stage=6'], ['upland forest', 'walk=-10,-391,90&stage=0']]) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('pageerror:', e.stack.slice(0, 400)));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) console.log('console error:', m.text().slice(0, 300)); });
  await page.goto('http://localhost:8137/?' + query);
  await page.waitForFunction(() => window.__meadow && window.__meadow.frames > 60, { timeout: 120000 });
  const a = await page.evaluate(() => window.__meadow.stats());
  await page.keyboard.down('KeyW');
  await new Promise((r) => setTimeout(r, 6000));
  await page.keyboard.up('KeyW');
  const b = await page.evaluate(() => window.__meadow.stats());
  const d = Math.hypot(b.position[0] - a.position[0], b.position[2] - a.position[2]);
  console.log(`${label}: mode=${b.mode}, walked ${d.toFixed(1)} m in 6 s (${(d / 6).toFixed(2)} m/s), ease now ${b.ease.toFixed(2)}, eye ${(b.position[1] - b.ground).toFixed(2)} m above ground`);
  await page.close();
}
await browser.close();
