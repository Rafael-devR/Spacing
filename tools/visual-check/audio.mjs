// Teste do áudio posicional: toca sons à direita e à esquerda do astronauta e mede o volume de cada
// canal; confere também que longe soa mais baixo e que o módulo de pouso zumbe.
// Uso: node audio.mjs <url>
import chromium from '@sparticuz/chromium';
import { chromium as pw } from 'playwright-core';

const [url = 'http://localhost:5173/'] = process.argv.slice(2);
const browser = await pw.launch({
  executablePath: await chromium.executablePath(),
  args: [...chromium.args, '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  headless: true,
});
const ctx = await browser.newContext({ viewport: { width: 640, height: 360 } });
await ctx.addInitScript(() => {
  try {
    localStorage.clear();
    localStorage.setItem('spacing.prefs.v1', JSON.stringify({ quality: 'baixo', muted: false, shake: 'off', vibration: false }));
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
await page.waitForFunction(() => document.body.dataset.state === 'playing', null, { timeout: 180000 });
await page.waitForTimeout(800);

// mede o volume de cada canal na saída geral
await page.evaluate(() => {
  const s = window.spacing.sfx;
  const ac = s.ctx;
  const split = ac.createChannelSplitter(2);
  s.muffle.connect(split);
  const mk = (i) => {
    const a = ac.createAnalyser();
    a.fftSize = 2048;
    split.connect(a, i);
    return a;
  };
  window.__meter = { L: mk(0), R: mk(1), buf: new Float32Array(2048) };
  window.__rms = async (ms) => {
    const m = window.__meter;
    let l = 0, r = 0, n = 0;
    const end = performance.now() + ms;
    while (performance.now() < end) {
      for (const [k, a] of [['l', m.L], ['r', m.R]]) {
        a.getFloatTimeDomainData(m.buf);
        let sum = 0;
        for (const v of m.buf) sum += v * v;
        if (k === 'l') l += sum; else r += sum;
      }
      n++;
      await new Promise((res) => setTimeout(res, 20));
    }
    return { l: Math.sqrt(l / n / 2048), r: Math.sqrt(r / n / 2048) };
  };
});
check('áudio iniciado', await page.evaluate(() => window.spacing.sfx.ready && window.spacing.sfx.ctx.state === 'running'),
  await page.evaluate(() => window.spacing.sfx.ctx?.state));

// fundo (zumbido do módulo + ambiente) para descontar
const base = await page.evaluate(() => window.__rms(600));
const at = (side, dist) => page.evaluate(([side, dist]) => {
  const g = window.spacing;
  const p = g.player.model.root.position, r = g.rig.right();
  return { x: p.x + r.x * side * dist, y: p.y + 0.5, z: p.z + r.z * side * dist };
}, [side, dist]);
const measure = async (name, pos) => {
  await page.evaluate(([name, pos]) => window.spacing.sfx.play(name, 1, pos), [name, pos]);
  return page.evaluate(() => window.__rms(350));
};
const right = await measure('boom', await at(1, 10));
await page.waitForTimeout(2500);
const left = await measure('boom', await at(-1, 10));
await page.waitForTimeout(2500);
const f = (v) => `E ${v.l.toFixed(4)} D ${v.r.toFixed(4)}`;
check('som à direita sai mais pela direita', right.r > right.l * 1.5, f(right));
check('som à esquerda sai mais pela esquerda', left.l > left.r * 1.5, f(left));
const near = await measure('boom', await at(1, 4));
await page.waitForTimeout(2500);
const far = await measure('boom', await at(1, 60));
await page.waitForTimeout(2500);
check('longe soa mais baixo', far.l + far.r < (near.l + near.r) * 0.6, `perto ${f(near)} | longe ${f(far)}`);
const tooFar = await page.evaluate((p) => window.spacing.sfx.play('step', 1, p), await at(1, 200));
check('passo longe demais nem toca', tooFar === null);

// zumbido do módulo: perto do módulo há mais som de fundo que longe dele
await page.evaluate(() => {
  const g = window.spacing;
  const x = g.player.pos.x + 40, z = g.player.pos.z;
  g.world.update(x, z, 99, 0);
  g.player.pos.set(x, g.world.topY(Math.floor(x), Math.floor(z)) + 1.05, z);
  g.player.prevPos.copy(g.player.pos);
});
await page.waitForTimeout(1200);
const away = await page.evaluate(() => window.__rms(600));
check('zumbido do módulo some de longe', away.l + away.r < (base.l + base.r) * 0.8, `perto ${f(base)} | longe ${f(away)}`);

// meteoro: o som acompanha a queda sem erro
await page.evaluate(() => {
  const g = window.spacing, p = g.player.pos;
  g.meteors.launch(new (p.constructor)(p.x + 6, g.world.topY(Math.floor(p.x + 6), Math.floor(p.z)) + 1, p.z), { radius: 1.2, meteorite: false });
});
await page.waitForFunction(() => window.spacing.meteors.active.length === 0, null, { timeout: 30000 }).catch(() => {});
check('meteoro caiu', await page.evaluate(() => window.spacing.meteors.active.length === 0));

check('sem erros no console', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(results.join('\n'));
await browser.close();
process.exit(results.some((r) => r.startsWith('FALHOU')) ? 1 : 0);
