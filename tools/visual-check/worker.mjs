// Teste dos chunks em worker e da resolução dinâmica (docs/adr/0012). Anda pelo mundo e confere que os chunks novos vêm do
// worker (não da thread principal), que o jogo continua jogável e que nenhum buraco fica no chão. Usa `window.spacing`.
// Uso: node worker.mjs <url> <pasta-de-saída> [semente]
import chromium from '@sparticuz/chromium';
import { chromium as pw } from 'playwright-core';

const [url = 'http://localhost:5173/', out = '/tmp', seed = '7'] = process.argv.slice(2);
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

await page.goto(`${url}${url.includes('?') ? '&' : '?'}semente=${seed}`);
await page.waitForSelector('#btn-start:not([disabled])', { timeout: 120000 });
await page.click('#btn-start');
await page.waitForFunction(() => document.body.dataset.state === 'playing', null, { timeout: 180000 });
await page.waitForTimeout(1500);
check('o jogo usa workers para os chunks', await g(() => window.spacing.world.usesWorkers));

// conta os chunks gerados na thread principal (chunk() síncrono) a partir de agora
await g(() => {
  const w = window.spacing.world;
  w.perf = { onGenerate: () => (window.__gen = (window.__gen ?? 0) + 1), onMesh: () => (window.__mesh = (window.__mesh ?? 0) + 1) };
});
// anda 150 blocos para leste, de 10 em 10, esperando os chunks chegarem
for (let i = 1; i <= 15; i++) {
  await g((i) => {
    const s = window.spacing, p = s.player.pos;
    const x = i * 10, z = 0;
    s.player.pos.set(x + 0.5, Math.max(p.y, s.world.terrain.column(x, z).h + 2), z + 0.5);
    s.player.vel.set(0, 0, 0);
  }, i);
  await page.waitForTimeout(700);
}
await page.waitForFunction(() => window.spacing.world.update(window.spacing.player.pos.x, window.spacing.player.pos.z, 0, 0) === 0, null, { timeout: 60000, polling: 300 }).catch(() => {});
const after = await g(() => ({ chunks: window.spacing.world.chunkCount, gen: window.__gen ?? 0, mesh: window.__mesh ?? 0 }));
check('andou e carregou chunks novos', after.chunks > 0 && after.gen > 20, `${after.gen} chunks vindos do worker, ${after.mesh} malhas`);
const holes = await g(() => {
  const s = window.spacing, w = s.world, p = s.player.pos;
  let missing = 0, total = 0;
  for (const c of w.chunks.values()) {
    const dx = c.cx - Math.floor(p.x / 16), dz = c.cz - Math.floor(p.z / 16);
    if (dx * dx + dz * dz > 6) continue;
    total++;
    if (!c.mesh) missing++;
  }
  return { missing, total };
});
check('os chunks em volta têm malha', holes.missing === 0 && holes.total > 5, `${holes.total} perto, ${holes.missing} sem malha`);
// chamadas de desenho e triângulos por quadro, somando todas as passadas (sombra, cena, mapa, pós-processamento)
const scene = await g(() => new Promise((resolve) => {
  const info = window.spacing.renderer.info;
  info.autoReset = false;
  info.reset();
  let n = 0;
  const tick = () => {
    if (++n < 12) return requestAnimationFrame(tick);
    const r = { calls: info.render.calls / n, tri: info.render.triangles / n, chunks: window.spacing.world.chunkCount, objects: window.spacing.scene.children.length };
    info.autoReset = true;
    resolve(r);
  };
  requestAnimationFrame(tick);
}));
check('desenha algo', scene.calls > 10 && scene.tri > 1000, `${scene.calls.toFixed(0)} chamadas e ${(scene.tri / 1000).toFixed(0)} mil triângulos por quadro, ${scene.chunks} chunks, ${scene.objects} objetos na cena`);
await page.screenshot({ path: `${out}/worker-1.png` });
// minerar num chunk já carregado ainda refaz a malha na hora
const edit = await g(() => {
  const s = window.spacing, w = s.world, p = s.player.pos;
  const x = Math.floor(p.x) + 2, z = Math.floor(p.z);
  const y = w.topY(x, z);
  const c = w.chunks.get(w.key(Math.floor(x / 16), Math.floor(z / 16)));
  const geo = c.mesh.geometry;
  w.setBlock(x, y, z, 0);
  return { rebuilt: c.mesh.geometry !== geo, gone: w.getBlock(x, y, z) === 0 };
});
check('quebrar um bloco refaz a malha na hora', edit.rebuilt && edit.gone);
check('sem erros no console', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(results.join('\n'));
await browser.close();
process.exit(results.some((r) => r.startsWith('FALHOU')) ? 1 : 0);
