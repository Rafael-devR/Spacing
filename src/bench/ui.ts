// Telas do teste de desempenho: escolha do modo, acompanhamento enquanto roda e resultado (docs/design/BENCHMARK.md).
// Quem decide quando mostrar cada uma é o Game. Todo texto vem de src/i18n/pt-BR.ts.
import { BENCH_TARGETS, plannedSeconds, type BenchMode } from '../data/bench';
import { t, type MessageKey } from '../i18n';
import { el } from '../ui/dom';
import { drawChart, type ChartRun } from './chart';
import { compareReports, setupDiff, type BenchReport, type CompareRow, type ScenarioResult, type Summary } from './report';
import type { BenchProgress } from './runner';
import { HISTOGRAM_EDGES, histogramLabels, type Comparison } from './stats';
import { exportJson, exportName, findingText, num, orNA, reportText, type Tr } from './text';

const tr: Tr = (k, p) => t(k, p);
const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
const big = (v: number): string => (v >= 1e6 ? `${num(v / 1e6, 2)} M` : v >= 1e4 ? `${num(v / 1e3, 1)} mil` : num(v, 0));
const mmss = (s: number): string => `${Math.floor(s / 60)}:${String(Math.round(s % 60) % 60).padStart(2, '0')}`;

/** como mostrar a diferença para o resultado anterior */
function chip(c: Comparison, digits = 1): string {
  if (c.verdict === 'same') return `<span class="bd same">${t('bench.cmp.same')}</span>`;
  const arrow = c.diff > 0 ? '▲' : '▼';
  const pct = c.pct === null ? '' : ` (${c.pct > 0 ? '+' : ''}${num(c.pct * 100, 0)}%)`;
  return `<span class="bd ${c.verdict}">${arrow} ${c.diff > 0 ? '+' : ''}${num(c.diff, digits)}${pct}</span>`;
}

