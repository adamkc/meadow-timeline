// Drives the timeline the way a visitor would: number keys, the track, Play, F, H and the landscape view.
// Run with Windows Node from %TEMP%\meadow_tools (needs puppeteer-core): node timeline_test.mjs
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  defaultViewport: { width: 1600, height: 900 }, protocolTimeout: 60000,
  args: ['--window-size=1600,900', '--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11', '--force_high_performance_gpu'] });
const page = await browser.newPage();
const problems = [];
page.on('pageerror', (e) => problems.push('pageerror: ' + String(e.stack).slice(0, 300)));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) problems.push('console: ' + m.text().slice(0, 300)); });
await page.goto('http://localhost:8137/');
await page.waitForFunction(() => window.__meadow && window.__meadow.frames > 60, { timeout: 120000 });
const stage = () => page.evaluate(() => window.__meadow.stats().stage);
const title = () => page.evaluate(() => document.getElementById('stage-title').textContent);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
console.log(`start: stage ${(await stage()).toFixed(2)}, "${await title()}"`);
await page.keyboard.press('Digit4'); await wait(5000);
console.log(`key 4: stage ${(await stage()).toFixed(2)}, "${await title()}"`);
const track = await page.$('#track'); const box = await track.boundingBox();
await page.mouse.click(box.x + box.width * 5 / 6, box.y + box.height / 2); await wait(600);
console.log(`click at 5/6 of the track: stage ${(await stage()).toFixed(2)}, "${await title()}"`);
await page.mouse.move(box.x + box.width * 0.5, box.y + 9); await page.mouse.down(); await page.mouse.move(box.x + box.width * 0.1, box.y + 9, { steps: 12 }); await page.mouse.up(); await wait(400);
console.log(`drag to 10%: stage ${(await stage()).toFixed(2)}, "${await title()}"`);
await page.click('#stops button:nth-child(7)'); await wait(7000);
console.log(`click the last stop: stage ${(await stage()).toFixed(2)}, "${await title()}"`);
await page.click('#play'); await wait(3000);
const a = await stage(); await wait(4000); const b = await stage();
console.log(`Play from the end restarts: stage ${a.toFixed(2)} then ${b.toFixed(2)} (${((b - a) / 4).toFixed(3)} stages/s), button says "${await page.evaluate(() => document.getElementById('play').textContent)}"`);
await page.keyboard.press('Space'); await wait(300); const c = await stage(); await wait(1500);
console.log(`Space pauses: ${Math.abs((await stage()) - c) < 0.02}`);
await page.keyboard.press('KeyF'); await wait(4000);
console.log(`F steps on: stage ${(await stage()).toFixed(2)}`);
await page.keyboard.press('KeyH'); await wait(3000);
console.log(`after H: ${JSON.stringify(await page.evaluate(() => ({ ms: +window.__meadow.stats().ms.toFixed(1), mode: window.__meadow.stats().mode })))}`);
const height = () => page.evaluate(() => { const s = window.__meadow.stats(); return s.position[1] - s.ground; });
const low = await height();
await page.click('#wide'); await wait(8000);
const high = await height(), label = await page.evaluate(() => document.getElementById('wide').textContent);
await page.keyboard.press('KeyL'); await wait(8000);
console.log(`Landscape view: camera ${low.toFixed(0)} m above the ground, ${high.toFixed(0)} m after the button (which then says "${label}"), ${(await height()).toFixed(0)} m after L`);
await page.setViewport({ width: 420, height: 800 }); await wait(1500);
await page.screenshot({ path: 'out/narrow.png' });
console.log(problems.length ? problems.join('\n') : 'no page errors');
await browser.close();
