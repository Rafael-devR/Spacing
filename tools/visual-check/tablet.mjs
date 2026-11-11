// Teste do mapa do tablet e do tremor ao minerar: equipa o Mapa, abre pelo botão (o tablet sobe até a tela),
// confere o holograma, os nomes (sonda, base, você), arrasta, fecha; depois minera em sequência com a broca de
// cristal e confere que o tremor não acumula. Usa `window.spacing` (só em `npm run dev`).
// Uso: node tablet.mjs <url> <pasta-de-saída>
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
    localStorage.setItem('spacing.prefs.v1', JSON.stringify({ quality: 'baixo', muted: true, shake: 'normal', vibration: false, fullscreen: false }));
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

// sem Mapa: botão escondido
check('sem o Mapa, o botão do tablet não aparece', await page.isHidden('#btn-map'));
await g(() => window.spacing.equipment.equip('map'));
await page.waitForTimeout(300);
check('com o Mapa, o botão do tablet aparece', await page.isVisible('#btn-map'));

// ícone do tablet na mochila
await page.keyboard.press('i');
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/tablet-0-icone.png` });
await page.keyboard.press('i');
await page.waitForTimeout(300);

// abre pelo botão: o tablet sobe
await page.click('#btn-map');
await page.waitForTimeout(250);
await page.screenshot({ path: `${out}/tablet-1-subindo.png` });
const opened = await page.waitForFunction(() => document.querySelector('#map')?.classList.contains('full'), null, { timeout: 30000, polling: 100 }).then(() => true, () => false);
check('o tablet chega à tela cheia', opened);
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/tablet-2-mapa.png` });
const st = await g(() => ({
  layers: window.spacing.camera.layers.mask,
  labels: [...document.querySelectorAll('.map-label')].map((e) => e.textContent),
  hud: getComputedStyle(document.querySelector('#hud')).opacity,
}));
check('em tela cheia a câmera só desenha o tablet', st.layers === 4, 'máscara ' + st.layers);
check('mostra você, a sonda e a base', ['Você', 'Sonda', 'Base'].every((k) => st.labels.includes(k)), st.labels.join(', '));
check('o HUD do jogo some', st.hud === '0', 'opacidade ' + st.hud);

// astronauta parado com o mapa aberto
const p0 = await g(() => window.spacing.player.pos.clone());
await page.keyboard.down('d');
await page.waitForTimeout(800);
await page.keyboard.up('d');
const p1 = await g(() => window.spacing.player.pos.clone());
check('com o mapa aberto o astronauta não anda', Math.hypot(p1.x - p0.x, p1.z - p0.z) < 0.05);

// arrastar move o mapa
const v0 = await g(() => window.spacing.map.holo.view.clone());
await page.mouse.move(420, 200);
await page.mouse.down();
await page.mouse.move(300, 160, { steps: 6 });
await page.mouse.up();
const v1 = await g(() => window.spacing.map.holo.view.clone());
check('arrastar com o dedo move o mapa', Math.hypot(v1.x - v0.x, v1.y - v0.y) > 3, `${v0.x.toFixed(1)},${v0.y.toFixed(1)} → ${v1.x.toFixed(1)},${v1.y.toFixed(1)}`);
await page.click('#map-in');
await page.click('#map-me');
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/tablet-3-zoom.png` });

// fecha pelo X
await page.click('#map-close');
await page.waitForTimeout(150);
await page.screenshot({ path: `${out}/tablet-4-fechando.png` });
const closed = await page.waitForFunction(() => document.querySelector('#map')?.hidden, null, { timeout: 30000, polling: 100 }).then(() => true, () => false);
const back = await g(() => window.spacing.camera.layers.mask);
check('fecha e o mundo volta', closed && back === 1, 'máscara ' + back);

// M abre e Esc fecha
await page.keyboard.press('m');
const mOpen = await page.waitForFunction(() => window.spacing.map.state !== 'closed', null, { timeout: 5000 }).then(() => true, () => false);
await page.waitForTimeout(400);
await page.keyboard.press('Escape');
const escClosed = await page.waitForFunction(() => window.spacing.map.state === 'closed', null, { timeout: 30000, polling: 100 }).then(() => true, () => false);
check('M abre e Esc fecha (sem pausar o jogo)', mOpen && escClosed && (await g(() => window.spacing.state)) === 'playing');

// tremor: broca de cristal quebrando regolito em sequência
await g(() => window.spacing.equipment.equip('drill_crystal'));
const cells = await g(() => {
  const s = window.spacing;
  s.__maxShake = 0;
  const p = s.player.pos;
  const out = [];
  for (let i = 0; i < 6; i++) {
    const x = Math.floor(p.x) + 1, z = Math.floor(p.z), y = s.world.topY(x, z) - i;
    out.push([x, y, z]);
    s.world.setBlock(x, y, z, 2);
  }
  const tick = () => {
    s.__maxShake = Math.max(s.__maxShake, s.rig.shaking);
    if (!s.__stopShake) requestAnimationFrame(tick);
  };
  tick();
  return out;
});
const aimAt = (c) => g(([x, y, z]) => {
  const s = window.spacing;
  const v = s.camera.position.clone().set(x + 0.5, y + 0.95, z + 0.5).project(s.camera);
  const r = s.renderer.domElement.getBoundingClientRect();
  return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height };
}, c);
// segura o dedo e vai descendo a mira de bloco em bloco, sem soltar (como quem cava rápido)
await page.mouse.move((await aimAt(cells[0])).x, (await aimAt(cells[0])).y);
await page.mouse.down();
for (const c of cells) {
  const a = await aimAt(c);
  await page.mouse.move(a.x, a.y);
  await page.waitForFunction(([x, y, z]) => window.spacing.world.getBlock(x, y, z) === 0, c, { timeout: 15000, polling: 50 }).catch(() => {});
}
await page.mouse.up();
const shake = await g(() => {
  window.spacing.__stopShake = true;
  return { max: window.spacing.__maxShake, broken: 0 };
});
const broken = await g((cs) => cs.filter(([x, y, z]) => window.spacing.world.getBlock(x, y, z) === 0).length, cells);
check('minerando em sequência quebra vários blocos', broken >= 2, `${broken} blocos`);
check('o tremor não acumula (fica no nível de um golpe)', shake.max <= 0.2 + 1e-6, 'máximo ' + shake.max.toFixed(3));

check('sem erros no console', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(results.join('\n'));
await browser.close();
