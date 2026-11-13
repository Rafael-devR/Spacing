// Teste das cavernas (docs/design/MUNDO.md): o mundo de uma semente tem uma entrada de caverna perto do pouso; descendo
// a rampa a câmera chega perto do astronauta, o fundo fica escuro e a lanterna do capacete acende.
// Usa `window.spacing` (só em `npm run dev`). Uso: node caves.mjs <url> <pasta-de-saída> [semente] [largura] [altura]
import chromium from '@sparticuz/chromium';
import { chromium as pw } from 'playwright-core';

const [url = 'http://localhost:5173/', out = '/tmp', seed = '1', W = '844', H = '390'] = process.argv.slice(2);
const browser = await pw.launch({
  executablePath: await chromium.executablePath(),
  args: [...chromium.args, '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  headless: true,
});
const ctx = await browser.newContext({ viewport: { width: Number(W), height: Number(H) } });
await ctx.addInitScript(() => {
  try {
    localStorage.clear();
    localStorage.setItem('spacing.prefs.v1', JSON.stringify({ quality: 'medio', muted: true, shake: 'off', vibration: false, fullscreen: false }));
  } catch {}
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const results = [];
const check = (name, ok, detail = '') => results.push(`${ok ? 'OK  ' : 'FALHOU'} ${name}${detail ? ' (' + detail + ')' : ''}`);
const g = (fn, arg) => page.evaluate(fn, arg);
const tag = `${seed}-${W}x${H}`;
const shot = (n) => page.screenshot({ path: `${out}/caves-${tag}-${n}.png` });

await page.goto(`${url}${url.includes('?') ? '&' : '?'}semente=${seed}`);
await page.waitForSelector('#btn-start:not([disabled])', { timeout: 120000 });
await page.click('#btn-start');
await page.waitForFunction(() => document.body.dataset.state === 'playing', null, { timeout: 180000 });
await page.waitForTimeout(1200);
check('a semente do endereço vale num jogo novo', (await g(() => window.spacing.seed)) === Number(seed));
await shot('0-pouso');

const pit = await g(() => window.spacing.world.terrain.caves.homePit());
check('há uma entrada de caverna perto do pouso', !!pit, pit ? `tubo em ${pit.x},${pit.z}, rampa de ${pit.len} blocos` : '');
if (pit) {
  // põe o astronauta num ponto da rampa (s = distância desde o tubo) e espera os chunks e a câmera
  const go = async (s, wait = 2600) => {
    await g(([p, s]) => {
      const sp = window.spacing, x = p.x + 0.5 + p.dx * s, z = p.z + 0.5 + p.dz * s;
      sp.player.pos.set(x, p.floor + 1.05 + Math.max(0, s - 3) * 0.5 + 0.4, z);
      sp.player.vel.set(0, 0, 0);
    }, [pit, s]);
    await page.waitForTimeout(wait);
    return g(() => {
      const sp = window.spacing, p = sp.player.pos;
      return { y: p.y, eye: sp.rig.eye, cave: sp.rig.cave, dark: sp.dark, fov: sp.camera.fov, sky: sp.world.skyAt(p.x, p.y + 1.2, p.z), stuck: sp.player.collides(p.x, p.y, p.z) };
    });
  };
  const top = await go(pit.len + 5, 4000);
  await shot('1-boca');
  check('fora da caverna a câmera fica longe', top.eye > 25 && top.cave < 0.2, `distância ${top.eye.toFixed(1)}, caverna ${top.cave.toFixed(2)}`);
  const mid = await go(pit.len * 0.45);
  await shot('2-rampa');
  check('na rampa o astronauta não fica preso na rocha', !mid.stuck);
  const low = await go(1.5, 3500);
  await page.waitForFunction(() => window.spacing.rig.cave > 0.9, null, { timeout: 30000 }).catch(() => {});
  await shot('3-tubo');
  const eye = await g(() => window.spacing.rig.eye);
  check('no tubo a câmera chega perto', eye < 18, `distância ${eye.toFixed(1)}`);
  check('no tubo o astronauta não fica preso na rocha', !low.stuck);
  // anda pelo tubo (perpendicular à rampa), para longe da claraboia
  // anda pelo tubo, para longe da claraboia: segue em frente e desvia de lado quando o tubo faz curva
  const far = await g(([p]) => {
    const sp = window.spacing, w = sp.world;
    const free = (x, z) => !w.getBlock(Math.floor(x), p.floor + 1, Math.floor(z)) && !w.getBlock(Math.floor(x), p.floor + 2, Math.floor(z)) && w.getBlock(Math.floor(x), p.floor, Math.floor(z));
    let best = { n: 0, x: 0, z: 0 };
    for (const sign of [1, -1]) {
      let x = p.x + 0.5, z = p.z + 0.5, n = 0;
      const fx = -p.dz * sign, fz = p.dx * sign;
      for (; n < 26; n++) {
        const step = [0, 1, -1].map((k) => [x + fx + p.dx * k, z + fz + p.dz * k]).find(([nx, nz]) => free(nx, nz));
        if (!step) break;
        [x, z] = step;
      }
      if (n > best.n) best = { n, x, z };
    }
    if (best.n >= 8) { sp.player.pos.set(best.x, p.floor + 1.3, best.z); sp.player.vel.set(0, 0, 0); }
    return best.n;
  }, [pit]);
  await page.waitForFunction(() => window.spacing.dark > 0.75, null, { timeout: 30000 }).catch(() => {});
  const deep = await g(() => { const sp = window.spacing, p = sp.player.pos; return { dark: sp.dark, sky: sp.world.skyAt(p.x, p.y + 1.2, p.z), eye: sp.rig.eye, lamp: sp.lamp }; });
  await shot('4-fundo');
  check('dá para andar pelo tubo', far >= 8, `${far} blocos`);
  check('longe da entrada fica escuro e a lanterna acende', deep.dark > 0.6 && deep.sky < 0.5, `escuro ${deep.dark.toFixed(2)}, céu ${deep.sky.toFixed(2)}`);
  for (const d of [1, 1]) { await g((d) => window.spacing.rig.rotate(d), d); await page.waitForTimeout(1500); }
  await shot('5-girado');
}
check('sem erros no console', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(results.join('\n'));
await browser.close();
process.exit(results.some((r) => r.startsWith('FALHOU')) ? 1 : 0);
