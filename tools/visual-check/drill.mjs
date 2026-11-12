// Teste das brocas e da microgravidade dos destroços: uma broca fraca não quebra basalto e avisa; a broca de
// ferro quebra; os pedaços ficam flutuando em vez de cair. Usa `window.spacing` (só em `npm run dev`).
// Uso: node drill.mjs <url> <pasta-de-saída>
import chromium from '@sparticuz/chromium';
import { chromium as pw } from 'playwright-core';

const [url = 'http://localhost:5173/', out = '/tmp'] = process.argv.slice(2);
const browser = await pw.launch({
  executablePath: await chromium.executablePath(),
  args: [...chromium.args, '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  headless: true,
});
const ctx = await browser.newContext({ viewport: { width: 844, height: 390 } });
await ctx.addInitScript(() => {
  try {
    localStorage.clear();
    localStorage.setItem('spacing.prefs.v1', JSON.stringify({ quality: 'baixo', muted: true, shake: 'off', vibration: false, fullscreen: false }));
  } catch {}
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const results = [];
const check = (name, ok, detail = '') => results.push(`${ok ? 'OK  ' : 'FALHOU'} ${name}${detail ? ' (' + detail + ')' : ''}`);
const g = (fn, arg) => page.evaluate(fn, arg);

await page.goto(url);
await page.waitForSelector('#btn-start:not([disabled])', { timeout: 120000 });
await page.click('#btn-start');
await page.waitForTimeout(800);

// um bloco de basalto (pede broca nível 1) ao lado do astronauta, e o ponto da tela dele
const target = await g(() => {
  const s = window.spacing;
  s.events.on('drill:weak', (p) => ((window.__weak ??= []).push(p)));
  const p = s.player.pos;
  const x = Math.floor(p.x) + 1, z = Math.floor(p.z);
  const y = s.world.topY(x, z);
  s.world.setBlock(x, y, z, 4); // BASALT
  const v = s.camera.position.clone();
  v.set(x + 0.5, y + 0.95, z + 0.5).project(s.camera);
  const r = s.renderer.domElement.getBoundingClientRect();
  return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height, block: [x, y, z] };
});
const at = () => g(([x, y, z]) => window.spacing.world.getBlock(x, y, z), target.block);

// 1) broca do traje: não quebra basalto e avisa
check('começa com a broca do traje', (await g(() => window.spacing.equipment.drill.id)) === 'basic');
await page.mouse.move(target.x, target.y);
await page.mouse.down();
// o aviso some sozinho: lê enquanto aparece
const toast = await page
  .waitForFunction(() => /broca de ferro/i.test(document.querySelector('#toasts')?.textContent ?? '') && document.querySelector('#toasts').textContent, null, { timeout: 8000, polling: 100 })
  .then((h) => h.jsonValue(), () => '');
await page.screenshot({ path: `${out}/drill-1-fraca.png` });
await page.waitForTimeout(2500);
await page.mouse.up();
const weak = await g(() => window.__weak ?? []);
check('broca fraca não quebra o basalto', (await at()) === 4);
check('avisa que precisa de uma broca melhor', weak.length === 1 && weak[0].tier === 1, JSON.stringify(weak));
check('o aviso aparece na tela com o nome da broca', /broca de ferro/i.test(toast ?? ''), String(toast).trim());

// 2) broca de ferro: quebra, e a ponta do astronauta muda
await g(() => window.spacing.equipment.equip('drill_iron'));
check('equipar troca a broca em uso', (await g(() => window.spacing.equipment.drill.id)) === 'iron');
const bit = await g(() => '#' + window.spacing.player.model.bit.material.color.getHexString());
check('a ponta da broca no astronauta muda de cor', bit !== '#ffb03a', bit);
await page.mouse.move(target.x, target.y);
await page.mouse.down();
const broke = await page.waitForFunction(([x, y, z]) => window.spacing.world.getBlock(x, y, z) === 0, target.block, { timeout: 90000, polling: 250 }).then(() => true, () => false);
await page.mouse.up();
check('broca de ferro quebra o basalto', broke);

// 3) microgravidade: 1,5 s depois, os pedaços ainda estão no ar
await page.waitForTimeout(1500);
const bits = await g(() => {
  const d = window.spacing.debris.items;
  const above = d.filter((it) => !it.ground && !it.sleep);
  return { total: d.length, floating: above.length, maxVy: Math.max(...d.map((it) => Math.abs(it.vel.y))) };
});
check('os pedaços continuam flutuando 1,5 s depois', bits.total > 8 && bits.floating >= bits.total * 0.6, JSON.stringify(bits));
check('nenhum pedaço cai rápido', bits.maxVy < 4, 'vy máx ' + bits.maxVy.toFixed(2));
await page.screenshot({ path: `${out}/drill-2-flutuando.png` });

// 4) mochila mostra a broca equipada
await page.keyboard.press('i');
await page.waitForTimeout(500);
const row = await page.textContent('#bag-equip');
check('a mochila mostra a broca equipada', /Broca de ferro/.test(row ?? ''), row?.replace(/\s+/g, ' ').trim());
await page.screenshot({ path: `${out}/drill-3-mochila.png` });

// 5) bancada: lista as brocas e fabrica a de cristal (a de ferro já está equipada)
await page.keyboard.press('i');
await g(() => {
  const s = window.spacing;
  s.base.placeInside();
  s.inventory.add('crystal', 4, false);
  s.inventory.add('titanium', 2, false);
  s.inventory.add('basalt_fiber', 2, false);
  s.inventory.add('iron_bar', 4, false);
  s.inventory.add('brick', 2, false);
  const u = s.base.d.layout.furniture.find((f) => f.def.kind === 'workbench').use;
  s.player.pos.set(u.x, u.y + 0.02, u.z);
  s.player.prevPos.copy(s.player.pos);
});
await page.waitForTimeout(900);
await page.click('#btn-use');
await page.waitForTimeout(500);
const tap = async (id) => {
  const r = await g((i) => window.spacing.craftPanel.hits.find((h) => h.id === i) ?? null, id);
  if (!r) return false;
  await page.mouse.click(r.x + r.w / 2, r.y + r.h / 2);
  await page.waitForTimeout(300);
  return true;
};
const recipes = await g(() => window.spacing.crafting.recipes('workbench').map((r) => r.id));
check('a bancada lista as duas brocas', recipes.includes('drill_iron') && recipes.includes('drill_crystal'), recipes.join(','));
const state = await g(() => {
  const c = window.spacing.crafting, r = (id) => c.recipes('workbench').find((x) => x.id === id);
  return { iron: c.check(r('drill_iron')).owned, crystal: c.check(r('drill_crystal')).ok };
});
check('a de cristal pode ser fabricada; a de ferro já está coberta', state.crystal && state.iron, JSON.stringify(state));
await tap('r:drill_crystal');
await page.screenshot({ path: `${out}/drill-4-bancada.png` });
await tap('make');
await page.waitForTimeout(2200);
await page.screenshot({ path: `${out}/drill-5-impressao.png` });
// a bancada leva ~2 min: o teste adianta o relógio da estação e pega a broca
await g(() => window.spacing.crafting.update(10000));
await page.waitForTimeout(500);
await tap('take');
const done = await page.waitForFunction(() => window.spacing.equipment.drill.id === 'crystal', null, { timeout: 20000, polling: 500 }).then(() => true, () => false);
check('a broca de cristal é fabricada e equipada ao pegar', done);
await tap('back');
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/drill-6-equipada.png` });

check('sem erros no console', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(results.join('\n'));
await browser.close();
