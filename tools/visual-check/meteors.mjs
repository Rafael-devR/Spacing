// Teste dos meteoros (docs/design/METEOROS.md): lança um meteoro perto do astronauta e tira capturas em momentos-chave
// (aviso no chão, voo, o impacto e o que vem depois: bola de fogo, onda de choque que entorta a imagem, poeira, fumaça).
// O jogo é congelado em cada momento (estado 'paused': o canvas guarda o último quadro) para a captura sair limpa, já que
// o WebGL por software é lento e o tempo do jogo não acompanha o do relógio. Também confere os valores por dentro.
// Uso: node meteors.mjs <url> <pasta-de-saída> [largura] [altura] [qualidade]
import chromium from '@sparticuz/chromium';
import { chromium as pw } from 'playwright-core';

const [url = 'http://localhost:5173/', out = '/tmp', W = '844', H = '390', quality = 'baixo'] = process.argv.slice(2);
const browser = await pw.launch({
  executablePath: await chromium.executablePath(),
  args: [...chromium.args, '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  headless: true,
});
const ctx = await browser.newContext({ viewport: { width: +W, height: +H }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
await ctx.addInitScript((q) => {
  try {
    localStorage.clear();
    localStorage.setItem('spacing.prefs.v1', JSON.stringify({ quality: q, muted: true, shake: 'off', vibration: false }));
  } catch {}
}, quality);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const results = [];
const check = (name, ok, detail = '') => results.push(`${ok ? 'OK  ' : 'FALHOU'} ${name}${detail ? ' (' + detail + ')' : ''}`);
const g = (fn, arg) => page.evaluate(fn, arg);
const shot = (n) => page.screenshot({ path: `${out}/meteoro-${n}.png` });

await page.goto(url);
await page.waitForSelector('#btn-start:not([disabled])', { timeout: 120000 });
await page.click('#btn-start');
await page.waitForFunction(() => document.body.dataset.state === 'playing', null, { timeout: 180000 });
await page.waitForTimeout(2500);

/** o que há por dentro do jogo agora (só no `npm run dev`, onde `window.spacing` existe) */
const probe = () => g(() => {
  const s = window.spacing;
  const u = s.post.grade.uniforms;
  return {
    shockN: u.uShockN.value, a0: u.uShockA.value[0].toArray(), flash: u.uFlash.value,
    puffs: s.puffs.active, debris: s.debris.count, waves: s.meteorDirector.waves.count, meteors: s.meteors.active.length,
    children: s.scene.children.length, time: s.time,
  };
});

// um meteoro a 9 blocos do astronauta, à frente da câmera
await g(() => {
  const s = window.spacing;
  s.world.update(s.player.pos.x, s.player.pos.z, 99, 0);
});
await page.waitForTimeout(1500);
const before = await probe();
const target = await g(() => {
  const s = window.spacing;
  s.meteors.holdSpawns = true;
  let t = null;
  for (let i = 0; i < 30 && !t; i++) t = s.meteors.pickTarget(9, 12); // longe do módulo e da base, como no jogo
  if (!t) return null;
  window.__m = s.meteors.launch(t, { radius: 2.3, meteorite: true });
  return { x: t.x, y: t.y, z: t.z };
});
check('meteoro lançado', !!target && (await probe()).meteors === 1);

/** espera a condição (no relógio do jogo), congela o jogo e tira a captura */
async function freezeAt(name, cond, arg) {
  await page.evaluate(([c, a]) => new Promise((resolve) => {
    const s = window.spacing;
    const fns = {
      flightT: (t) => window.__m && window.__m.t >= t,
      sinceImpact: (t) => s.meteors.active.length === 0 && s.time - window.__t0 >= t,
    };
    const tick = () => {
      if (c === 'sinceImpact' && s.meteors.active.length === 0 && window.__t0 === undefined) window.__t0 = s.time;
      if (fns[c](a)) {
        s.state = 'paused';
        resolve();
      } else requestAnimationFrame(tick);
    };
    tick();
  }), [cond, arg]);
  await page.waitForTimeout(150);
  const info = await probe();
  await shot(name);
  await g(() => { window.spacing.state = 'playing'; });
  return info;
}

const warn = await freezeAt('1-aviso', 'flightT', -0.7);
check('aviso: a mira aparece no chão e ainda não há rastro', warn.puffs === 0 && warn.meteors === 1, JSON.stringify(warn));

const early = await freezeAt('2-voo', 'flightT', 0.6);
check('voo: rastro de baforadas e ar tremendo em volta da rocha', early.puffs > 5 && early.shockN >= 1 && early.a0[3] > 0, JSON.stringify(early));

const late = await freezeAt('3-chegando', 'flightT', 1.45);
check('chegando: o rastro cresceu', late.puffs > early.puffs, `${early.puffs} -> ${late.puffs}`);

const marks = [['4-impacto', 0.04], ['5-fogo', 0.16], ['6-onda', 0.35], ['7-poeira', 0.7], ['8-coluna', 1.6]];
let first = null;
let prevR = 0;
for (const [name, t] of marks) {
  const info = await freezeAt(name, 'sinceImpact', t);
  if (!first) first = info;
  const r = info.a0[2];
  check(`${name}: onda de choque ativa (raio ${r.toFixed(3)}, força ${info.a0[3].toFixed(3)})`, name === '8-coluna' ? true : info.shockN >= 1 && r > prevR - 1e-6, JSON.stringify(info.a0));
  if (name !== '8-coluna') prevR = r;
}
check('impacto: destroços novos no ar', first.debris - before.debris >= 30, `${before.debris} -> ${first.debris}`);
check('impacto: muitas baforadas (fogo, poeira, fumaça)', first.puffs >= 30, `${first.puffs}`);
check('impacto: clarão de tela', first.flash > 0.05, `${first.flash}`);

// depois de uns segundos tudo se apaga
await g(() => { window.__t0 = undefined; });
await page.waitForTimeout(500);
const lateSnap = await g(() => new Promise((resolve) => {
  const s = window.spacing, t0 = s.time;
  const tick = () => (s.time - t0 >= 8 ? resolve(true) : requestAnimationFrame(tick));
  tick();
}));
const after = await probe();
check('8 segundos depois: ondas e baforadas apagadas, sem objetos sobrando na cena', lateSnap && after.waves === 0 && after.shockN === 0 && after.puffs < 20 && after.children <= before.children + 3, // a bolha da onda de choque (criada no 1º impacto) e o meteorito ficam
  JSON.stringify({ waves: after.waves, shockN: after.shockN, puffs: after.puffs, children: after.children, antes: before.children }));
await shot('9-depois');

check('sem erros no console', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(results.join('\n'));
await browser.close();
