// Telas do teste de desempenho (docs/design/DESEMPENHO.md): o acompanhamento enquanto roda e a tela de resultado,
// com a comparação contra o resultado anterior. Quem decide quando mostrar é o Game.
import type { BenchProgress } from '../app/Benchmark';
import { BENCH_PHASES } from '../data/benchmark';
import { compare, sameSetup, type Avg, type BenchResult, type Timing, type Verdict } from '../core/benchStats';
import type { BenchStore } from '../core/benchStore';
import { t, type MessageKey } from '../i18n';
import { el } from './dom';

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
const num = (v: number, d = 0): string => v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
/** 1 234 567 → "1,23 M"; para os triângulos */
const big = (v: number): string => (v >= 1e6 ? `${num(v / 1e6, 2)} M` : v >= 1e4 ? `${num(v / 1e3, 1)} mil` : num(v));
const phaseName = (id: string): string => t(`bench.phase.${id}` as MessageKey);

/** como mostrar a diferença para o resultado anterior */
function chip(c: { diff: number; pct: number | null; verdict: Verdict }, digits = 1): string {
  if (c.verdict === 'same') return '<span class="bd same">≈ igual</span>';
  const arrow = c.diff > 0 ? '▲' : '▼';
  const pct = c.pct === null ? '' : ` (${c.pct > 0 ? '+' : ''}${num(c.pct * 100, 0)}%)`;
  return `<span class="bd ${c.verdict}">${arrow} ${c.diff > 0 ? '+' : ''}${num(c.diff, digits)}${pct}</span>`;
}

export class BenchmarkUi {
  /** o jogador cancelou durante o teste */
  onCancel: (() => void) | null = null;
  /** fechou a tela de resultado; `after` = acabou de rodar (o jogo recarrega), senão voltou ao menu de pausa */
  onClose: ((after: boolean) => void) | null = null;
  private readonly live = el('#bench');
  private readonly result = el('#bench-result');
  private text = '';
  /** a tela de resultado está aberta logo depois de rodar (o jogo recarrega ao fechar) */
  private after = false;

