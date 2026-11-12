// Resumo do resultado em texto (para copiar e colar numa conversa) e arquivo JSON para exportar.
import { BENCH_TARGETS } from '../data/bench';
import type { MessageKey } from '../i18n';
import type { BenchReport, Finding, Summary } from './report';

export type Tr = (key: MessageKey, params?: Record<string, string | number>) => string;

export const num = (v: number, d = 1): string => v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
/** "não disponível" para o que o aparelho não informa */
export const orNA = (v: string | number | null | undefined, tr: Tr, fmt: (n: number) => string = (n) => num(n, 0)): string =>
  v === null || v === undefined || v === '' ? tr('bench.na') : typeof v === 'number' ? fmt(v) : v;

export function findingText(f: Finding, tr: Tr): string {
  return tr(`bench.find.${f.id}` as MessageKey, f.params);
}

/** uma linha por cenário e por taxa-alvo, no formato curto */
function fluidityLine(s: Summary, i: number, tr: Tr): string {
  const hz = BENCH_TARGETS[i];
  const f = s.targets[i];
  const budget = 1000 / hz;
  return tr('bench.txt.target', {
    hz,
    budget: num(budget, 1),
    fps: num(s.stats.fpsEffective, 1),
    presented: num(s.fpsPresented, 1),
    p99: num(s.stats.p99Ms, 1),
    lost: num(f.lostPct, 1),
    longest: f.longestOff,
    sustains: tr(f.sustains ? 'bench.yes' : 'bench.no'),
  });
}

export function reportText(r: BenchReport, tr: Tr): string {
  const o = r.overall;
  const g = r.graphics;
  const L: string[] = [];
  L.push(tr('bench.txt.head', { mode: tr(`bench.mode.${r.mode}` as MessageKey), version: r.gameVersion, bench: r.version, date: new Date(r.date).toLocaleString('pt-BR'), min: num(r.seconds / 60, 1) }));
  if (r.scale !== 1) L.push(tr('bench.txt.shortened', { scale: r.scale }));
  L.push(tr('bench.txt.screen', { hz: r.refresh.hz, raw: num(r.refresh.rawHz, 1), budget: num(r.refresh.budgetMs, 2), w: r.env.viewport.width, h: r.env.viewport.height, dpr: num(r.env.devicePixelRatio, 2) }));
  L.push(
    tr('bench.txt.device', {
      gpu: orNA(r.env.gl.renderer, tr),
      cores: orNA(r.env.cores, tr),
      mem: orNA(r.env.deviceMemoryGb, tr, (n) => `${n} GB`),
      gl: r.env.gl.webgl2 ? 'WebGL 2' : 'WebGL 1',
    }),
  );
  L.push(tr('bench.txt.quality', { quality: g.quality, auto: g.auto ? tr('bench.auto') : '', pr: num(g.pixelRatio, 2), shadow: g.shadow, msaa: g.samples, bloom: g.bloom ? tr('bench.on') : tr('bench.off'), bw: g.buffer[0], bh: g.buffer[1] }));
  L.push('');
  BENCH_TARGETS.forEach((_, i) => L.push(fluidityLine(o, i, tr)));
  L.push(
    tr('bench.txt.frame', {
      mean: num(o.stats.meanMs, 2), median: num(o.stats.medianMs, 2), p95: num(o.stats.p95Ms, 2), p99: num(o.stats.p99Ms, 2),
      p999: num(o.stats.p999Ms, 2), std: num(o.stats.stdMs, 2), jitter: num(o.stats.jitterMs, 2),
    }),
  );
  L.push(tr('bench.txt.pacing', { aligned: num(o.pacing.alignedPct, 0), regular: num(o.pacing.regularPct, 0), multiple: o.pacing.dominantMultiple, switches: num(o.pacing.switchMean, 2) }));
  L.push(tr('bench.txt.cpu', { mean: num(o.cpu.meanMs, 2), p95: num(o.cpu.p95Ms, 2), p99: num(o.cpu.p99Ms, 2), capped: o.steps.cappedFrames, cappedPct: num(o.steps.cappedPct, 1) }));
  L.push(tr('bench.txt.gpu', { gpu: o.gpu ? `${num(o.gpu.meanMs, 2)} ms (p95 ${num(o.gpu.p95Ms, 2)} ms)` : tr('bench.na') }));
  L.push('');
  L.push(tr('bench.txt.scenarios'));
  for (const s of r.scenarios) {
    L.push(
      tr('bench.txt.scenario', {
        name: tr(`bench.sc.${s.id}` as MessageKey), fps: num(s.summary.stats.fpsEffective, 1), p99: num(s.summary.stats.p99Ms, 1),
        lost120: num(s.summary.targets[0].lostPct, 1), cpu: num(s.summary.cpu.meanMs, 1),
      }),
    );
  }
  if (r.effects) {
    L.push('');
    L.push(tr('bench.txt.effects', { src: r.effects.effects[0]?.costSource === 'gpu' ? tr('bench.src.gpu') : tr('bench.src.sync') }));
    for (const e of r.effects.effects) {
      L.push(tr('bench.txt.effect', { name: tr(`bench.fx.${e.id}` as MessageKey), cost: num(e.costMs, 2), delta: num(e.fpsDelta, 1) }));
    }
  }
  if (r.resolution) {
    L.push('');
    L.push(tr('bench.txt.resolution', { m120: r.resolution.max120 === null ? tr('bench.none') : `${r.resolution.max120}×`, m60: r.resolution.max60 === null ? tr('bench.none') : `${r.resolution.max60}×` }));
    for (const p of r.resolution.points) {
      L.push(p.skipped ? tr('bench.txt.resSkipped', { scale: p.scale }) : tr('bench.txt.res', { scale: p.scale, fps: num(p.stat?.fps ?? 0, 1), p99: num(p.stat?.p99Ms ?? 0, 1) }));
    }
  }
  if (r.thermal) {
    L.push('');
    L.push(tr('bench.txt.thermal', { drop: num(r.thermal.dropPct * 100, 0), verdict: tr(r.thermal.throttled ? 'bench.thermal.yes' : 'bench.thermal.no') }));
    L.push(r.thermal.minutes.map((m) => `${m.minute}: ${num(m.fps, 0)} FPS`).join(' · '));
  }
  L.push('');
  L.push(tr('bench.txt.input', { touch: r.input.touch ? `${num(r.input.touch.meanMs, 1)} ms (${r.input.touch.count})` : r.input.fallback ? `${num(r.input.fallback.meanMs, 1)} ms (${r.input.fallback.count})` : tr('bench.na') }));
  L.push(tr('bench.txt.battery', { v: r.battery?.perMinute === null || !r.battery ? tr('bench.na') : `${num(r.battery.perMinute, 2)} %/min` }));
  L.push('');
  for (const f of r.findings) L.push(`• ${findingText(f, tr)}`);
  return L.join('\n');
}

/** nome do arquivo exportado: data, taxa da tela e modo */
export function exportName(r: BenchReport): string {
  const d = new Date(r.date);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `spacing-desempenho-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}-${r.refresh.hz}hz-${r.mode}.json`;
}

/** O resultado inteiro como JSON (o que a tela mostra e mais: as séries dos gráficos). */
export function exportJson(r: BenchReport): string {
  return JSON.stringify(r, null, 2);
}
