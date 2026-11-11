// Teste do benchmark: abre o menu de pausa, roda o teste (abreviado) e confere que ele mede de verdade, que guarda o
// resultado, que compara com o anterior, que NÃO altera o salvamento do jogo e que cancelar também não altera.
// Usa `window.spacing` (só em `npm run dev`). Uso: node bench.mjs <url> <pasta-de-saída>
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
  if (sessionStorage.getItem('bench-test-init')) return; // só na primeira carga: as seguintes (recarregar) mantêm o armazenamento
  sessionStorage.setItem('bench-test-init', '1');
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

async function load() {
  await page.goto(url);
  await page.waitForSelector('#btn-start:not([disabled])', { timeout: 120000 });
}
async function startAndPause() {
  await page.click('#btn-start');
  await page.waitForTimeout(500);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.spacing.state === 'paused', null, { timeout: 10000 });
}
const saveOf = () => g(() => localStorage.getItem('spacing.save'));
const benchOf = () => g(() => JSON.parse(localStorage.getItem('spacing.bench.v1') || 'null'));

await load();
await startAndPause();
await page.screenshot({ path: `${out}/bench-0-menu.png` });
check('o botão do teste está no menu de pausa', await page.isVisible('#pause-bench'), await page.textContent('#pause-bench'));
check('sem resultado guardado, não mostra "Último resultado"', await page.isHidden('#pause-bench-last'));

// jogador com um item e um bloco diferente, para o salvamento ter o que perder
await g(() => { window.spacing.inventory.add('iron', 3, false); });
const before = await g(() => ({ inv: JSON.stringify(window.spacing.inventory.serialize()), pos: window.spacing.player.pos.toArray() }));

// ---- 1ª rodada (abreviada) ----
await g(() => { window.spacing.bench.scale = 0.14; });
await page.click('#pause-bench');
await page.waitForFunction(() => window.spacing.state === 'benchmark', null, { timeout: 10000 });
const saveAtStart = await saveOf();
check('o teste começa sozinho, sem o jogador jogar', await g(() => window.spacing.bench.running));
check('mostra o acompanhamento na tela', await page.isVisible('#bench'));
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/bench-1-rodando.png` });
const mid = await g(() => ({
  hud: getComputedStyle(document.querySelector('#hud')).visibility,
  phase: document.querySelector('#bench-phase').textContent,
  moved: Math.hypot(window.spacing.player.pos.x - 0, window.spacing.player.pos.z - 0) > 200,
  info: window.spacing.renderer.info.autoReset,
}));
check('o HUD do jogo some durante o teste e o astronauta vai para a região fixa', mid.hud === 'hidden' && mid.moved, JSON.stringify(mid));
const done = await page.waitForFunction(() => window.spacing.bench.finished, null, { timeout: 240000, polling: 500 }).then(() => true, () => false);
check('o teste termina sozinho', done);
await page.waitForSelector('#bench-result:not([hidden])', { timeout: 10000 });
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/bench-2-resultado.png`, fullPage: false });
const r1 = await benchOf();
const o = r1?.last?.overall;
check('guardou o resultado no navegador', !!r1?.last && r1.previous === null);
check('mediu FPS médio, mínimo e os piores quadros', o && o.frames > 20 && o.avgFps > 0 && o.minFps > 0 && o.minFps <= o.avgFps && o.maxMs > 0 && r1.last.worst.length >= 3,
  o && `${o.frames} quadros, ${o.avgFps.toFixed(1)} FPS médio, mín ${o.minFps.toFixed(1)}, pior ${o.maxMs.toFixed(0)} ms`);
check('mediu as cinco etapas', r1?.last.phases.length === 5 && r1.last.phases.every((p) => p.frames > 0), r1?.last.phases.map((p) => `${p.id}:${p.frames}`).join(' '));
const ck = r1?.last.chunks;
check('mediu a geração de chunks (novos e refeitos ao quebrar bloco)', ck && ck.generated.count > 5 && ck.meshed.count > 5 && ck.remeshed.count > 0 && ck.generated.avgMs >= 0,
  ck && `gerados ${ck.generated.count} (${ck.generated.avgMs.toFixed(2)} ms), malhas ${ck.meshed.count}, refeitas ${ck.remeshed.count}`);
const sc = r1?.last.scene;
check('contou triângulos, chamadas de desenho e objetos', sc && sc.triangles.avg > 1000 && sc.calls.avg > 3 && sc.objects.avg > 10,
  sc && `${Math.round(sc.triangles.avg)} triângulos, ${Math.round(sc.calls.avg)} chamadas, ${Math.round(sc.objects.avg)} objetos`);
