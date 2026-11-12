// Gráfico do tempo de cada quadro ao longo do teste, desenhado num canvas 2D (sem biblioteca). A linha cheia é a média de
// cada trecho de 250 ms, a fina é o pior quadro do trecho; as linhas tracejadas marcam o orçamento de 120 e de 60 FPS.
import type { SeriesData } from './report';

export interface ChartRun {
  label: string;
  series: SeriesData;
}

export interface ChartOptions {
  /** taxas de referência (Hz) para as linhas tracejadas */
  targets: readonly number[];
  /** teto do eixo vertical (ms); padrão: o pior trecho, entre 20 e 60 ms */
  maxMs?: number;
}

export interface ChartLayout {
  /** fim de cada trecho no eixo horizontal (0..1) */
  bounds: number[];
  maxMs: number;
}

/** Calcula, sem desenhar, a escala do gráfico (testável). */
export function layoutChart(runs: readonly ChartRun[], opts: ChartOptions): ChartLayout {
  let total = 0;
  let top = 0;
  const lengths = runs.map((r) => r.series.avg.length * r.series.bucketMs);
  for (const r of runs) {
    total += r.series.avg.length * r.series.bucketMs;
    for (const v of r.series.max) if (v > top) top = v;
  }
  let acc = 0;
  const bounds = lengths.map((l) => {
    acc += l;
    return total > 0 ? acc / total : 0;
  });
  const budget60 = 1000 / Math.min(...opts.targets, 60);
  const maxMs = opts.maxMs ?? Math.min(60, Math.max(budget60 * 1.5, Math.ceil(top / 5) * 5));
  return { bounds, maxMs };
}

function css(name: string, fallback: string): string {
  try {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  } catch {
    return fallback;
  }
}

/** Desenha o gráfico no canvas (na resolução da tela do aparelho, nítido em celular). */
export function drawChart(canvas: HTMLCanvasElement, runs: readonly ChartRun[], opts: ChartOptions): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 300;
  const cssH = canvas.clientHeight || 160;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const ink = css('--ink-dim', '#9aa0b8');
  const ice = css('--ice', '#7fe7ff');
  const warn = css('--warn', '#ff9a85');
  const line = css('--line', 'rgba(255,255,255,0.14)');

  const padL = 30, padR = 6, padT = 8, padB = 16;
  const w = cssW - padL - padR, h = cssH - padT - padB;
  const { bounds, maxMs } = layoutChart(runs, opts);
  ctx.clearRect(0, 0, cssW, cssH);
  ctx.font = '10px system-ui, sans-serif';
  const y = (ms: number): number => padT + h - (Math.min(ms, maxMs) / maxMs) * h;

  // faixas alternadas por cenário
  let prev = 0;
  runs.forEach((_, i) => {
    const x0 = padL + prev * w, x1 = padL + bounds[i] * w;
    if (i % 2 === 1) {
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      ctx.fillRect(x0, padT, x1 - x0, h);
    }
    prev = bounds[i];
  });

  // eixo e linhas de orçamento
  ctx.strokeStyle = line;
  ctx.lineWidth = 1;
  ctx.fillStyle = ink;
  ctx.textAlign = 'right';
  ctx.beginPath();
  ctx.moveTo(padL, padT);
  ctx.lineTo(padL, padT + h);
  ctx.lineTo(padL + w, padT + h);
  ctx.stroke();
  ctx.fillText('0', padL - 4, padT + h + 3);
  ctx.fillText(String(Math.round(maxMs)), padL - 4, padT + 8);
  ctx.setLineDash([4, 3]);
  for (const hz of opts.targets) {
    const ms = 1000 / hz;
    if (ms > maxMs) continue;
    ctx.strokeStyle = hz >= 100 ? ice : warn;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.moveTo(padL, y(ms));
    ctx.lineTo(padL + w, y(ms));
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = hz >= 100 ? ice : warn;
    ctx.fillText(`${hz}`, padL - 4, y(ms) + 3);
  }
  ctx.setLineDash([]);

  // as séries: pior quadro (fino) e média (cheio)
  const total = runs.reduce((a, r) => a + r.series.avg.length, 0);
  if (total === 0) return;
  const plot = (pick: (r: ChartRun) => number[], width: number, color: string, alpha: number): void => {
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    let start = 0;
    runs.forEach((r, i) => {
      const vals = pick(r);
      const x0 = padL + start * w, x1 = padL + bounds[i] * w;
      ctx.beginPath();
      vals.forEach((v, k) => {
        const x = x0 + (vals.length > 1 ? (k / (vals.length - 1)) * (x1 - x0) : 0);
        if (k === 0) ctx.moveTo(x, y(v));
        else ctx.lineTo(x, y(v));
      });
      ctx.stroke();
      start = bounds[i];
    });
    ctx.globalAlpha = 1;
  };
  plot((r) => r.series.max, 1, warn, 0.55);
  plot((r) => r.series.avg, 1.6, ice, 1);
}
