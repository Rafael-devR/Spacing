// Teste jogado: começa o jogo, minera um bloco ao lado do astronauta, confere o inventário,
// abre a pausa e confere o salvamento. Usa o acesso de depuração `window.spacing` (só em `npm run dev`).
// Uso: node play.mjs <url> <pasta-de-saída>
import chromium from '@sparticuz/chromium';
import { chromium as pw } from 'playwright-core';

const [url = 'http://localhost:5173/', out = '/tmp'] = process.argv.slice(2);
const browser = await pw.launch({
  executablePath: await chromium.executablePath(),
  args: [...chromium.args, '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  headless: true,
});
const ctx = await browser.newContext({ viewport: { width: 640, height: 360 } });
await ctx.addInitScript(() => {
  try {
    localStorage.clear();
    localStorage.setItem('spacing.prefs.v1', JSON.stringify({ quality: 'baixo', muted: true, shake: 'off', vibration: false }));
  } catch {}
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

const results = [];
const check = (name, ok, detail = '') => results.push(`${ok ? 'OK  ' : 'FALHOU'} ${name}${detail ? ' (' + detail + ')' : ''}`);

await page.goto(url);
await page.waitForSelector('#btn-start:not([disabled])', { timeout: 120000 });
await page.click('#btn-start');
check('estado depois de começar', (await page.evaluate(() => window.spacing.state)) === 'playing');

// bloco do chão logo à frente do astronauta, em coordenadas de tela
const target = await page.evaluate(() => {
  const g = window.spacing;
  const p = g.player.pos;
  const x = Math.floor(p.x) + 1, z = Math.floor(p.z);
  const y = g.world.topY(x, z);
  const v = g.camera.position.clone();
  v.set(x + 0.5, y + 0.95, z + 0.5).project(g.camera);
  const r = g.renderer.domElement.getBoundingClientRect();
  return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height, block: [x, y, z], id: g.world.getBlock(x, y, z) };
});
await page.mouse.move(target.x, target.y);
await page.mouse.down();
const broke = await page
  .waitForFunction(([x, y, z]) => window.spacing.world.getBlock(x, y, z) === 0, target.block, { timeout: 60000, polling: 250 })
  .then(() => true, () => false);
await page.mouse.up();
check('bloco minerado', broke, `bloco ${target.id} em ${target.block.join(',')}`);
const collected = await page
  .waitForFunction(() => Object.values(window.spacing.inventory.serialize()).reduce((a, n) => a + n, 0) > 0, null, { timeout: 90000, polling: 250 })
  .then(() => true, () => false);
check('item chegou ao inventário', collected, JSON.stringify(await page.evaluate(() => window.spacing.inventory.serialize())));
await page.screenshot({ path: `${out}/play-1-minerado.png` });

await page.keyboard.press('Escape');
await page.waitForTimeout(300);
check('Esc pausa o jogo', (await page.evaluate(() => window.spacing.state)) === 'paused');
check('menu de pausa visível', await page.isVisible('#pause'));
await page.screenshot({ path: `${out}/play-2-pausa.png` });

const save = await page.evaluate(() => JSON.parse(localStorage.getItem('spacing.save') || 'null'));
check('salvou ao pausar', !!save && save.version === 2, save ? `versão ${save.version}` : 'sem salvamento');
check('inventário no salvamento', !!save && Object.keys(save.inventory).length > 0);

await page.click('#pause-resume');
await page.waitForTimeout(300);
check('Continuar volta ao jogo', (await page.evaluate(() => window.spacing.state)) === 'playing');

check('sem erros no console', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(results.join('\n'));
await browser.close();
process.exit(results.some((r) => r.startsWith('FALHOU')) ? 1 : 0);
