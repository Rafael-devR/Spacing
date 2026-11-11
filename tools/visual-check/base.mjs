// Teste da base: anda até a porta, entra (câmara de pressurização), confere o interior, fabrica o mapa na
// bancada (animação do laser), confere que ele foi equipado fora do inventário, descansa e sai.
// Uso: node base.mjs <url> <pasta-de-saída> [largura] [altura]
import chromium from '@sparticuz/chromium';
import { chromium as pw } from 'playwright-core';

const [url = 'http://localhost:5173/', out = '/tmp', W = '844', H = '390'] = process.argv.slice(2);
const browser = await pw.launch({
  executablePath: await chromium.executablePath(),
  args: [...chromium.args, '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  headless: true,
});
const ctx = await browser.newContext({ viewport: { width: +W, height: +H }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
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
const shot = (n) => page.screenshot({ path: `${out}/base-${n}.png` });
const g = (fn, arg) => page.evaluate(fn, arg);

await page.goto(url);
await page.waitForSelector('#btn-start:not([disabled])', { timeout: 120000 });
await page.click('#btn-start');
await page.waitForTimeout(1500);

// itens no chão com contorno
await g(() => {
  const s = window.spacing, p = s.player.pos;
  s.loot.drop(p.clone().set(p.x + 2, p.y + 0.5, p.z + 1), { iron: 3, regolith: 2 });
});
await page.waitForTimeout(1800);
await shot('0-contorno');

// leva o astronauta até a frente da porta
await g(() => {
  const s = window.spacing, o = s.base.d.layout.outside;
  s.world.update(o.x, o.z, 99, 0);
  s.player.pos.set(o.x, s.world.topY(Math.floor(o.x), Math.floor(o.z)) + 1.05, o.z - 0.2 + 0.2);
  s.player.prevPos.copy(s.player.pos);
  s.player.vel.set(0, 0, 0);
});
await page.waitForTimeout(1500);
check('botão "Entrar na base" aparece na porta', await page.isVisible('#btn-use'), await page.textContent('#btn-use'));
await shot('1-porta');

await page.click('#btn-use');
await page.waitForTimeout(900);
await shot('2-entrando');
await page.waitForFunction(() => document.querySelector('#airlock')?.classList.contains('closed'), null, { timeout: 8000 }).catch(() => {});
await page.waitForTimeout(700);
await shot('3-camara');
const entered = await page.waitForFunction(() => window.spacing.base.mode === 'inside', null, { timeout: 15000 }).then(() => true, () => false);
check('entra na base', entered, await g(() => window.spacing.base.mode));
await page.waitForTimeout(1200);
await shot('4-dentro');
const inside = await g(() => ({ sheltered: window.spacing.survival.inPressure, cut: window.spacing.base.d.layout.structure.cutaway }));
check('dentro: pressurizado e com corte', inside.sheltered && inside.cut, JSON.stringify(inside));

// dentro é um ambiente à parte: a câmera só vê o interior e o mundo de fora não pode ser mexido
const iso = await g(() => {
  const s = window.spacing;
  return {
    layers: s.camera.layers.mask, locked: s.interaction.worldLocked, body: document.body.classList.contains('in-base'),
    build: getComputedStyle(document.querySelector('#btn-build')).display, chip: getComputedStyle(document.querySelector('#base-chip')).display,
    bg: !!s.scene.background,
  };
});
check('dentro: só o interior aparece, com fundo da base e aviso de pressurizado', iso.layers === 2 && iso.bg && iso.body && iso.chip !== 'none', JSON.stringify(iso));
const world0 = await g(() => JSON.stringify(window.spacing.world.serialize()));
await g(() => window.spacing.interaction.setBuildMode(true));
const box = await page.locator('canvas').boundingBox();
for (const [fx, fy] of [[0.15, 0.8], [0.85, 0.2], [0.5, 0.9]]) {
  await page.mouse.move(box.x + box.width * fx, box.y + box.height * fy);
  await page.mouse.down();
  await page.waitForTimeout(1500);
  await page.mouse.up();
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy, { button: 'right' });
}
const world1 = await g(() => JSON.stringify(window.spacing.world.serialize()));
const build = await g(() => window.spacing.interaction.buildMode);
check('dentro: não minera nem constrói no mundo de fora', world0 === world1 && !build && iso.locked && iso.build === 'none', `mudou: ${world0 !== world1}, construir: ${build}`);

// anda livre por dentro (joystick por teclado) e não atravessa a parede
const before = await g(() => window.spacing.player.pos.clone());
await page.keyboard.down('d');
await page.waitForTimeout(2500);
await page.keyboard.up('d');
const after = await g(() => ({ p: window.spacing.player.pos.clone(), box: window.spacing.base.d.layout.structure.box }));
check('anda por dentro sem sair pela parede', after.p.x !== before.x && after.p.x < after.box.x1 && after.p.x > after.box.x0 + 1, `x ${before.x.toFixed(2)} → ${after.p.x.toFixed(2)}`);

// bancada: dá os materiais e vai até ela
await g(() => {
  const s = window.spacing;
  s.inventory.add('regolith', 6, false);
  s.inventory.add('iron', 2, false);
  const u = s.base.d.layout.furniture.find((f) => f.def.kind === 'workbench').use;
  s.player.pos.set(u.x, u.y + 0.02, u.z);
  s.player.prevPos.copy(s.player.pos);
});
await page.waitForTimeout(600);
check('botão "Usar bancada" aparece', (await page.textContent('#btn-use'))?.includes('bancada'));
await page.click('#btn-use');
await page.waitForTimeout(400);
check('tela da bancada abre', await page.isVisible('#craft'));
await shot('5-bancada');
await page.click('#craft-list .recipe[data-recipe="map"] button');
await page.waitForTimeout(1600);
await shot('6-laser');
const crafting = await g(() => ({ busy: window.spacing.crafting.busy, inv: window.spacing.inventory.totals() }));
check('fabricando: materiais gastos', crafting.busy && !crafting.inv.iron, JSON.stringify(crafting));
await page.waitForTimeout(1300);
await shot('7-laser-fim');
const equipped = await page.waitForFunction(() => window.spacing.equipment.has('map'), null, { timeout: 15000 }).then(() => true, () => false);
check('mapa equipado', equipped);
await page.waitForTimeout(1600);
await shot('8-equipado');
check('mapa fora do inventário', await g(() => !JSON.stringify(window.spacing.inventory.serialize()).includes('map')));

// descansar
await g(() => {
  const s = window.spacing;
  const u = s.base.d.layout.furniture.find((f) => f.def.kind === 'bed').use;
  s.player.pos.set(u.x, u.y + 0.02, u.z);
  s.player.prevPos.copy(s.player.pos);
  s.survival.o2 = 40;
});
await page.waitForTimeout(500);
check('botão "Descansar" aparece', (await page.textContent('#btn-use'))?.includes('Descansar'));
await page.click('#btn-use');
await page.waitForTimeout(800);
await shot('9-descanso');
await page.waitForFunction(() => window.spacing.base.mode === 'inside', null, { timeout: 8000 }).catch(() => {});
const rested = await g(() => ({ o2: window.spacing.survival.o2, respawn: window.spacing.base.respawn }));
check('descanso enche o traje e marca o renascimento na base', rested.o2 === 100 && rested.respawn === 'base', JSON.stringify(rested));

// salvamento v5
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
const save = await g(() => JSON.parse(localStorage.getItem('spacing.save')));
check('salvou dentro da base com o mapa', save.version === 5 && save.base.inside && save.equipment.map === 'map', JSON.stringify({ v: save.version, base: save.base, eq: save.equipment }));
await page.click('#pause-resume');
await page.waitForTimeout(300);

// sair
await g(() => {
  const s = window.spacing, i = s.base.d.layout.inside;
  s.player.pos.set(i.x, i.y + 0.02, i.z);
  s.player.prevPos.copy(s.player.pos);
});
await page.waitForTimeout(500);
check('botão "Sair da base" aparece', (await page.textContent('#btn-use'))?.includes('Sair'));
await page.click('#btn-use');
const exited = await page.waitForFunction(() => window.spacing.base.mode === 'outside', null, { timeout: 120000, polling: 500 }).then(() => true, () => false);
check('sai da base', exited, await g(() => window.spacing.base.mode));
await page.waitForTimeout(1200);
await shot('10-fora');
const outside = await g(() => {
  const s = window.spacing, p = s.player.pos, b = s.base.d.layout.structure.box;
  return { inBox: p.x >= b.x0 && p.x < b.x1 + 1 && p.z >= b.z0 && p.z < b.z1 + 1, cut: s.base.d.layout.structure.cutaway };
});
check('do lado de fora, sem corte', !outside.inBox && !outside.cut, JSON.stringify(outside));
const back = await g(() => ({ layers: window.spacing.camera.layers.mask, locked: window.spacing.interaction.worldLocked, body: document.body.classList.contains('in-base') }));
check('fora: o mundo volta a aparecer e a ser editável', back.layers === 1 && !back.locked && !back.body, JSON.stringify(back));

check('sem erros no console', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(results.join('\n'));
await browser.close();
process.exit(results.some((r) => r.startsWith('FALHOU')) ? 1 : 0);
