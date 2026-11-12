// Observadores do navegador usados pelo teste: tarefas longas, quadros longos (long-animation-frame, com a origem
// provável) e latência de toque (Event Timing). Cada um só liga se o navegador oferece o tipo; o que não existe
// aparece como "não disponível" no resultado. Nada disso roda fora do teste.

export interface LongEntry {
  /** início, em ms desde o começo do teste */
  at: number;
  /** duração (ms) */
  ms: number;
  /** origem provável (script, função); vazio se o navegador não diz */
  source: string;
}

export interface ObserverSupport {
  longtask: boolean;
  loaf: boolean;
  event: boolean;
}

/** Resumo de uma lista de eventos longos. */
export interface LongSummary {
  count: number;
  totalMs: number;
  maxMs: number;
  /** as maiores ocorrências (com origem) */
  worst: LongEntry[];
}

export function summarizeLong(list: readonly LongEntry[], top = 5): LongSummary {
  let total = 0;
  let max = 0;
  for (const e of list) {
    total += e.ms;
    if (e.ms > max) max = e.ms;
  }
  const worst = [...list].sort((a, b) => b.ms - a.ms).slice(0, top);
  return { count: list.length, totalMs: total, maxMs: max, worst };
}

/** Texto curto da origem de um quadro longo (long-animation-frame traz `scripts` com nome do script e da função). */
export function describeScripts(scripts: unknown): string {
  if (!Array.isArray(scripts) || scripts.length === 0) return '';
  let best: { dur: number; text: string } | null = null;
  for (const s of scripts as Array<Record<string, unknown>>) {
    const dur = typeof s.duration === 'number' ? s.duration : 0;
    const fn = typeof s.sourceFunctionName === 'string' && s.sourceFunctionName ? s.sourceFunctionName : '';
    const url = typeof s.sourceURL === 'string' && s.sourceURL ? s.sourceURL.split('/').pop() ?? '' : '';
    const kind = typeof s.invokerType === 'string' ? s.invokerType : '';
    const text = [fn, url, kind].filter(Boolean).join(' · ');
    if (text && (!best || dur > best.dur)) best = { dur, text };
  }
  return best ? best.text : '';
}

export class Observers {
  readonly support: ObserverSupport = { longtask: false, loaf: false, event: false };
  readonly longTasks: LongEntry[] = [];
  readonly longFrames: LongEntry[] = [];
  /** latência de toque até o primeiro quadro desenhado (ms), pelo Event Timing */
  readonly touchLatency: number[] = [];
  /** atraso do toque até o jogo começar a tratá-lo (ms) */
  readonly touchDelay: number[] = [];
  /** o mesmo, medido por pointerdown → próximo quadro, quando o Event Timing não existe */
  readonly touchFallback: number[] = [];

  private obs: PerformanceObserver[] = [];
  private t0 = 0;
  private downAt = -1;
  private raf = 0;
  private readonly onDown = (e: Event): void => {
    this.downAt = e.timeStamp || performance.now();
    if (!this.raf) {
      this.raf = requestAnimationFrame(() => {
        this.raf = 0;
        if (this.downAt >= 0) this.touchFallback.push(performance.now() - this.downAt);
        this.downAt = -1;
      });
    }
  };

  start(): void {
    this.t0 = performance.now();
    const supported = typeof PerformanceObserver !== 'undefined' ? (PerformanceObserver.supportedEntryTypes ?? []) : [];
    this.watch('longtask', supported, (e) => {
      this.longTasks.push({ at: e.startTime - this.t0, ms: e.duration, source: '' });
    });
    this.watch('long-animation-frame', supported, (e) => {
      const scripts = (e as unknown as { scripts?: unknown }).scripts;
      this.longFrames.push({ at: e.startTime - this.t0, ms: e.duration, source: describeScripts(scripts) });
    });
    this.watch(
      'event',
      supported,
      (e) => {
        if (e.name !== 'pointerdown' && e.name !== 'touchstart' && e.name !== 'mousedown') return;
        const ev = e as PerformanceEntry & { processingStart?: number };
        this.touchLatency.push(e.duration);
        if (typeof ev.processingStart === 'number') this.touchDelay.push(ev.processingStart - e.startTime);
      },
      { durationThreshold: 16 },
    );
    window.addEventListener('pointerdown', this.onDown, { passive: true, capture: true });
  }

  private watch(
    type: 'longtask' | 'long-animation-frame' | 'event',
    supported: readonly string[],
    on: (e: PerformanceEntry) => void,
    extra: Record<string, unknown> = {},
  ): void {
    if (!supported.includes(type)) return;
    try {
      const o = new PerformanceObserver((list) => list.getEntries().forEach(on));
      o.observe({ type, buffered: false, ...extra } as PerformanceObserverInit);
      this.obs.push(o);
      if (type === 'longtask') this.support.longtask = true;
      else if (type === 'long-animation-frame') this.support.loaf = true;
      else this.support.event = true;
    } catch {
      // o navegador listou o tipo mas recusou: fica como "não disponível"
    }
  }

  /** Para de observar (pega o que o navegador ainda não entregou). */
  stop(): void {
    for (const o of this.obs) {
      try {
        o.disconnect();
      } catch {
        // ignora
      }
    }
    this.obs = [];
    window.removeEventListener('pointerdown', this.onDown, { capture: true });
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }
}
