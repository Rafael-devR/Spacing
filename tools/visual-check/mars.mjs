// Teste de Marte (docs/design/MARTE.md): abre o jogo em Marte, confere o terreno (poeira, cânion em camadas, vulcão com
// lava), a lava queimando o traje, a tempestade de poeira, o redemoinho devolvendo bateria, a gravidade maior e que o
// salvamento de Marte é separado do da Lua. Captura cada lugar. Usa `window.spacing` (só em `npm run dev`).
// Uso: node mars.mjs <url> <pasta-de-saída>
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
const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
await ctx.addInitScript(() => {
  try {
    if (!sessionStorage.getItem('mars-init')) {
      sessionStorage.setItem('mars-init', '1');
      localStorage.clear();
      // um salvamento da Lua que não pode ser tocado
      localStorage.setItem('spacing.save', '{"marca":"lua"}');
      localStorage.setItem('spacing.prefs.v1', JSON.stringify({ quality: 'baixo', muted: true }));
    }
  } catch {}
});
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !/GPU stall|ReadPixels/.test(m.text())) errors.push(m.text().slice(0, 300)); });
const base = url.includes('?') ? `${url}&planeta=marte` : `${url}?planeta=marte`;
await page.goto(base);
await page.waitForSelector('#btn-start:not([disabled])', { timeout: 120000 });
check('a tela inicial é de Marte', /Elysium/.test(await page.textContent('#title-region')));
await page.click('#btn-settings');
check('o botão Marte está marcado', (await page.getAttribute('#settings [data-planet="marte"]', 'aria-pressed')) === 'true');
await page.click('#settings-back');
await page.click('#btn-start');
await page.waitForFunction(() => document.body.dataset.state === 'playing', null, { timeout: 180000 });
await page.waitForTimeout(4000);
await page.screenshot({ path: `${out}/mars-1-pouso.png` });

const top = await page.evaluate(() => {
  const g = window.spacing;
  const p = g.player.pos;
  return g.world.peekBlock(Math.floor(p.x) + 3, g.world.topY(Math.floor(p.x) + 3, Math.floor(p.z) + 3), Math.floor(p.z) + 3);
});
check('o chão perto do pouso é poeira marciana (bloco 9) ou parente', [9, 10, 11, 12, 14].includes(top), String(top));

// teleporta e espera os chunks
const go = (x, z) => page.evaluate(([x, z]) => {
  const g = window.spacing;
  g.world.update(x, z, 999, 0);
  g.player.spawn(x, z);
  g.player.animate(0);
  g.rig.snap(g.player.pos.clone().setY(g.player.pos.y + 0.8));
}, [x, z]);

// cânion: paredes em camadas (sedimentar 12 alternando com rocha 10)
const cz = await page.evaluate(() => window.spacing.world.terrain.canyonZ(0));
await go(0, cz + 16);
await page.waitForTimeout(2500);
const strata = await page.evaluate((cz) => {
  const g = window.spacing;
  const ids = new Set();
  for (let z = Math.floor(cz) + 4; z < Math.floor(cz) + 20; z++) for (let y = 5; y < 22; y++) ids.add(g.world.peekBlock(0, y, z));
  return [...ids];
}, cz);
check('o cânion tem camadas de rocha sedimentar e rocha marciana', strata.includes(12) && strata.includes(10), strata.join(','));
check('há veios de gipsita (16) perto do cânion', await page.evaluate((cz) => {
  const g = window.spacing;
  for (let x = -40; x < 40; x++) for (let z = Math.floor(cz) - 22; z < Math.floor(cz) + 22; z++) for (let y = 4; y < 24; y++) if (g.world.peekBlock(x, y, z) === 16) return true;
  return false;
}, cz));
await page.screenshot({ path: `${out}/mars-2-canion.png` });

// vulcão: lago de lava na caldeira
await go(-85 + 13, 75 + 6);
await page.waitForTimeout(3000);
const lava = await page.evaluate(() => {
  const g = window.spacing;
  let n = 0;
  for (let x = -95; x < -75; x++) for (let z = 65; z < 85; z++) if (g.world.peekBlock(x, g.world.topY(x, z), z) === 17) n++;
  return n;
});
check('a caldeira do vulcão tem lava', lava > 30, `${lava} colunas`);
await page.screenshot({ path: `${out}/mars-3-vulcao.png` });

