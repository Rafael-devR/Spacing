// Teste jogado: começa o jogo, minera um bloco ao lado do astronauta, confere o inventário,
// abre a pausa, confere o salvamento, morre sem oxigênio, renasce e recolhe os itens caídos.
// Usa o acesso de depuração `window.spacing` (só em `npm run dev`).
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
  .waitForFunction(() => Object.values(window.spacing.inventory.totals()).reduce((a, n) => a + n, 0) > 0, null, { timeout: 90000, polling: 250 })
  .then(() => true, () => false);
check('item chegou ao inventário', collected, JSON.stringify(await page.evaluate(() => window.spacing.inventory.totals())));
await page.screenshot({ path: `${out}/play-1-minerado.png` });

await page.keyboard.press('Escape');
await page.waitForTimeout(300);
check('Esc pausa o jogo', (await page.evaluate(() => window.spacing.state)) === 'paused');
check('menu de pausa visível', await page.isVisible('#pause'));
await page.screenshot({ path: `${out}/play-2-pausa.png` });

const save = await page.evaluate(() => JSON.parse(localStorage.getItem('spacing.save') || 'null'));
check('salvou ao pausar', !!save && save.version === 4, save ? `versão ${save.version}` : 'sem salvamento');
check('inventário no salvamento', !!save && save.inventory.slots.some(Boolean));

await page.click('#pause-resume');
await page.waitForTimeout(300);
check('Continuar volta ao jogo', (await page.evaluate(() => window.spacing.state)) === 'playing');

// ---- sobrevivência: morrer sem oxigênio, itens no chão, renascer, recolher ----
const before = await page.evaluate(() => window.spacing.inventory.totals());
// dentro da área pressurizada o módulo recarrega o traje: primeiro confere isso
await page.evaluate(() => (window.spacing.survival.o2 = 40));
const refilled = await page
  .waitForFunction(() => window.spacing.survival.o2 > 60, null, { timeout: 30000, polling: 200 })
  .then(() => true, () => false);
check('perto do módulo o oxigênio recarrega', refilled);
// depois sai da área pressurizada (12 blocos para o leste)
await page.evaluate(() => {
  const g = window.spacing;
  const x = g.player.pos.x + 12, z = g.player.pos.z;
  g.world.update(x, z, 99, 0);
  g.player.pos.set(x, g.world.topY(Math.floor(x), Math.floor(z)) + 1.05, z);
  g.player.prevPos.copy(g.player.pos);
  g.player.vel.set(0, 0, 0);
});
await page.waitForTimeout(500);
await page.evaluate(() => (window.spacing.survival.o2 = 12));
const warned = await page.waitForSelector('#meter-o2.crit', { timeout: 30000 }).then(() => true, () => false);
check('oxigênio crítico pisca em vermelho', warned);
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/play-2b-oxigenio-critico.png` });
await page.evaluate(() => {
  const s = window.spacing.survival;
  s.o2 = 0;
  s.integrity = 3;
});
const died = await page
  .waitForFunction(() => window.spacing.state === 'dead', null, { timeout: 60000, polling: 200 })
  .then(() => true, () => false);
check('sem oxigênio, o astronauta morre', died);
const afterDeath = await page.evaluate(() => ({ inv: window.spacing.inventory.totals(), loot: window.spacing.loot.totals() }));
check('inventário esvaziou na morte', Object.keys(afterDeath.inv).length === 0, JSON.stringify(afterDeath.inv));
check('itens caíram no chão', JSON.stringify(afterDeath.loot) === JSON.stringify(before), `chão ${JSON.stringify(afterDeath.loot)}`);
const card = await page.waitForSelector('#death:not([hidden])', { timeout: 30000 }).then(() => true, () => false);
check('tela de morte aparece', card);
if (!card) {
  const st = await page.evaluate(() => ({ state: window.spacing.state, loot: window.spacing.loot.count }));
  check('diagnóstico', false, JSON.stringify(st) + ' | erros: ' + errors.slice(0, 5).join(' | '));
  console.log(results.join('\n'));
  await browser.close();
  process.exit(1);
}
await page.screenshot({ path: `${out}/play-3-morte.png` });

await page.click('#btn-respawn');
await page.waitForTimeout(400);
const re = await page.evaluate(() => {
  const g = window.spacing;
  const p = g.player.pos, l = g.lander.group.position;
  return { state: g.state, o2: g.survival.o2, hp: g.survival.integrity, dist: Math.hypot(p.x - l.x, p.z - l.z), loot: g.loot.count };
});
check('renasce jogando', re.state === 'playing');
check('traje cheio ao renascer', re.o2 === 100 && re.hp === 100, `O2 ${re.o2}, integridade ${re.hp}`);
check('renasce dentro da área pressurizada', re.dist < 4.5, `${re.dist.toFixed(1)} blocos do módulo`);
check('itens continuam no chão', re.loot > 0);
const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('spacing.save') || 'null'));
check('itens caídos estão no salvamento', !!saved && saved.version === 4 && saved.loot.length > 0);
await page.screenshot({ path: `${out}/play-4-renasceu.png` });

// leva o astronauta até os itens
await page.evaluate(() => {
  const g = window.spacing;
  const t = g.loot.latest();
  g.player.pos.set(t.x, g.world.topY(Math.floor(t.x), Math.floor(t.z)) + 1.05, t.z);
  g.player.prevPos.copy(g.player.pos);
  g.player.vel.set(0, 0, 0);
});
const recovered = await page
  .waitForFunction(() => window.spacing.loot.count === 0, null, { timeout: 90000, polling: 250 })
  .then(() => true, () => false);
check('passar por cima recolhe os itens', recovered);
const backInInv = await page
  .waitForFunction((b) => JSON.stringify(window.spacing.inventory.totals()) === JSON.stringify(b), before, { timeout: 90000, polling: 250 })
  .then(() => true, () => false);
check('inventário voltou ao que era', backInInv, JSON.stringify(await page.evaluate(() => window.spacing.inventory.totals())));

check('sem erros no console', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(results.join('\n'));
await browser.close();
process.exit(results.some((r) => r.startsWith('FALHOU')) ? 1 : 0);
