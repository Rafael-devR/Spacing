// Uso: node shot.mjs <url> <pasta-de-saída> [largura] [altura] [qualidade]
import chromium from '@sparticuz/chromium';
import { chromium as pw } from 'playwright-core';

const [url, out, w = '960', h = '540', quality = 'alto', mobile = '', prefix = ''] = process.argv.slice(2);
const browser = await pw.launch({
  executablePath: await chromium.executablePath(),
  args: [...chromium.args, '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  headless: true,
});
const ctx = await browser.newContext({ viewport: { width: +w, height: +h }, ...(mobile === 'mobile' ? { isMobile: true, hasTouch: true, deviceScaleFactor: 1 } : {}) });
await ctx.addInitScript((q) => { try { localStorage.setItem('spacing.prefs.v1', JSON.stringify({ quality: q, muted: true })); } catch {} }, quality);
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`[${m.type()}] ${m.text().slice(0, 300)}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${String(e).slice(0, 300)}`));

await page.goto(url, { waitUntil: 'load' });
await page.waitForSelector('#btn-start:not([disabled])', { timeout: 120000 });
await page.screenshot({ path: `${out}/${prefix}1-inicio.png` });
await page.click('#btn-start');
await page.waitForTimeout(6000);
await page.screenshot({ path: `${out}/${prefix}2-jogo.png` });
const fps = await page.evaluate(() => new Promise((res) => {
  let n = 0; const t0 = performance.now();
  const f = () => { n++; if (performance.now() - t0 > 3000) res(n / 3); else requestAnimationFrame(f); };
  requestAnimationFrame(f);
}));
console.log('FPS (renderização por software):', fps.toFixed(1));
console.log(logs.length ? 'LOG DO NAVEGADOR:\n' + logs.join('\n') : 'sem erros ou avisos no console');
await browser.close();
