// Medidor de desempenho no canto da tela (ajuste "Medidor de desempenho"), no estilo do MSI Afterburner / RTSS: FPS, tempo do quadro,
// 1% low (o FPS dos piores 1% dos quadros, o número que mostra a instabilidade), pior quadro, CPU do jogo, resolução da
// resolução dinâmica e um gráfico dos últimos tempos de quadro (verde = no ritmo, amarelo = lento, vermelho = travada).
// Só trabalha enquanto está visível. As contas ficam em core/framestats.ts.
import { FrameStats, type FrameSummary } from '../core/framestats';
import { maybeEl } from './dom';

const GRAPH_FRAMES = 90;
const GRAPH_W = 130;
const GRAPH_H = 28;
/** o texto atualiza 4 vezes por segundo (legível); o gráfico, 10 */
const TEXT_EVERY_MS = 250;
const GRAPH_EVERY_MS = 100;

const GOOD = '#7dff9a';
const WARN = '#ffd24a';
const BAD = '#ff6a5a';

const ROWS = [
  ['fps', 'FPS'], ['ms', 'Quadro'], ['low', '1% low'], ['max', 'Pior'], ['cpu', 'CPU'], ['res', 'Res'],
] as const;
type RowId = (typeof ROWS)[number][0];

export class FpsMeter {
  private visible = false;
  private readonly stats = new FrameStats();
  private last = 0;
  private textAt = 0;
  private graphAt = 0;
  private budgetMs = 1000 / 60;
  private scale = 1;
  private readonly box = maybeEl('#fps-meter');
  private readonly values = new Map<RowId, HTMLElement>();
  private ctx: CanvasRenderingContext2D | null = null;
  private readonly recent: number[] = [];

  constructor() {
    if (!this.box) return;
    for (const [id, label] of ROWS) {
      const row = document.createElement('div');
      row.className = 'fps-row';
      const l = document.createElement('span');
      l.textContent = label;
      const v = document.createElement('b');
      v.textContent = '--';
      row.append(l, v);
      this.box.append(row);
      this.values.set(id, v);
    }
    const canvas = document.createElement('canvas');
    canvas.width = GRAPH_W;
    canvas.height = GRAPH_H;
    canvas.className = 'fps-graph';
    this.box.append(canvas);
    this.ctx = canvas.getContext('2d');
  }

  setVisible(on: boolean): void {
    this.visible = on;
    if (this.box) this.box.hidden = !on;
    this.stats.clear();
    this.last = 0;
    this.textAt = this.graphAt = 0;
  }

  /** chamar uma vez por quadro desenhado, com o instante do requestAnimationFrame */
  frame(now: number): void {
    if (!this.visible || !this.box) return;
    if (this.last > 0) this.stats.push(now - this.last);
    this.last = now;
    if (now - this.textAt >= TEXT_EVERY_MS) {
      this.textAt = now;
      this.writeText(this.stats.summary());
    }
    if (now - this.graphAt >= GRAPH_EVERY_MS) {
      this.graphAt = now;
      this.drawGraph();
    }
  }

  /** no fim do quadro: quanto o jogo gastou (ms), o tempo de um quadro no limite (ms) e a escala da resolução (0 a 1) */
  endFrame(cpuMs: number, budgetMs: number, scale: number): void {
    if (!this.visible) return;
    this.stats.setCpu(cpuMs);
    this.budgetMs = budgetMs;
    this.scale = scale;
  }

  private set(id: RowId, text: string, color?: string): void {
    const v = this.values.get(id);
    if (!v) return;
    v.textContent = text;
    v.style.color = color ?? '';
  }

  private writeText(s: FrameSummary): void {
    if (s.frames === 0) return;
    const target = 1000 / this.budgetMs;
    const tone = (fps: number): string => (fps >= target * 0.93 ? GOOD : fps >= target * 0.7 ? WARN : BAD);
    this.set('fps', String(Math.round(s.fps)), tone(s.fps));
    this.set('ms', `${s.avgMs.toFixed(1)} ms`);
    this.set('low', String(Math.round(s.low1Fps)), tone(s.low1Fps));
    this.set('max', `${s.maxMs.toFixed(1)} ms`, s.maxMs > this.budgetMs * 3 ? BAD : s.maxMs > this.budgetMs * 1.8 ? WARN : undefined);
    this.set('cpu', s.cpuMs > 0 ? `${s.cpuMs.toFixed(1)} ms` : '--');
    this.set('res', `${Math.round(this.scale * 100)}%`);
  }

  private drawGraph(): void {
    const g = this.ctx;
    if (!g) return;
    g.clearRect(0, 0, GRAPH_W, GRAPH_H);
    const ceiling = this.budgetMs * 3; // o topo do gráfico = 3 quadros de orçamento
    const frames = this.stats.recent(GRAPH_FRAMES, this.recent);
    const bar = GRAPH_W / GRAPH_FRAMES;
    for (let i = 0; i < frames.length; i++) {
      const ms = frames[i];
      const h = Math.max(1, Math.min(1, ms / ceiling) * GRAPH_H);
      g.fillStyle = ms <= this.budgetMs * 1.15 ? GOOD : ms <= this.budgetMs * 2 ? WARN : BAD;
      g.fillRect(GRAPH_W - (frames.length - i) * bar, GRAPH_H - h, Math.max(1, bar - 0.5), h);
    }
    // a linha do orçamento (o tempo de um quadro no ritmo pedido)
    g.fillStyle = 'rgba(255,255,255,0.45)';
    g.fillRect(0, GRAPH_H - GRAPH_H / 3, GRAPH_W, 1);
  }
}