  constructor() {
    el('#bench-title').textContent = t('bench.title');
    el('#bench-cancel').textContent = t('bench.cancel');
    el('#bench-cancel').addEventListener('click', () => this.onCancel?.());
    // o toque na tela de acompanhamento não pode chegar ao jogo
    this.live.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  // ---------- enquanto roda ----------

  showRunning(): void {
    this.live.hidden = false;
    this.progress({ phase: BENCH_PHASES[0], fraction: 0, fps: 0 });
  }

  progress(p: BenchProgress): void {
    el('#bench-phase').textContent = phaseName(p.phase.id);
    el('#bench-fill').style.width = `${Math.round(p.fraction * 100)}%`;
    el('#bench-fps').textContent = p.fps > 0 ? t('bench.fps', { fps: Math.round(p.fps) }) : '';
  }

  hideRunning(): void {
    this.live.hidden = true;
  }

  // ---------- resultado ----------

  /** Mostra o último resultado (e compara com o anterior, se houver). */
  showResult(store: BenchStore, after: boolean): void {
    const r = store.last;
    this.after = after;
    this.live.hidden = true;
    this.result.hidden = false;
    if (!r) {
      this.result.innerHTML = `<div class="bench-card-wrap"><h2>${t('bench.result.title')}</h2><p>${t('bench.none')}</p><div class="bench-actions"><button class="cta" id="br-close" type="button">${t('bench.close')}</button></div></div>`;
      el('#br-close').addEventListener('click', () => this.close(after));
      return;
    }
    const prev = store.previous;
    this.text = reportText(r, prev);
    this.result.innerHTML = this.html(r, prev, after);
    el('#br-copy').addEventListener('click', () => void this.copy());
    el('#br-close').addEventListener('click', () => this.close(after));
    this.result.scrollTop = 0;
    el<HTMLButtonElement>('#br-close').focus({ preventScroll: true });
  }

  get open(): boolean {
    return !this.result.hidden;
  }

  /** Fecha a tela de resultado, como o botão de fechar (Esc). */
  dismiss(): void {
    if (this.open) this.close(this.after);
  }

  private close(after: boolean): void {
    this.result.hidden = true;
    this.onClose?.(after);
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

  private html(r: BenchResult, prev: BenchResult | null, after: boolean): string {
    const o = r.overall;
    const po = prev?.overall;
    const card = (label: MessageKey, value: string, unit: string, c?: { diff: number; pct: number | null; verdict: Verdict }, before?: string): string =>
      `<div class="bench-card"><span class="bc-label">${t(label)}</span><strong>${value}<small>${unit}</small></strong>${
        c ? `<span class="bc-cmp">${chip(c)}<em>${t('bench.before', { value: before ?? '' })}</em></span>` : ''
      }</div>`;
    const cards = [
      card('bench.card.avg', num(o.avgFps, 1), 'FPS', po && compare(o.avgFps, po.avgFps, true), po && num(po.avgFps, 1)),
      card('bench.card.min', num(o.minFps, 1), 'FPS', po && compare(o.minFps, po.minFps, true), po && num(po.minFps, 1)),
      card('bench.card.low1', num(o.low1Fps, 1), 'FPS', po && compare(o.low1Fps, po.low1Fps, true), po && num(po.low1Fps, 1)),
      card('bench.card.worst', num(o.maxMs, 0), 'ms', po && compare(o.maxMs, po.maxMs, false), po && num(po.maxMs, 0)),
    ].join('');

    const stages = r.phases
      .map((p) => {
        const pp = prev?.phases.find((x) => x.id === p.id);
        return `<tr><th>${esc(phaseName(p.id))}</th><td>${num(p.avgFps, 1)}${pp ? ` ${chip(compare(p.avgFps, pp.avgFps, true), 1)}` : ''}</td><td>${num(p.minFps, 1)}</td><td>${num(p.maxMs, 0)} ms</td></tr>`;
      })
      .join('');

    const row = (label: string, value: string, cmpHtml = ''): string => `<div class="br-row"><dt>${esc(label)}</dt><dd>${value}${cmpHtml}</dd></div>`;
    const timing = (x: Timing): string => t('bench.chunkValue', { n: num(x.count), avg: num(x.avgMs, 2), max: num(x.maxMs, 1) });
    const timingCmp = (x: Timing, y?: Timing): string => (y && y.count ? ` ${chip(compare(x.avgMs, y.avgMs, false), 2)}` : '');
    const avgmax = (a: Avg, d = 0, f: (v: number) => string = (v) => num(v, d)): string => `${f(a.avg)} · ${f(a.max)}`;
    const avgCmp = (a: Avg, b?: Avg, d = 0): string => (b ? ` ${chip(compare(a.avg, b.avg, false), d)}` : '');
    const sc = r.scene, ps = prev?.scene;
    const ck = r.chunks, pk = prev?.chunks;

    const g = r.graphics;
    const q = t(`quality.${g.quality}` as MessageKey);
    const gpu = r.device.gpu ?? '—';
    const mem = r.device.memoryGb ? ` · ${r.device.memoryGb} GB` : '';
    const warn = prev && !sameSetup(r, prev) ? `<p class="bench-warn">${t('bench.warnSetup')}</p>` : '';
    const first = !prev ? `<p class="bench-note">${t('bench.first')}</p>` : '';

    return `<div class="bench-card-wrap">
      <div class="bench-head"><h2 id="bench-result-title">${t('bench.result.title')}</h2><span class="bench-date">${esc(new Date(r.date).toLocaleString('pt-BR'))}</span></div>
      ${warn}${first}
      <div class="bench-cards">${cards}</div>

      <h3>${t('bench.stages')}</h3>
      <table class="bench-table"><thead><tr><th>${t('bench.col.stage')}</th><th>${t('bench.col.avg')}</th><th>${t('bench.col.min')}</th><th>${t('bench.col.worst')}</th></tr></thead><tbody>${stages}</tbody></table>

      <dl class="br-list">
        ${row(t('bench.frames'), `${num(o.frames)} · ${num(o.seconds, 1)} s`)}
        ${row(t('bench.percentiles'), `${num(o.avgMs, 1)} · ${num(o.p95Ms, 1)} · ${num(o.p99Ms, 1)} ms`)}
        ${row(t('bench.cpu'), `${num(o.cpuAvgMs, 1)} · ${num(o.cpuMaxMs, 1)} ms`, po ? ` ${chip(compare(o.cpuAvgMs, po.cpuAvgMs, false), 1)}` : '')}
        ${row(t('bench.hitches'), t('bench.hitchesValue', { a: o.over33, b: o.over50, c: o.over100 }))}
      </dl>

      <h3>${t('bench.worstList')}</h3>
      <ol class="br-worst">${r.worst.map((w) => `<li>${esc(t('bench.worstItem', { ms: num(w.ms, 0), phase: phaseName(w.phase), at: num(w.at, 1) }))}</li>`).join('')}</ol>

      <h3>${t('bench.chunks')}</h3>
      <dl class="br-list">
        ${row(t('bench.chunksGenerated'), timing(ck.generated), timingCmp(ck.generated, pk?.generated))}
        ${row(t('bench.chunksMeshed'), timing(ck.meshed), timingCmp(ck.meshed, pk?.meshed))}
        ${row(t('bench.chunksRemeshed'), timing(ck.remeshed), timingCmp(ck.remeshed, pk?.remeshed))}
        ${row(t('bench.chunksLoaded'), avgmax(ck.loaded))}
      </dl>

      <h3>${t('bench.scene')}</h3>
      <dl class="br-list">
        ${row(t('bench.calls'), avgmax(sc.calls), avgCmp(sc.calls, ps?.calls))}
        ${row(t('bench.triangles'), avgmax(sc.triangles, 0, big), ps ? ` ${chip(compare(sc.triangles.avg, ps.triangles.avg, false), 0)}` : '')}
        ${row(t('bench.objects'), avgmax(sc.objects), avgCmp(sc.objects, ps?.objects))}
        ${row(t('bench.debris'), avgmax(sc.debris))}
        ${row(t('bench.particles'), avgmax(sc.particles))}
        ${row(t('bench.drops'), avgmax(sc.drops))}
        ${row(t('bench.loot'), avgmax(sc.loot))}
        ${row(t('bench.meteors'), avgmax(sc.meteors, 1))}
      </dl>

      <h3>${t('bench.setup')}</h3>
      <dl class="br-list">
        ${row(t('bench.quality'), esc(g.auto ? t('bench.qualityAuto', { name: q }) : q))}
        ${row(t('bench.resolution'), esc(t('bench.resolutionValue', { w: num(g.buffer[0]), h: num(g.buffer[1]), cw: num(g.css[0]), ch: num(g.css[1]), dpr: num(g.dpr, 2) })))}
        ${row(t('bench.effects'), esc(t('bench.effectsValue', { shadow: g.shadow, samples: g.samples ? t('bench.msaaOn', { n: g.samples }) : t('bench.msaaOff'), bloom: g.bloom ? t('bench.bloomOn') : t('bench.bloomOff') })))}
        ${row(t('bench.sound'), t(r.muted ? 'pause.off' : 'pause.on'))}
        ${row(t('bench.device'), esc(t('bench.deviceValue', { gpu, cores: r.device.cores ?? '?', mem })))}
        ${row(t('bench.memory'), r.memory.startMb !== null && r.memory.endMb !== null ? `${num(r.memory.startMb, 0)} → ${num(r.memory.endMb, 0)} MB` : '—')}
        ${row(t('bench.version'), `${esc(r.gameVersion)} · ${r.scenario}`)}
        ${row(t('bench.duration'), `${num(r.seconds, 0)} s`)}
      </dl>

      ${after ? `<p class="bench-note">${t('bench.reloading')}</p>` : ''}
      <div class="bench-actions">
        <button class="ghost-btn" id="br-copy" type="button">${t('bench.copy')}</button>
        <button class="cta" id="br-close" type="button">${after ? t('bench.back') : t('bench.close')}</button>
      </div>
    </div>`;
  }
}

/** O resultado em texto simples, para colar numa conversa ou numa anotação e comparar depois. */
export function reportText(r: BenchResult, prev: BenchResult | null): string {
  const o = r.overall;
  const g = r.graphics;
  const L: string[] = [];
  L.push(`Spacing ${r.gameVersion} · teste de desempenho (cenário ${r.scenario}) · ${new Date(r.date).toLocaleString('pt-BR')}`);
  L.push(`Qualidade ${t(`quality.${g.quality}` as MessageKey)}${g.auto ? ' (automática)' : ''} · ${g.buffer[0]}×${g.buffer[1]} px · densidade ${num(g.dpr, 2)}× · som ${r.muted ? 'desligado' : 'ligado'}`);
  L.push(`Aparelho: ${r.device.gpu ?? '?'} · ${r.device.cores ?? '?'} núcleos`);
  const vs = (now: number, before: number | undefined, hi: boolean, d = 1): string => (before === undefined ? '' : ` (antes ${num(before, d)} ${chipText(compare(now, before, hi))})`);
  L.push('');
  L.push(`FPS médio ${num(o.avgFps, 1)}${vs(o.avgFps, prev?.overall.avgFps, true)}`);
  L.push(`FPS mínimo ${num(o.minFps, 1)}${vs(o.minFps, prev?.overall.minFps, true)}`);
  L.push(`FPS dos 1% piores ${num(o.low1Fps, 1)}${vs(o.low1Fps, prev?.overall.low1Fps, true)}`);
  L.push(`Pior quadro ${num(o.maxMs, 0)} ms${vs(o.maxMs, prev?.overall.maxMs, false, 0)}`);
  L.push(`Quadros acima de 33 ms: ${o.over33} · 50 ms: ${o.over50} · 100 ms: ${o.over100} · CPU por quadro ${num(o.cpuAvgMs, 1)} ms`);
  L.push('');
  for (const p of r.phases) L.push(`${phaseName(p.id)}: ${num(p.avgFps, 1)} FPS médio · mín. ${num(p.minFps, 1)} · pior ${num(p.maxMs, 0)} ms`);
  L.push('');
  const c = r.chunks;
  L.push(`Chunks gerados: ${c.generated.count} · ${num(c.generated.avgMs, 2)} ms cada · máx. ${num(c.generated.maxMs, 1)} ms`);
  L.push(`Malhas novas: ${c.meshed.count} · ${num(c.meshed.avgMs, 2)} ms · máx. ${num(c.meshed.maxMs, 1)} ms`);
  L.push(`Malhas refeitas: ${c.remeshed.count} · ${num(c.remeshed.avgMs, 2)} ms · máx. ${num(c.remeshed.maxMs, 1)} ms`);
  const s = r.scene;
  L.push(`Chamadas de desenho ${num(s.calls.avg)} (máx. ${num(s.calls.max)}) · triângulos ${big(s.triangles.avg)} (máx. ${big(s.triangles.max)}) · objetos ${num(s.objects.avg)}`);
  L.push(`Destroços máx. ${num(s.debris.max)} · partículas máx. ${num(s.particles.max)} · itens voando máx. ${num(s.drops.max)}`);
  return L.join('\n');
}

function chipText(c: { diff: number; verdict: Verdict }): string {
  return c.verdict === 'same' ? 'igual' : c.verdict === 'better' ? 'melhor' : 'pior';
}
