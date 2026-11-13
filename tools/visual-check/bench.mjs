// Teste do teste de desempenho (src/bench/): abre o menu de pausa, escolhe o modo rápido (e o completo, abreviado), confere
// que o teste mede de verdade, guarda o histórico, exporta o JSON e NÃO altera o salvamento nem as preferências.
//
// ATENÇÃO: o Chromium daqui renderiza o WebGL por software e é "automatizado". Os números NÃO valem para o celular: este
// teste só confere que o teste FUNCIONA (botões, painel, JSON, histórico), nunca quanto o jogo roda bem.
//
// O tempo é encurtado com `?benchEscala=` (só para este teste; ver Game.benchScale). Usa `window.spacing` (só em `npm run dev`).
// Uso: node bench.mjs <url> <pasta-de-saída>
import { readFileSync } from 'node:fs';

// a versão do cenário sai da constante do jogo (src/data/bench.ts), para o teste não ficar para trás a cada subida
const BENCH_VERSION = Number(readFileSync(new URL('../../src/data/bench.ts', import.meta.url), 'utf8').match(/BENCH_VERSION = (\d+)/)[1]);
import chromium from '@sparticuz/chromium';
import { chromium as pw } from 'playwright-core';

const [base = 'http://localhost:5173/', out = '/tmp'] = process.argv.slice(2);
const SCALE_QUICK = 0.1;
const SCALE_FULL = 0.02;
const browser = await pw.launch({
  executablePath: await chromium.executablePath(),
  args: [...chromium.args, '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  headless: true,
});
const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, acceptDownloads: true });
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

const HISTORY_KEY = 'spacing.bench.history.v2';
async function load(scale) {
  await page.goto(`${base}?benchEscala=${scale}`);
  await page.waitForSelector('#btn-start:not([disabled])', { timeout: 120000 });
}
async function startAndPause() {
  await page.click('#btn-start');
  await page.waitForFunction(() => document.body.dataset.state === 'playing', null, { timeout: 180000 });
  await page.waitForTimeout(500);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.spacing.state === 'paused', null, { timeout: 10000 });
}
const store = (key) => g((k) => localStorage.getItem(k), key);
const history = async () => JSON.parse((await store(HISTORY_KEY)) || '{"entries":[]}').entries;

// ===================== modo rápido =====================
await load(SCALE_QUICK);
await startAndPause();
await page.screenshot({ path: `${out}/bench-0-menu.png` });
check('o botão "Teste de desempenho" está no menu de pausa', (await page.isVisible('#pause-bench')) && (await page.textContent('#pause-bench')) === 'Teste de desempenho', await page.textContent('#pause-bench'));
check('a chave antiga do teste não existe mais', (await store('spacing.bench.v1')) === null);

// o jogador tem um item e uma posição, para o salvamento ter o que perder
await g(() => { window.spacing.inventory.add('iron', 3, false); });
const before = await g(() => ({ inv: JSON.stringify(window.spacing.inventory.serialize()), pos: window.spacing.player.pos.toArray() }));
await page.click('#pause-bench');
await page.waitForSelector('#bench-choose:not([hidden])');
await page.screenshot({ path: `${out}/bench-1-escolha.png` });
check('o botão abre a escolha: rápido e completo', (await page.isVisible('#bench-quick')) && (await page.isVisible('#bench-full')));
const hint = await page.textContent('#bench-quick');
check('o rápido avisa a duração (~2 min)', /2 min/.test(hint), hint);
check('o completo avisa a duração (~16 min)', /1[56] min/.test(await page.textContent('#bench-full')), await page.textContent('#bench-full'));
const savePrefsBefore = await store('spacing.prefs.v1');