const row = (label: string, value: string): string => `<div class="br-row"><dt>${esc(label)}</dt><dd>${value}</dd></div>`;
const section = (title: string, body: string): string => `<h3>${esc(title)}</h3>${body}`;
const table = (head: string[], rows: string[][], id = ''): string =>
  `<div class="bench-scroll"><table class="bench-table"${id ? ` id="${id}"` : ''}><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c, i) => (i === 0 ? `<th>${c}</th>` : `<td>${c}</td>`)).join('')}</tr>`)
    .join('')}</tbody></table></div>`;

export class BenchUi {
  /** o jogador escolheu um modo */
  onStart: ((mode: BenchMode) => void) | null = null;
  /** o jogador cancelou durante o teste */
  onCancel: (() => void) | null = null;
  /** pediu o último resultado na tela de escolha */
  onShowLast: (() => void) | null = null;
  /** fechou o resultado ou a escolha; `after` = acabou de rodar (o jogo recarrega), senão volta ao menu de pausa */
  onClose: ((after: boolean) => void) | null = null;

  private readonly live = el('#bench');
  private readonly choose = el('#bench-choose');
  private readonly result = el('#bench-result');
  private history: BenchReport[] = [];
  private index = 0;
  private after = false;
  private text = '';

  constructor() {
    this.live.innerHTML = `
      <div class="bench-top"><strong>${t('bench.title')}</strong><button class="chip" id="bench-cancel" type="button">${t('bench.cancel')}</button></div>
      <span id="bench-phase"></span>
      <div class="bench-bar"><i id="bench-fill"></i></div>
      <span id="bench-meta"></span>
      <span id="bench-tip">${t('bench.tapHint')}</span>`;
    el('#bench-cancel').addEventListener('click', () => this.onCancel?.());
    // o toque no cartão de acompanhamento não pode chegar ao jogo, mas os toques fora dele servem para medir a latência
    el('#bench-cancel').addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  // ---------- escolha ----------

  showChooser(hasHistory: boolean): void {
    const min = (m: BenchMode): string => num(Math.round(plannedSeconds(m) / 6) / 10, 0);
    this.choose.hidden = false;
    this.choose.innerHTML = `<div class="bench-card-wrap">
      <h2>${t('bench.choose.title')}</h2>
      <p class="bench-note">${t('bench.choose.intro')}</p>
      <div class="bench-modes">
        <button class="bench-mode" id="bench-quick" type="button"><strong>${t('bench.mode.quick')}</strong><span>${t('bench.mode.quickHint', { min: min('quick') })}</span></button>
        <button class="bench-mode" id="bench-full" type="button"><strong>${t('bench.mode.full')}</strong><span>${t('bench.mode.fullHint', { min: min('full') })}</span></button>
      </div>
      <p class="bench-note">${t('bench.choose.tip')}</p>
      <div class="bench-actions">
        ${hasHistory ? `<button class="ghost-btn" id="bench-last" type="button">${t('bench.choose.last')}</button>` : ''}
        <button class="ghost-btn" id="bench-choose-close" type="button">${t('bench.back')}</button>
      </div>
    </div>`;
    el('#bench-quick').addEventListener('click', () => this.onStart?.('quick'));
    el('#bench-full').addEventListener('click', () => this.onStart?.('full'));
    if (hasHistory) el('#bench-last').addEventListener('click', () => this.onShowLast?.());
    el('#bench-choose-close').addEventListener('click', () => this.dismiss());
  }

  hideChooser(): void {
    this.choose.hidden = true;
  }

  // ---------- enquanto roda ----------

  showDetecting(): void {
    this.hideChooser();
    this.live.hidden = false;
    el('#bench-phase').textContent = t('bench.detecting');
    el('#bench-fill').style.width = '0%';
    el('#bench-meta').textContent = '';
  }

  progress(p: BenchProgress): void {
    let name: string;
    if (p.kind === 'effect') {
      name = p.id === 'baseline' ? t('bench.stage.baseline') : t('bench.stage.effect', { name: t(`bench.fx.${p.id}` as MessageKey), state: t(p.detail === 'on' ? 'bench.on' : 'bench.off') });
    } else if (p.kind === 'resolution') name = t('bench.stage.resolution', { scale: p.detail });
    else if (p.kind === 'thermal') name = t('bench.stage.thermal', { n: p.detail, total: 10 });
    else name = t(`bench.sc.${p.id}` as MessageKey);
    el('#bench-phase').textContent = `${name} · ${t(p.warming ? 'bench.warming' : 'bench.measuring')}`;
    el('#bench-fill').style.width = `${Math.round(p.fraction * 100)}%`;
    el('#bench-meta').textContent = `${t('bench.step', { n: p.step, total: p.steps })} · ${t('bench.remaining', { time: mmss(p.remaining) })}${p.fps > 0 ? ` · ${t('bench.fps', { fps: Math.round(p.fps) })}` : ''}`;
  }

  hideRunning(): void {
    this.live.hidden = true;
  }

  // ---------- resultado ----------

  /** Mostra o resultado de número `index` do histórico (0 = o mais novo) e compara com o anterior a ele. */
  showResult(history: BenchReport[], index = 0, after = false): void {
    this.history = history;
    this.index = Math.min(index, history.length - 1);
    this.after = after;
    this.live.hidden = true;
    this.choose.hidden = true;
    this.result.hidden = false;
    this.render();
  }

  get open(): boolean {
    return !this.result.hidden || !this.choose.hidden;
  }

  /** Fecha a tela aberta, como o botão de fechar (Esc). */
  dismiss(): void {
    if (!this.choose.hidden) {
      this.choose.hidden = true;
      this.onClose?.(false);
    } else if (!this.result.hidden) {
      this.result.hidden = true;
      this.onClose?.(this.after);
    }
  }

  private render(): void {
    const r = this.history[this.index];
    if (!r) {
      this.result.innerHTML = `<div class="bench-card-wrap"><h2>${t('bench.result.title')}</h2><p>${t('bench.none.result')}</p><div class="bench-actions"><button class="cta" id="br-close" type="button">${t('bench.close')}</button></div></div>`;
      el('#br-close').addEventListener('click', () => this.dismiss());
      return;
    }
    const prev = this.history[this.index + 1] ?? null;
    this.text = reportText(r, tr);
    this.result.innerHTML = this.html(r, prev);
    this.wire(r);
    this.result.scrollTop = 0;
    this.drawCharts(r);
    el<HTMLButtonElement>('#br-close').focus({ preventScroll: true });
  }

  private wire(r: BenchReport): void {
    el('#br-close').addEventListener('click', () => this.dismiss());
    el('#br-copy').addEventListener('click', () => void this.copy());
    el('#br-json').addEventListener('click', () => this.download(r));
    el<HTMLSelectElement>('#br-history').addEventListener('change', (e) => {
      this.index = Number((e.target as HTMLSelectElement).value);
      this.render();
    });
    el<HTMLSelectElement>('#br-scenario').addEventListener('change', (e) => this.pickScenario(r, (e.target as HTMLSelectElement).value));
    window.setTimeout(() => this.drawCharts(r), 0);
  }

  private drawCharts(r: BenchReport): void {
    const targets = BENCH_TARGETS;
    const runs: ChartRun[] = r.scenarios.map((s) => ({ label: s.id, series: s.series }));
    const c1 = this.result.querySelector<HTMLCanvasElement>('#br-chart');
    if (c1) drawChart(c1, runs, { targets });
    const c2 = this.result.querySelector<HTMLCanvasElement>('#br-thermal-chart');
    if (c2 && r.thermal) drawChart(c2, [{ label: 'thermal', series: r.thermal.series }], { targets });
  }

  private download(r: BenchReport): void {
    const blob = new Blob([exportJson(r)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = exportName(r);
    a.hidden = true;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
    const b = el('#br-json');
    b.textContent = t('bench.exported');
    window.setTimeout(() => (b.textContent = t('bench.exportJson')), 1600);
  }

  private async copy(): Promise<void> {
    const b = el('#br-copy');
    try {
      await navigator.clipboard.writeText(this.text);
    } catch {
      // sem permissão da área de transferência: seleciona o texto numa caixa para copiar à mão
      const ta = document.createElement('textarea');
      ta.value = this.text;
      ta.className = 'bench-copybox';
      this.result.querySelector('.bench-card-wrap')?.appendChild(ta);
      ta.select();
      document.execCommand?.('copy');
    }
    b.textContent = t('bench.copied');
    window.setTimeout(() => (b.textContent = t('bench.copy')), 1600);
  }

  // ---------- cenário escolhido: subsistemas, cena, chunks ----------

  private pickScenario(r: BenchReport, id: string): void {
    const box = el('#br-scenario-body');
    box.innerHTML = this.scenarioBody(r, id);
  }

  private scenarioBody(r: BenchReport, id: string): string {
    const sc = id === 'all' ? null : r.scenarios.find((s) => s.id === id) ?? null;
    const sum: Summary = sc ? sc.summary : r.overall;
    const subs = sum.subsystems.filter((s) => s.meanMs > 0 || s.maxMs > 0);
    const subTable = table(
      [t('bench.col.subsystem'), t('bench.col.mean'), t('bench.col.p95'), t('bench.col.max')],
      subs.map((s) => [esc(t(`bench.sub.${s.id}` as MessageKey)), num(s.meanMs, 2), num(s.p95Ms, 2), num(s.maxMs, 2)]),
    );
    const steps = row(t('bench.steps'), `${num(sum.steps.mean, 2)} · ${t('bench.max')} ${num(sum.steps.max, 0)}`) +
      row(t('bench.stepCap'), `${num(sum.steps.cappedFrames, 0)} (${num(sum.steps.cappedPct, 1)}%)`);
    const ck = sum.chunks;
    const chunks = (x: { count: number; avgMs: number; maxMs: number }): string => (x.count ? `${num(x.count, 0)} · ${num(x.avgMs, 2)} ms · ${t('bench.max')} ${num(x.maxMs, 1)} ms` : '—');
    const chunkRows =
      row(t('bench.chunksGen'), chunks(ck.gen)) + row(t('bench.chunksMesh'), chunks(ck.mesh)) + row(t('bench.chunksRemesh'), chunks(ck.remesh));
    let sceneRows = '';
    let longs: string;
    if (sc) {
      const s = sc.scene;
      const am = (g: { avg: number; max: number }, f: (n: number) => string = (n) => num(n, 0)): string => `${f(g.avg)} · ${f(g.max)}`;
      sceneRows =
        row(t('bench.scene.calls'), am(s.calls)) + row(t('bench.scene.triangles'), am(s.triangles, big)) + row(t('bench.scene.lines'), am(s.lines)) +
        row(t('bench.scene.points'), am(s.points)) + row(t('bench.scene.geometries'), am(s.geometries)) + row(t('bench.scene.textures'), am(s.textures)) +
        row(t('bench.scene.programs'), am(s.programs)) + row(t('bench.scene.objects'), am(s.objects)) + row(t('bench.scene.debris'), am(s.debris)) +
        row(t('bench.scene.particles'), am(s.particles)) + row(t('bench.scene.drops'), am(s.drops)) + row(t('bench.scene.loot'), am(s.loot)) +
        row(t('bench.scene.meteors'), am(s.meteors)) + row(t('bench.scene.chunks'), am(s.chunks)) + row(t('bench.scene.pixels'), am(s.pixels, big));
      const c = sc.creations;
      sceneRows += row(t('bench.creations'), `${num(c.geometries, 1)} / ${num(c.materials, 1)} / ${num(c.textures, 1)} / ${num(c.objects, 1)}`);
      const lt = sc.longTasks, lf = sc.longFrames;
      longs =
        row(t('bench.longTasks'), r.env.longTask ? `${lt.count} · ${num(lt.totalMs, 0)} ms · ${t('bench.max')} ${num(lt.maxMs, 0)} ms` : t('bench.na')) +
        row(t('bench.longFrames'), r.env.longAnimationFrame ? `${lf.count} · ${num(lf.totalMs, 0)} ms · ${t('bench.max')} ${num(lf.maxMs, 0)} ms${lf.worst[0]?.source ? ` · ${esc(lf.worst[0].source)}` : ''}` : t('bench.na'));
    } else {
      const lt = r.scenarios.reduce((n, s) => n + s.longTasks.count, 0);
      const lf = r.scenarios.reduce((n, s) => n + s.longFrames.count, 0);
      longs = row(t('bench.longTasks'), r.env.longTask ? String(lt) : t('bench.na')) + row(t('bench.longFrames'), r.env.longAnimationFrame ? String(lf) : t('bench.na'));
    }
    const gpu = row(t('bench.gpuTime'), sum.gpu ? `${num(sum.gpu.meanMs, 2)} ms · p95 ${num(sum.gpu.p95Ms, 2)} ms` : t('bench.na'));
    return `${subTable}<dl class="br-list">${steps}${gpu}${chunkRows}${sceneRows}${longs}</dl>`;
  }

  // ---------- montagem do resultado ----------

  private verdict(s: Summary, i: number, prev: Summary | null): string {
    const hz = BENCH_TARGETS[i];
    const f = s.targets[i];
    const p = prev?.targets[i];
    const cmp = (now: number, before: number | undefined, hi: boolean, d = 1): string =>
      before === undefined ? '' : ` ${chip(compareValue(now, before, hi), d)}`;
    return `<div class="bench-verdict ${f.sustains ? 'ok' : 'bad'}">
      <div class="bv-head"><span>${hz} Hz</span><strong>${t(f.sustains ? 'bench.sustains' : 'bench.notSustains')}</strong></div>
      <dl class="br-list">
        ${row(t('bench.l.fps'), `${num(s.stats.fpsEffective, 1)}${cmp(s.stats.fpsEffective, prev?.stats.fpsEffective, true)}`)}
        ${row(t('bench.l.presented'), `${num(s.fpsPresented, 1)}${cmp(s.fpsPresented, prev?.fpsPresented, true)}`)}
        ${row(t('bench.l.p99'), `${num(s.stats.p99Ms, 1)} ms ${t('bench.l.budget', { ms: num(1000 / hz, 1) })}${cmp(s.stats.p99Ms, prev?.stats.p99Ms, false)}`)}
        ${row(t('bench.l.lost'), `${num(f.lostPct, 1)}%${cmp(f.lostPct, p?.lostPct, false)}`)}
        ${row(t('bench.l.longest'), `${f.longestOff} ${t('bench.l.frames')}${cmp(f.longestOff, p?.longestOff, false, 0)}`)}
        ${row(t('bench.l.onTarget'), `${num(f.onTargetPct, 1)}%`)}
      </dl></div>`;
  }

  private html(r: BenchReport, prev: BenchReport | null): string {
    const o = r.overall;
    const g = r.graphics;
    const e = r.env;
    const warns: string[] = [];
    if (navigator.webdriver) warns.push(t('bench.warn.automated'));
    if (r.scale !== 1) warns.push(t('bench.warn.shortened', { scale: r.scale }));
    if (prev) {
      const diff = setupDiff(r, prev);
      if (diff.length) warns.push(t('bench.warn.setup', { what: diff.map((d) => t(`bench.diff.${d}` as MessageKey)).join(', ') }));
    }
    const note = prev ? '' : `<p class="bench-note">${t('bench.first')}</p>`;
    const hist = this.history
      .map((h, i) => `<option value="${i}"${i === this.index ? ' selected' : ''}>${esc(new Date(h.date).toLocaleString('pt-BR'))} · ${t(`bench.mode.${h.mode}` as MessageKey)} · ${h.refresh.hz} Hz · ${num(h.overall.stats.fpsEffective, 0)} FPS</option>`)
      .join('');

    const hz = r.refresh;
    const screenBlock = `<dl class="br-list">
      ${row(t('bench.l.refresh'), t('bench.refreshValue', { hz: hz.hz, raw: num(hz.rawHz, 1), budget: num(hz.budgetMs, 2) }))}
      ${row(t('bench.l.device'), esc(orNA(e.gl.renderer, tr)))}
      ${row(t('bench.l.vendor'), esc(orNA(e.gl.vendor, tr)))}
      ${row(t('bench.l.gl'), esc(`${e.gl.webgl2 ? 'WebGL 2' : 'WebGL 1'}${e.gl.version ? ` · ${e.gl.version}` : ''}`))}
      ${row(t('bench.l.timerQuery'), t(e.gl.timerQuery ? 'bench.yes' : 'bench.no'))}
      ${row(t('bench.l.extensions'), esc(e.gl.extensions.filter((x) => x.present).map((x) => x.name.replace(/^(EXT|OES|WEBGL)_/, '')).join(', ') || tr('bench.na')))}
      ${row(t('bench.l.maxTexture'), orNA(e.gl.maxTextureSize, tr))}
      ${row(t('bench.l.cores'), orNA(e.cores, tr))}
      ${row(t('bench.l.memory'), orNA(e.deviceMemoryGb, tr, (n) => `${n} GB`))}
      ${row(t('bench.l.screen'), e.screen ? `${e.screen.width} × ${e.screen.height} · ${t('bench.l.viewport')} ${e.viewport.width} × ${e.viewport.height} · ${num(e.devicePixelRatio, 2)}×` : t('bench.na'))}
      ${row(t('bench.l.orientation'), esc(orNA(e.orientation, tr)))}
      ${row(t('bench.l.battery'), e.battery ? `${Math.round(e.battery.level * 100)}% · ${t(e.battery.charging ? 'bench.charging' : 'bench.discharging')}` : t('bench.na'))}
      ${row(t('bench.l.userAgent'), esc(e.userAgent))}
      ${row(t('bench.l.quality'), `${esc(t(`quality.${g.quality}` as MessageKey))}${g.auto ? ` (${t('bench.auto')})` : ''} · ${num(g.pixelRatio, 2)}× · ${t('bench.l.shadow')} ${g.shadow} · MSAA ${g.samples} · ${t(g.bloom ? 'bench.bloomOn' : 'bench.bloomOff')}`)}
      ${row(t('bench.l.buffer'), `${g.buffer[0]} × ${g.buffer[1]} px · ${t('bench.l.css')} ${Math.round(g.css[0])} × ${Math.round(g.css[1])}`)}
    </dl>`;

    const histo = this.histogramHtml(o);
    const stats = `<dl class="br-list">
      ${row(t('bench.l.mean'), `${num(o.stats.meanMs, 2)} ms`)}${row(t('bench.l.median'), `${num(o.stats.medianMs, 2)} ms`)}
      ${row(t('bench.l.p95'), `${num(o.stats.p95Ms, 2)} ms`)}${row(t('bench.l.p99'), `${num(o.stats.p99Ms, 2)} ms`)}
      ${row(t('bench.l.p999'), `${num(o.stats.p999Ms, 2)} ms`)}${row(t('bench.l.std'), `${num(o.stats.stdMs, 2)} ms`)}
      ${row(t('bench.l.jitter'), `${num(o.stats.jitterMs, 2)} ms`)}
      ${row(t('bench.l.aligned'), `${num(o.pacing.alignedPct, 0)}%`)}
      ${row(t('bench.l.regular'), `${num(o.pacing.regularPct, 0)}% ${t('bench.l.inMultiple', { n: o.pacing.dominantMultiple })} · ${t(o.pacing.regular ? 'bench.regular' : 'bench.irregular')}`)}
      ${row(t('bench.l.framesCount'), `${num(o.frames, 0)} · ${num(o.seconds, 1)} s`)}
    </dl>`;

    const scenRows = r.scenarios.map((s: ScenarioResult) => {
      const ps = prev?.scenarios.find((x) => x.id === s.id);
      const fpsCell = `${num(s.summary.stats.fpsEffective, 1)}${ps ? ` ${chip(compareValue(s.summary.stats.fpsEffective, ps.summary.stats.fpsEffective, true), 1)}` : ''}`;
      return [esc(t(`bench.sc.${s.id}` as MessageKey)), fpsCell, num(s.summary.stats.p99Ms, 1), `${num(s.summary.targets[0].lostPct, 1)}%`, num(s.summary.cpu.meanMs, 1)];
    });
    const scenTable = table([t('bench.col.scenario'), t('bench.col.fps'), t('bench.col.p99'), t('bench.col.lost120'), t('bench.col.cpu')], scenRows);
    const scenOptions = `<option value="all">${t('bench.allScenarios')}</option>${r.scenarios.map((s) => `<option value="${s.id}">${esc(t(`bench.sc.${s.id}` as MessageKey))}</option>`).join('')}`;

    let effectsHtml = '';
    if (r.effects) {
      const src = r.effects.effects[0]?.costSource === 'gpu' ? t('bench.src.gpu') : t('bench.src.sync');
      effectsHtml = section(
        t('bench.effects'),
        `<p class="bench-note">${t('bench.effectsNote', { src })}</p>` +
          table(
            [t('bench.col.effect'), t('bench.col.inGame'), t('bench.col.cost'), t('bench.col.fpsOn'), t('bench.col.fpsOff')],
            r.effects.effects.map((x) => [esc(t(`bench.fx.${x.id}` as MessageKey)), t(x.activeInGame ? 'bench.yes' : 'bench.no'), `${x.costMs > 0 ? '+' : ''}${num(x.costMs, 2)} ms`, num(x.on.fps, 1), num(x.off.fps, 1)]),
          ),
      );
    }
    let resolutionHtml = '';
    if (r.resolution) {
      const mark = (ok: boolean): string => (ok ? '✓' : '✗');
      resolutionHtml = section(
        t('bench.resolution'),
        `<p class="bench-note">${t('bench.resolutionNote', { m120: r.resolution.max120 === null ? t('bench.none') : `${r.resolution.max120}×`, m60: r.resolution.max60 === null ? t('bench.none') : `${r.resolution.max60}×` })}</p>` +
          table(
            [t('bench.col.scale'), t('bench.col.pixels'), t('bench.col.fps'), t('bench.col.p99'), '120', '60'],
            r.resolution.points.map((p) => [
              `${p.scale}×`, `${p.width} × ${p.height}`, p.stat ? num(p.stat.fps, 1) : t('bench.unsupported'), p.stat ? num(p.stat.p99Ms, 1) : '—',
              p.skipped ? '—' : mark(p.sustains[0]), p.skipped ? '—' : mark(p.sustains[1]),
            ]),
          ),
      );
    }
    let thermalHtml = '';
    if (r.thermal) {
      thermalHtml = section(
        t('bench.thermal'),
        `<p class="${r.thermal.throttled ? 'bench-warn' : 'bench-note'}">${t(r.thermal.throttled ? 'bench.thermal.yes' : 'bench.thermal.no')} · ${t('bench.thermal.drop', { pct: num(r.thermal.dropPct * 100, 0) })}</p>` +
          `<canvas id="br-thermal-chart" class="bench-chart" aria-label="${t('bench.thermal')}"></canvas>` +
          table(
            [t('bench.col.minute'), t('bench.col.fps'), t('bench.col.mean'), t('bench.col.p99'), t('bench.col.cpu'), t('bench.l.battery')],
            r.thermal.minutes.map((m) => [String(m.minute), num(m.fps, 1), num(m.meanMs, 2), num(m.p99Ms, 1), num(m.cpuMs, 1), m.battery === null ? t('bench.na') : `${Math.round(m.battery * 100)}%`]),
          ),
      );
    }

    const m = r.memory;
    const inputRows = `<dl class="br-list">
      ${row(t('bench.touch'), r.input.touch ? `${num(r.input.touch.meanMs, 1)} ms · p95 ${num(r.input.touch.p95Ms, 1)} ms · ${r.input.touch.count} ${t('bench.touches')}` : r.input.fallback ? `${num(r.input.fallback.meanMs, 1)} ms · ${r.input.fallback.count} ${t('bench.touches')} (${t('bench.touchFallback')})` : t('bench.na'))}
      ${row(t('bench.heap'), m.heapStartMb === null ? t('bench.na') : `${num(m.heapStartMb, 1)} → ${num(m.heapEndMb ?? 0, 1)} MB`)}
      ${row(t('bench.save'), orNA(m.saveBytes, tr, (n) => `${num(n / 1024, 1)} KB`))}
      ${row(t('bench.resources'), m.resourceCount === null ? t('bench.na') : `${m.resourceCount} · ${num((m.resourceBytes ?? 0) / 1024, 0)} KB`)}
      ${row(t('bench.energy'), r.battery ? `${Math.round(r.battery.start * 100)}% → ${Math.round(r.battery.end * 100)}%${r.battery.perMinute === null ? '' : ` · ${num(r.battery.perMinute, 2)} %/min`}${r.battery.charging ? ` · ${t('bench.charging')}` : ''}` : t('bench.na'))}
    </dl>`;

    let compareHtml = '';
    if (prev) {
      const rows = compareReports(r, prev);
      compareHtml = section(
        t('bench.compare'),
        `<p class="bench-note">${t('bench.compareNote', { date: new Date(prev.date).toLocaleString('pt-BR') })}</p>` +
          table([t('bench.col.metric'), t('bench.col.now'), t('bench.col.before'), ''], rows.map((x) => compareRow(x))),
      );
    }

    const finds = r.findings.map((f) => `<li class="bf-${f.level}">${esc(findingText(f, tr))}</li>`).join('');

    return `<div class="bench-card-wrap">
      <div class="bench-head"><h2 id="bench-result-title">${t('bench.result.title')}</h2><span class="bench-date">${esc(new Date(r.date).toLocaleString('pt-BR'))} · ${t(`bench.mode.${r.mode}` as MessageKey)} · v${esc(r.gameVersion)}</span></div>
      <label class="bench-pick"><span>${t('bench.history')}</span><select id="br-history">${hist}</select></label>
      ${warns.map((w) => `<p class="bench-warn">${esc(w)}</p>`).join('')}${note}
      <div class="bench-verdicts">${BENCH_TARGETS.map((_, i) => this.verdict(o, i, prev?.overall ?? null)).join('')}</div>
      ${section(t('bench.chart'), `<canvas id="br-chart" class="bench-chart" aria-label="${t('bench.chart')}"></canvas><p class="bench-note">${t('bench.chartNote')}</p>`)}
      ${section(t('bench.fluidity'), stats)}
      ${section(t('bench.histogram'), histo)}
      ${section(t('bench.scenarios'), scenTable)}
      ${section(t('bench.detail'), `<label class="bench-pick"><span>${t('bench.scenario')}</span><select id="br-scenario">${scenOptions}</select></label><div id="br-scenario-body">${this.scenarioBody(r, 'all')}</div>`)}
      ${effectsHtml}${resolutionHtml}${thermalHtml}
      ${section(t('bench.inputMemory'), inputRows)}
      ${compareHtml}
      ${section(t('bench.conclusions'), `<ul class="bench-finds">${finds}</ul>`)}
      ${section(t('bench.deviceScreen'), screenBlock)}
      <div class="bench-actions">
        <button class="cta" id="br-json" type="button">${t('bench.exportJson')}</button>
        <button class="ghost-btn" id="br-copy" type="button">${t('bench.copy')}</button>
        <button class="ghost-btn" id="br-close" type="button">${this.after ? t('bench.back.game') : t('bench.close')}</button>
      </div>
      ${this.after ? `<p class="bench-note">${t('bench.reloading')}</p>` : ''}
    </div>`;
  }

  private histogramHtml(o: Summary): string {
    const total = o.histogram.reduce((a, b) => a + b, 0) || 1;
    const labels = histogramLabels(HISTOGRAM_EDGES);
    const max = Math.max(...o.histogram, 1);
    return `<div class="bench-histo">${o.histogram
      .map((n, i) => `<div class="bh-row"><span>${esc(labels[i])}</span><i style="width:${Math.round((n / max) * 100)}%"></i><em>${num((100 * n) / total, 1)}%</em></div>`)
      .join('')}</div>`;
  }
}

/** diferença entre dois valores no formato de `chip` (a tolerância de "igual" é de 2%) */
function compareValue(now: number, before: number, higherIsBetter: boolean): Comparison {
  const diff = now - before;
  const pct = before !== 0 ? diff / Math.abs(before) : null;
  const small = pct !== null ? Math.abs(pct) < 0.02 : diff === 0;
  const verdict = small ? 'same' : diff > 0 === higherIsBetter ? 'better' : 'worse';
  return { diff, pct, verdict };
}

function compareRow(x: CompareRow): string[] {
  const d = x.key === 'lost120' || x.key === 'longest' ? 1 : 2;
  const unit = x.key === 'fps' || x.key === 'presented' ? '' : x.key === 'lost120' ? '%' : x.key === 'longest' ? '' : ' ms';
  return [esc(t(`bench.cmp.${x.key}` as MessageKey)), `${num(x.now, d)}${unit}`, `${num(x.before, d)}${unit}`, chip(x.cmp, d)];
}
