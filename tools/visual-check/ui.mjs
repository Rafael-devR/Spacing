// Capturas da interface no celular: tela inicial, HUD em paisagem e retrato, mira deslocada ao segurar o
// dedo e menu de pausa. Confere também que a mira mira acima do dedo e que o bloco sob ela é minerado.
// Uso: node ui.mjs <url> <pasta-de-saída>
import chromium from '@sparticuz/chromium';
import { chromium as pw } from 'playwright-core';

const [url = 'http://localhost:5173/', out = '/tmp'] = process.argv.slice(2);
const browser = await pw.launch({
  executablePath: await chromium.executablePath(),
  args: [...chromium.args, '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  headless: true,
});
const results = [];
const check = (name, ok, detail = '') => results.push(`${ok ? 'OK  ' : 'FALHOU'} ${name}${detail ? ' (' + detail + ')' : ''}`);
const errors = [];

async function open(w, h, prefix) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => {
    try {
      localStorage.clear();
      localStorage.setItem('spacing.prefs.v1', JSON.stringify({ quality: 'baixo', muted: true, shake: 'off', vibration: false }));
    } catch {}
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(url);
  await page.waitForSelector('#btn-start:not([disabled])', { timeout: 120000 });
  await page.screenshot({ path: `${out}/${prefix}1-inicio.png` });
  check(`${prefix} HUD escondido no menu`, await page.evaluate(() => getComputedStyle(document.querySelector('#hud')).visibility === 'hidden'));
  await page.click('#btn-start');
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${out}/${prefix}2-jogo.png` });
  // nada do HUD pode sair da tela nem se sobrepor aos controles
  const boxes = await page.evaluate(() => {
    const ids = ['.hud-tl', '.hud-tr', '#joystick', '.actions', '#bottom', '#compass'];
    return ids.map((s) => {
      const e = document.querySelector(s);
      const r = e.getBoundingClientRect();
      const vis = getComputedStyle(e).display !== 'none' && r.width > 0;
      return { s, vis, l: r.left, t: r.top, r: r.right, b: r.bottom };
    });
  });
  const vis = boxes.filter((b) => b.vis);
  const inside = vis.every((b) => b.l >= 0 && b.t >= 0 && b.r <= w + 0.5 && b.b <= h + 0.5);
  check(`${prefix} HUD inteiro dentro da tela`, inside, inside ? '' : JSON.stringify(vis));
  const overlaps = [];
  for (let i = 0; i < vis.length; i++)
    for (let j = i + 1; j < vis.length; j++) {
      const a = vis[i], b = vis[j];
      if (a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b) overlaps.push(`${a.s} × ${b.s}`);
    }
  check(`${prefix} blocos do HUD sem sobreposição`, overlaps.length === 0, overlaps.join(', '));
  return { page };
}

// ---- paisagem: mira deslocada e mineração ----
{
  const { page } = await open(844, 390, 'paisagem-');
  const target = await page.evaluate(() => {
    const g = window.spacing;
    const p = g.player.pos;
    const x = Math.floor(p.x) + 1, z = Math.floor(p.z) + 1;
    const y = g.world.topY(x, z);
    const v = g.camera.position.clone();
    v.set(x + 0.5, y + 0.98, z + 0.5).project(g.camera);
    const r = g.renderer.domElement.getBoundingClientRect();
    return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height, block: [x, y, z] };
  });
  // segura o dedo 80 px abaixo do bloco: a mira fica em cima dele
  const finger = { x: target.x, y: target.y + 80 };
  await page.evaluate(({ x, y }) => {
    const c = window.spacing.renderer.domElement;
    c.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, button: 0, bubbles: true }));
  }, finger);
  await page.waitForTimeout(500);
  const aim = await page.evaluate(() => {
    const a = document.querySelector('#aim');
    return { shown: !a.hidden, state: a.dataset.state, aim: window.spacing.interaction.aim };
  });
  check('mira aparece ao segurar', aim.shown, JSON.stringify(aim.aim));
  check('mira fica acima do dedo', !!aim.aim && Math.abs(aim.aim.y - (finger.y - 80)) < 1);
  await page.screenshot({ path: `${out}/paisagem-3-mira.png` });
  const broke = await page
    .waitForFunction(([x, y, z]) => window.spacing.world.getBlock(x, y, z) === 0, target.block, { timeout: 60000, polling: 250 })
    .then(() => true, () => false);
  check('minera o bloco sob a mira, não o do dedo', broke, target.block.join(','));
  await page.evaluate(({ x, y }) => {
    const c = window.spacing.renderer.domElement;
    c.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, button: 0, bubbles: true }));
  }, finger);
  await page.waitForTimeout(300);
  check('mira some ao soltar', await page.evaluate(() => document.querySelector('#aim').hidden));
  await page.click('#btn-pause');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/paisagem-4-pausa.png` });
  await page.close();
}

// ---- retrato ----
{
  const { page } = await open(390, 844, 'retrato-');
  await page.click('#btn-pause');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/retrato-3-pausa.png` });
  await page.close();
}

check('sem erros no console', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(results.join('\n'));
await browser.close();
process.exit(results.some((r) => r.startsWith('FALHOU')) ? 1 : 0);