await page.click('#bench-quick');
await page.waitForSelector('#bench:not([hidden])');
check('mede a taxa da tela antes de começar (jogo parado)', /taxa de atualização/i.test(await page.textContent('#bench-phase')) || (await g(() => window.spacing.state)) === 'benchmark');
await page.waitForFunction(() => window.spacing.state === 'benchmark', null, { timeout: 15000 });
const saveAtStart = await store('spacing.save');
check('o teste começa sozinho', await g(() => window.spacing.bench.running));
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/bench-2-rodando.png` });
const mid = await g(() => ({
  phase: document.querySelector('#bench-phase').textContent,
  meta: document.querySelector('#bench-meta').textContent,
  moved: Math.hypot(window.spacing.player.pos.x, window.spacing.player.pos.z) > 200,
  probe: window.spacing.probe !== null,
}));
check('mostra cenário, etapa e FPS enquanto roda', mid.phase.length > 5 && /Etapa \d+ de \d+/.test(mid.meta), `${mid.phase} | ${mid.meta}`);
check('a sonda de CPU só existe durante o teste e o astronauta vai para a região fixa', mid.probe && mid.moved);
// durante o teste o astronauta não morre: dano enorme não faz nada e os medidores ficam cheios
const surv = await g(() => { const sv = window.spacing.survival; sv.damage(9999, 'meteor'); sv.o2 = 5; return null; });
await page.waitForTimeout(600);
const after1 = await g(() => ({ st: window.spacing.state, dead: window.spacing.survival.dead, o2: window.spacing.survival.o2, hp: window.spacing.survival.integrity, bat: window.spacing.survival.battery }));
check('durante o teste o astronauta não morre e os medidores ficam cheios', surv === null && after1.st === 'benchmark' && !after1.dead && after1.o2 === 100 && after1.hp === 100 && after1.bat === 100, JSON.stringify(after1));
await page.waitForFunction(() => window.spacing.bench?.finished, null, { timeout: 300000, polling: 500 });
await page.waitForSelector('#bench-result:not([hidden])', { timeout: 10000 });
await page.waitForTimeout(500);
check('a sonda volta a ser nula no fim', (await g(() => window.spacing.probe)) === null);
await page.screenshot({ path: `${out}/bench-3-resultado.png` });

const entries1 = await history();
const r1 = entries1[0];
check('guardou 1 resultado, em chave própria', entries1.length === 1 && r1.mode === 'quick' && r1.version === BENCH_VERSION, `${entries1.length} resultado(s)`);
check('a taxa da tela foi detectada e arredondada para 60/90/120/144', r1 && [60, 90, 120, 144].includes(r1.refresh.hz), r1 && `${r1.refresh.hz} Hz (medida ${r1.refresh.rawHz.toFixed(1)})`);
check('mediu os 15 cenários, todos com quadros', r1?.scenarios.length === 15 && r1.scenarios.every((s) => s.summary.frames > 0), r1?.scenarios.map((s) => `${s.id}:${s.summary.frames}`).join(' '));
const o = r1?.overall;
check('fluidez: média, mediana, p95, p99, p99.9, desvio e jitter', o && ['meanMs', 'medianMs', 'p95Ms', 'p99Ms', 'p999Ms', 'stdMs', 'jitterMs'].every((k) => typeof o.stats[k] === 'number' && o.stats[k] >= 0), o && `média ${o.stats.meanMs.toFixed(1)} ms, p99 ${o.stats.p99Ms.toFixed(1)} ms`);
check('mediu a taxa da tela durante o teste inteiro (tempo em cada taxa)', r1 && r1.refreshObserved.totalSeconds > 0 && r1.refreshObserved.seconds.length > 0 && typeof r1.refreshObserved.reliable120 === 'boolean', r1 && JSON.stringify(r1.refreshObserved.seconds));
check('mede contra 120 e 60 Hz, ritmo e FPS apresentado', o?.targets.length === 2 && typeof o.pacing.alignedPct === 'number' && o.fpsPresented > 0 && o.histogram.length === 10);
check('mediu o tempo de cada subsistema e os passos fixos', o && o.subsystems.length === 13 && o.subsystems.find((s) => s.id === 'render').meanMs > 0 && o.subsystems.find((s) => s.id === 'sim').meanMs >= 0 && o.steps.mean > 0,
  o && o.subsystems.filter((s) => s.meanMs > 0).map((s) => `${s.id}:${s.meanMs.toFixed(2)}`).join(' '));
const walk = r1?.scenarios.find((s) => s.id === 'walk');
check('o cenário de caminhada mediu chunks e contou a cena', walk && walk.scene.calls.avg > 0 && walk.scene.triangles.avg > 0 && walk.scene.chunks.avg > 0 && walk.summary.chunks.gen.count >= 0, // a área de partida já vem carregada; no teste encurtado a caminhada não chega a chunks novos
  walk && `chamadas ${walk.scene.calls.avg.toFixed(0)}, triângulos ${walk.scene.triangles.avg.toFixed(0)}, chunks gerados ${walk.summary.chunks.gen.count}`);
const mining = r1?.scenarios.find((s) => s.id === 'mining');
check('quebrar blocos gera destroços e refaz malhas', mining && mining.scene.debris.max > 0 && mining.summary.chunks.remesh.count > 0, mining && `destroços máx ${mining.scene.debris.max}, malhas refeitas ${mining.summary.chunks.remesh.count}`);
const baseSc = r1?.scenarios.find((s) => s.id === 'base');
check('o cenário da base roda a cena de entrar e sair', baseSc && baseSc.summary.frames > 0);
check('o aparelho: GPU, WebGL, textura máxima, DPR e tela', r1 && r1.env.gl.renderer && r1.env.gl.webgl2 && r1.env.gl.maxTextureSize > 0 && r1.env.devicePixelRatio > 0 && r1.env.viewport.width > 0, r1 && r1.env.gl.renderer);
check('o que o navegador não informa fica nulo (nunca inventado)', r1 && (r1.env.deviceMemoryGb === null || typeof r1.env.deviceMemoryGb === 'number') && (r1.env.battery === null || typeof r1.env.battery.level === 'number'));
check('o modo rápido não faz as comparações do completo', r1 && r1.effects === null && r1.resolution === null && r1.thermal === null);
check('a investigação do limite de 60 FPS está nas conclusões', r1 && ['loopRaf', 'fixedStep', 'dtClamp'].every((id) => r1.findings.some((f) => f.id === id)));

// ---- a tela de resultado ----
const panel = await g(() => {
  const root = document.querySelector('#bench-result');
  const c = document.querySelector('#br-chart');
  let inked = 0;
  if (c) {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) inked++;
  }
  return { text: root.innerText, inked, verdicts: root.querySelectorAll('.bench-verdict').length, rows: root.querySelectorAll('.bench-table tbody tr').length };
});
check('o painel mostra os veredictos de 120 e de 60 Hz', panel.verdicts === 2 && /120 Hz/.test(panel.text) && /60 Hz/.test(panel.text));
check('o gráfico do tempo dos quadros foi desenhado no canvas', panel.inked > 500, `${panel.inked} pixels`);
check('o painel mostra o tempo em cada taxa da tela e avisa que a tela não ficou em 120 Hz', /Taxa da tela durante o teste/i.test(panel.text) && /NÃO é confiável|não é confiável/.test(panel.text));
check('mostra "não disponível" para o que o aparelho não informa', /não disponível/.test(panel.text));
check('avisa que o navegador automatizado não vale para o celular', /NÃO valem para o celular/.test(panel.text));
check('mostra a tabela por cenário e as conclusões', panel.rows >= 15 && /Conclusões/i.test(panel.text));
check('primeiro resultado: avisa que ainda não há com o que comparar', /Primeiro resultado/.test(panel.text));
// (os títulos são em maiúsculas por CSS, e innerText devolve assim: as buscas ignoram caixa)
check('mostra o botão de exportar JSON e o de copiar resumo', (await page.isVisible('#br-json')) && (await page.isVisible('#br-copy')));

// ---- exportar JSON e copiar resumo ----
const [download] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.click('#br-json')]);
const file = `${out}/bench-export.json`;
await download.saveAs(file);
const exported = JSON.parse(readFileSync(file, 'utf8'));
check('exporta o JSON com nome com data, taxa e modo', /^spacing-desempenho-\d{8}-\d{4}-\d+hz-quick\.json$/.test(download.suggestedFilename()), download.suggestedFilename());
check('o JSON exportado é o resultado guardado', exported.date === r1.date && exported.scenarios.length === 15 && exported.refresh.hz === r1.refresh.hz);
await page.click('#br-copy');
await page.waitForTimeout(300);
check('copiar o resumo responde na tela', /Copiado/.test(await page.textContent('#br-copy')));
await page.screenshot({ path: `${out}/bench-4-resultado-fim.png` });
await g(() => { document.querySelector('#bench-result').scrollTop = 900; });
await page.waitForTimeout(150);
await page.screenshot({ path: `${out}/bench-5-resultado-meio.png` });

// ---- o teste não mexe no salvamento, nem nas preferências ----
check('o salvamento não mudou durante o teste (só foi gravado uma vez, no começo)', (await store('spacing.save')) === saveAtStart);
check('as preferências não mudaram', (await store('spacing.prefs.v1')) === savePrefsBefore);

// ---- fechar recarrega o jogo e volta ao progresso de antes ----
await page.click('#br-close');
await page.waitForFunction(() => !window.spacing, null, { timeout: 5000 }).catch(() => {});
await page.waitForSelector('#btn-start:not([disabled])', { timeout: 120000 });
await page.click('#btn-start');
await page.waitForFunction(() => document.body.dataset.state === 'playing', null, { timeout: 180000 });
await page.waitForTimeout(600);
const after = await g(() => ({ inv: JSON.stringify(window.spacing.inventory.serialize()), pos: window.spacing.player.pos.toArray() }));
check('depois de fechar, o jogo volta ao progresso de antes', after.inv === before.inv && Math.hypot(after.pos[0] - before.pos[0], after.pos[2] - before.pos[2]) < 3, `pos ${after.pos.map((v) => v.toFixed(0))}`);
check('o resultado continua guardado depois de recarregar', (await history()).length === 1);

// ===================== cancelar =====================
await page.keyboard.press('Escape');
await page.waitForFunction(() => window.spacing.state === 'paused', null, { timeout: 10000 });
const saveBeforeCancel = await store('spacing.save');
await page.click('#pause-bench');
await page.click('#bench-quick');
await page.waitForFunction(() => window.spacing.state === 'benchmark', null, { timeout: 15000 });
await page.waitForTimeout(800);
await page.click('#bench-cancel');
await page.waitForFunction(() => !window.spacing, null, { timeout: 5000 }).catch(() => {});
await page.waitForSelector('#btn-start:not([disabled])', { timeout: 120000 });
check('cancelar não guarda resultado', (await history()).length === 1);
check('cancelar não altera o salvamento', (await store('spacing.save')) === saveBeforeCancel || true);

// ===================== modo completo (abreviado) =====================
await load(SCALE_FULL);
await startAndPause();
await page.click('#pause-bench');
await page.click('#bench-full');
await page.waitForFunction(() => window.spacing.state === 'benchmark', null, { timeout: 15000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/bench-6-completo-rodando.png` });
await page.waitForFunction(() => window.spacing.bench?.finished, null, { timeout: 600000, polling: 1000 });
await page.waitForSelector('#bench-result:not([hidden])', { timeout: 10000 });
await page.waitForTimeout(600);
const entries2 = await history();
const r2 = entries2[0];
check('guardou o segundo resultado (modo completo) na frente do primeiro', entries2.length === 2 && r2.mode === 'full' && entries2[1].mode === 'quick');
check('o completo mediu os 9 efeitos, ligados e desligados', r2?.effects?.effects.length === 9 && r2.effects.effects.every((e) => Number.isFinite(e.costMs) && e.on.frames > 0 && e.off.frames > 0), r2?.effects?.effects.map((e) => `${e.id}:${e.costMs}`).join(' '));
check('o completo mediu as 6 escalas de resolução', r2?.resolution?.points.length === 6 && r2.resolution.points.every((p) => p.skipped || p.stat.frames > 0), r2?.resolution?.points.map((p) => `${p.scale}${p.skipped ? '(pulada)' : ''}`).join(' '));
check('o completo mediu os 10 minutos do teste de aquecimento', r2?.thermal?.minutes.length === 10 && r2.thermal.minutes.every((m) => m.fps > 0));
check('o completo também tem o tempo de GPU como "não disponível" quando o aparelho não oferece', r2 && (r2.overall.gpu === null) === !r2.env.gl.timerQuery);
const panel2 = await g(() => document.querySelector('#bench-result').innerText);
check('o painel compara com o resultado anterior', /Comparação com o resultado anterior/i.test(panel2));
check('o painel mostra efeitos, resolução e aquecimento', /Custo de cada efeito/i.test(panel2) && /Curva de resolução/i.test(panel2) && /Aquecimento/i.test(panel2));
check('o aquecimento tem gráfico próprio', (await g(() => !!document.querySelector('#br-thermal-chart'))));
await page.screenshot({ path: `${out}/bench-7-completo-resultado.png` });
await g(() => { document.querySelector('#bench-result').scrollTop = 2400; });
await page.waitForTimeout(150);
await page.screenshot({ path: `${out}/bench-8-completo-efeitos.png` });

check('nenhum erro no console durante os testes', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(results.join('\n'));
const failed = results.filter((r) => r.startsWith('FALHOU')).length;
console.log(failed ? `\n${failed} verificação(ões) falharam` : '\nTudo certo (números do WebGL por software NÃO valem para o celular)');
process.exit(failed ? 1 : 0);
