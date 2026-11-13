// Estatísticas dos tempos de quadro, para o medidor de FPS (ui/FpsMeter.ts). Guarda os últimos quadros num anel e resume
// janelas de tempo: FPS e tempo médio (última 1 s), o "1% low" e o pior quadro (últimos 5 s). O 1% low é o FPS dos piores 1%
// dos quadros: mostra a instabilidade que a média esconde (é o número que o MSI Afterburner e o RTSS mostram).

/** quadros guardados (a 120 Hz, 5 s são 600) */
const CAPACITY = 640;
/** um tempo de quadro maior que isto é pausa ou aba escondida: não entra */
const MAX_MS = 1000;

export interface FrameSummary {
  /** quadros por segundo na janela curta */
  fps: number;
  /** tempo médio de um quadro na janela curta (ms) */
  avgMs: number;
  /** FPS dos piores 1% dos quadros da janela longa */
  low1Fps: number;
  /** pior quadro da janela longa (ms) */
  maxMs: number;
  /** tempo médio que o jogo gastou por quadro na janela curta (ms; 0 se ninguém informou) */
  cpuMs: number;
  /** quantos quadros há na janela longa */
  frames: number;
}

export class FrameStats {
  private readonly period = new Float32Array(CAPACITY);
  private readonly cpu = new Float32Array(CAPACITY);
  private head = 0;
  private count = 0;

  /** Um quadro desenhado, `periodMs` depois do anterior. */
  push(periodMs: number): void {
    if (!(periodMs > 0) || periodMs > MAX_MS) return;
    this.head = (this.head + 1) % CAPACITY;
    this.period[this.head] = periodMs;
    this.cpu[this.head] = 0;
    if (this.count < CAPACITY) this.count++;
  }

  /** Quanto o jogo gastou de CPU no quadro que acabou de ser registrado. */
  setCpu(ms: number): void {
    if (this.count > 0) this.cpu[this.head] = ms;
  }

  clear(): void {
    this.count = 0;
  }

  /** os últimos `n` tempos de quadro, do mais antigo ao mais novo (para o gráfico) */
  recent(n: number, out: number[] = []): number[] {
    out.length = 0;
    const k = Math.min(n, this.count);
    for (let i = k - 1; i >= 0; i--) out.push(this.period[(this.head - i + CAPACITY) % CAPACITY]);
    return out;
  }

  summary(shortMs = 1000, longMs = 5000): FrameSummary {
    let sumShort = 0, nShort = 0, cpuShort = 0, sumLong = 0, nLong = 0, maxMs = 0;
    const longPeriods: number[] = [];
    for (let i = 0; i < this.count; i++) {
      const idx = (this.head - i + CAPACITY) % CAPACITY;
      const p = this.period[idx];
      if (sumLong + p > longMs && nLong > 0) break;
      sumLong += p;
      nLong++;
      longPeriods.push(p);
      if (p > maxMs) maxMs = p;
      if (sumShort + p <= shortMs || nShort === 0) {
        sumShort += p;
        cpuShort += this.cpu[idx];
        nShort++;
      }
    }
    if (nShort === 0) return { fps: 0, avgMs: 0, low1Fps: 0, maxMs: 0, cpuMs: 0, frames: 0 };
    const avgMs = sumShort / nShort;
    // piores 1% (pelo menos 1 quadro): a média deles dá o 1% low
    longPeriods.sort((a, b) => b - a);
    const worst = Math.max(1, Math.ceil(nLong * 0.01));
    let w = 0;
    for (let i = 0; i < worst; i++) w += longPeriods[i];
    return { fps: 1000 / avgMs, avgMs, low1Fps: 1000 / (w / worst), maxMs, cpuMs: cpuShort / nShort, frames: nLong };
  }
}