check('o roteiro de fato quebrou blocos e soltou meteoros e itens', sc && sc.debris.max > 5 && sc.particles.max > 5 && sc.meteors.max >= 1 && sc.drops.max >= 1,
  sc && `destroços ${sc.debris.max}, partículas ${sc.particles.max}, meteoros ${sc.meteors.max}, itens ${sc.drops.max}`);
const gr = r1?.last.graphics;
const canvas = await g(() => [window.spacing.renderer.domElement.width, window.spacing.renderer.domElement.height]);
check('anotou a qualidade e a resolução usadas', gr && gr.quality === 'baixo' && gr.auto === false && gr.buffer[0] === canvas[0] && gr.buffer[1] === canvas[1], gr && `${gr.quality} ${gr.buffer.join('×')}`);
const txt = await page.textContent('#bench-result');
check('a tela de resultado mostra FPS médio, mínimo, etapas e chunks', ['FPS médio', 'FPS mínimo', 'Pior quadro', 'Quebrando blocos', 'Chunks', 'Qualidade'].every((k) => txt.includes(k)));
check('no primeiro resultado avisa que ainda não há o que comparar', txt.includes('Primeiro resultado'));
const saveAtEnd = await saveOf();
check('o salvamento do jogo não mudou durante o teste', saveAtStart === saveAtEnd);
await page.click('#br-close');

// ---- volta ao jogo: recarrega e o progresso está intacto ----
await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: 60000 });
await page.waitForSelector('#btn-start:not([disabled])', { timeout: 120000 });
const afterReload = await g(() => ({
  inv: JSON.stringify(window.spacing.inventory.serialize()),
  pos: window.spacing.player.pos.toArray(),
  state: window.spacing.state,
  last: !!JSON.parse(localStorage.getItem('spacing.bench.v1'))?.last,
}));
check('ao voltar ao jogo, o progresso é o de antes do teste', afterReload.inv === before.inv && Math.hypot(afterReload.pos[0] - before.pos[0], afterReload.pos[2] - before.pos[2]) < 3 && afterReload.state === 'menu',
  `itens iguais: ${afterReload.inv === before.inv}`);
check('o resultado continua guardado depois de recarregar', afterReload.last);

// ---- 2ª rodada: compara com a anterior; "Último resultado" no menu ----
await startAndPause();
check('"Último resultado" aparece no menu depois do primeiro teste', await page.isVisible('#pause-bench-last'));
await page.click('#pause-bench-last');
await page.waitForSelector('#bench-result:not([hidden])');
check('dá para rever o último resultado sem rodar', (await page.textContent('#bench-result')).includes('FPS médio'));
await page.screenshot({ path: `${out}/bench-3-rever.png` });
await page.click('#br-close');
await page.waitForFunction(() => !document.querySelector('#pause').hidden, null, { timeout: 5000 });
check('fechar volta ao menu de pausa', await page.isVisible('#pause'));
await g(() => { window.spacing.bench.scale = 0.14; });
await page.click('#pause-bench');
await page.waitForFunction(() => window.spacing.bench.finished, null, { timeout: 240000, polling: 500 });
await page.waitForSelector('#bench-result:not([hidden])');
await page.waitForTimeout(400);
const r2 = await benchOf();
check('o segundo resultado guarda o primeiro como anterior', !!r2.last && !!r2.previous && r2.previous.date === r1.last.date);
const txt2 = await page.textContent('#bench-result');
check('a tela compara com o anterior (antes/depois)', txt2.includes('antes:') && /(▲|▼|≈ igual)/.test(txt2));
await page.screenshot({ path: `${out}/bench-4-comparacao.png` });
await page.click('#br-close');
await page.waitForSelector('#btn-start:not([disabled])', { timeout: 120000 });

// ---- cancelar: nada muda ----
await startAndPause();
const benchBeforeCancel = await g(() => localStorage.getItem('spacing.bench.v1'));
await g(() => { window.spacing.bench.scale = 1; });
await page.click('#pause-bench');
await page.waitForFunction(() => window.spacing.state === 'benchmark', null, { timeout: 10000 });
const saveBeforeCancel = await saveOf(); // o jogo grava uma vez ao começar; daqui em diante nada pode mudar
await page.waitForTimeout(1500);
await page.click('#bench-cancel');
await page.waitForSelector('#btn-start:not([disabled])', { timeout: 120000 });
check('cancelar recarrega o jogo sem alterar o salvamento nem o resultado guardado', (await saveOf()) === saveBeforeCancel && (await g(() => localStorage.getItem('spacing.bench.v1'))) === benchBeforeCancel);

check('sem erros no console', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(results.join('\n'));
await browser.close();