// lava queima o traje
const burn = await page.evaluate(async () => {
  const g = window.spacing;
  g.survival.immortal = false;
  const before = g.survival.integrity;
  // põe o astronauta na beira do lago
  let spot = null;
  for (let x = -95; x < -75 && !spot; x++) for (let z = 65; z < 85 && !spot; z++) {
    const y = g.world.topY(x, z);
    if (g.world.peekBlock(x, y, z) === 17) spot = [x + 0.5, y + 1.05, z + 0.5];
  }
  g.player.pos.set(...spot);
  g.player.prevPos.copy(g.player.pos);
  g.player.vel.set(0, 0, 0);
  await new Promise((r) => setTimeout(r, 2500));
  return [before, g.survival.integrity];
});
check('pisar na lava tira integridade do traje', burn[1] < burn[0] - 5, `${burn[0].toFixed(0)} → ${burn[1].toFixed(0)}`);
await page.screenshot({ path: `${out}/mars-4-lava.png` });
await page.evaluate(() => { const g = window.spacing; g.survival.integrity = 100; });

// tempestade
await go(20, 20);
await page.waitForTimeout(1500);
const fogBefore = await page.evaluate(() => window.spacing.scene.fog.far);
await page.evaluate(() => { const w = window.spacing.mars.weather; w.phase = 'storm'; w.level = 1; w.left = 999; w.dur = 999; w.from = 1; });
await page.waitForTimeout(2000);
const storm = await page.evaluate(() => ({ far: window.spacing.scene.fog.far, push: Math.hypot(window.spacing.player.push.x, window.spacing.player.push.z) }));
check('na tempestade a visão cai', storm.far < fogBefore * 0.75, `${fogBefore.toFixed(0)} → ${storm.far.toFixed(0)}`);
check('na tempestade o vento empurra o astronauta', storm.push > 0.3, storm.push.toFixed(2));
await page.screenshot({ path: `${out}/mars-5-tempestade.png` });
await page.evaluate(() => { const w = window.spacing.mars.weather; w.phase = 'calm'; w.level = 0; w.from = 0; w.left = 999; w.dur = 999; });
await page.waitForTimeout(800);

// redemoinho passando pelo astronauta
const devil = await page.evaluate(async () => {
  const g = window.spacing;
  g.survival.battery = 50;
  const p = g.player.pos;
  g.mars.devils.devils.push({ x: p.x - 3, z: p.z, y: p.y, vx: 3, vz: 0, life: 4, max: 20, touched: false });
  await new Promise((r) => setTimeout(r, 2500));
  return g.survival.battery;
});
check('o redemoinho limpa os painéis (+bateria)', devil > 55, devil.toFixed(0));
await page.screenshot({ path: `${out}/mars-6-redemoinho.png` });

// gravidade: o pulo sobe menos e cai mais rápido que na Lua (Lua: pico ~1,8 bloco)
const jump = await page.evaluate(async () => {
  const g = window.spacing;
  const y0 = g.player.pos.y;
  let peak = y0;
  g.player.vel.y = 9.2;
  g.player.onGround = false;
  for (let i = 0; i < 60; i++) { await new Promise((r) => setTimeout(r, 16)); peak = Math.max(peak, g.player.pos.y); }
  return peak - y0;
});
check('o pulo em Marte é mais baixo que na Lua', jump > 0.6 && jump < 1.7, `${jump.toFixed(2)} bloco`);

// salvamento separado
await page.evaluate(() => window.spacing.persist());
const saves = await page.evaluate(() => ({ lua: localStorage.getItem('spacing.save'), marte: !!localStorage.getItem('spacing.save.marte') }));
check('Marte salva na chave própria', saves.marte);
check('o salvamento da Lua não foi tocado', saves.lua === '{"marca":"lua"}', saves.lua?.slice(0, 40));
check('nenhum erro ou aviso no console', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(results.join('\n'));
await browser.close();
if (results.some((r) => r.startsWith('FALHOU'))) process.exit(1);
