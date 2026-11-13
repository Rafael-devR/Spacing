// A câmara animada no meio da tela das estações (docs/design/ESTACOES.md): um canvas 2D pequeno, traço fino, uma cor por estação.
// Mostra o trabalho acontecendo com o estado de verdade: o fio tracejado corre com a energia que chega, o forno esquenta com o
// modelo de calor (thermal.ts), a bancada imprime a peça em camadas no ritmo do trabalho, o eletrolisador solta bolhas.
import type { StationData } from '../../data/stations';
import type { JobView } from '../../systems/Crafting';
import { css, heatColor, tempText, targetTemp, ThermalModel } from './thermal';

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  side?: number;
}

const LINE = 'rgba(120, 175, 195, 0.32)';
const DIM = 'rgba(120, 175, 195, 0.14)';
const MAX_SPARKS = 90;

const rnd = (a: number, b: number): number => a + Math.random() * (b - a);

export class StationCore {
  readonly thermal = new ThermalModel();
  private readonly g: CanvasRenderingContext2D;
  private st: StationData | null = null;
  private time = 0;
  private flow = 0;
  private sparks: Spark[] = [];
  private acc = 0;
  /** 0..1 suavizado: quanto a máquina trabalha agora (luz dos lasers, bolhas) */
  private work = 0;
  private w = 0;
  private h = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.g = canvas.getContext('2d') as CanvasRenderingContext2D;
  }

  setStation(st: StationData): void {
    this.st = st;
    this.sparks = [];
    this.thermal.temp = 22;
    this.thermal.fan = 0;
    this.work = 0;
  }

  get particleCount(): number {
    return this.sparks.length;
  }

  get cooling(): boolean {
    return this.st?.chamber === 'heat' && this.thermal.cooling;
  }

  /** leitura principal da câmara (texto ao lado do desenho) */
  reading(jobs: (JobView | null)[], speed: number): string {
    const st = this.st;
    if (!st) return '';
    if (st.chamber === 'heat') return tempText(this.thermal.temp);
    const run = jobs.find((j) => j && !j.ready && !j.paused && !j.leftover);
    if (st.chamber === 'laser' && run) return `${Math.round(run.progress * 100)}%`;
    return `${(st.kw * (run ? speed : 0)).toFixed(1)} kW`;
  }

  private fit(): boolean {
    const c = this.canvas;
    const w = c.clientWidth, h = c.clientHeight;
    if (w < 4 || h < 4) return false;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (w !== this.w || h !== this.h || c.width !== Math.round(w * dpr)) {
      this.w = w;
      this.h = h;
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return true;
  }

  frame(dt: number, jobs: (JobView | null)[], speed: number): void {
    const st = this.st;
    if (!st) return;
    this.time += dt;
    const running = jobs.filter((j): j is JobView => !!j && !j.ready && !j.paused && !j.leftover);
    const working = running.length > 0;
    this.work += ((working ? Math.max(0.15, speed) : 0) - this.work) * (1 - Math.exp(-dt * 4));
    this.flow += dt * this.work * 46;
    if (st.chamber === 'heat') this.thermal.update(dt, targetTemp(jobs, speed));
    if (!this.fit()) return;
    const g = this.g, w = this.w, h = this.h;
    g.clearRect(0, 0, w, h);
    const box = this.chamberBox();
    this.drawFlow(box);
    if (st.chamber === 'heat') this.drawHeat(dt, box);
    else if (st.chamber === 'laser') this.drawLaser(dt, box, running[0] ?? null);
    else this.drawCell(dt, box);
  }

  /** a caixa da câmara no meio do canvas */
  private chamberBox(): { x: number; y: number; w: number; h: number } {
    const bw = Math.min(this.w * 0.56, 170), bh = Math.min(this.h - 22, 120);
    return { x: (this.w - bw) / 2, y: (this.h - bh) / 2 + 4, w: bw, h: bh };
  }

  /** o fio que liga a entrada à câmara e a câmara à saída: tracejado que corre com a energia */
  private drawFlow(b: { x: number; y: number; w: number; h: number }): void {
    const g = this.g, y = Math.round(b.y + b.h / 2) + 0.5;
    g.lineWidth = 1;
    g.strokeStyle = DIM;
    g.setLineDash([]);
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(b.x, y);
    g.moveTo(b.x + b.w, y);
    g.lineTo(this.w, y);
    g.stroke();
    if (this.work > 0.02) {
      g.strokeStyle = this.st?.accent ?? '#fff';
      g.globalAlpha = Math.min(1, this.work * 1.2);
      g.setLineDash([4, 6]);
      g.lineDashOffset = -this.flow;
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(b.x, y);
      g.moveTo(b.x + b.w, y);
      g.lineTo(this.w, y);
      g.stroke();
      g.setLineDash([]);
      g.globalAlpha = 1;
    }
    // cantoneiras da câmara
    const L = 8;
    g.strokeStyle = LINE;
    g.beginPath();
    for (const [cx, cy, sx, sy] of [[b.x, b.y, 1, 1], [b.x + b.w, b.y, -1, 1], [b.x, b.y + b.h, 1, -1], [b.x + b.w, b.y + b.h, -1, -1]] as const) {
      g.moveTo(cx + 0.5 * sx, cy + L * sy);
      g.lineTo(cx + 0.5 * sx, cy + 0.5 * sy);
      g.lineTo(cx + L * sx, cy + 0.5 * sy);
    }
    g.stroke();
  }

  private spawn(s: Spark): void {
    if (this.sparks.length < MAX_SPARKS) this.sparks.push(s);
  }

  /** move e desenha as partículas; `drawOne` decide a forma */
  private stepSparks(dt: number, gravity: number, drawOne: (s: Spark, a: number) => void): void {
    const g = this.g;
    g.globalCompositeOperation = 'lighter';
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.life -= dt;
      if (s.life <= 0) {
        this.sparks.splice(i, 1);
        continue;
      }
      s.vy += gravity * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      drawOne(s, s.life / s.max);
    }
    g.globalCompositeOperation = 'source-over';
  }

  // ---------- forno: cadinho que esquenta ----------

  private drawHeat(dt: number, b: { x: number; y: number; w: number; h: number }): void {
    const g = this.g, th = this.thermal, heat = th.heat;
    const hc = css(heatColor(th.temp));
    const cx = b.x + b.w / 2, cw = Math.min(b.w * 0.62, 96), top = b.y + b.h * 0.34, bot = b.y + b.h - 10;
    // brilho embaixo
    if (heat > 0.02) {
      const rg = g.createRadialGradient(cx, bot, 2, cx, bot, cw);
      rg.addColorStop(0, hc);
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      g.globalAlpha = 0.18 + heat * 0.4;
      g.fillStyle = rg;
      g.fillRect(cx - cw, bot - cw, cw * 2, cw * 1.2);
      g.globalAlpha = 1;
    }
    // cadinho: trapézio de traço fino, com o metal derretido na cor do calor
    const tw = cw / 2, bw = cw * 0.34;
    const level = Math.min(1, heat * 1.4);
    if (level > 0.03) {
      const ly = bot - (bot - top - 4) * (0.25 + 0.6 * level);
      const k = (bot - ly) / (bot - top);
      g.fillStyle = hc;
      g.globalAlpha = 0.22 + 0.45 * heat;
      g.beginPath();
      g.moveTo(cx - bw - (tw - bw) * k, ly);
      g.lineTo(cx + bw + (tw - bw) * k, ly);
      g.lineTo(cx + bw, bot);
      g.lineTo(cx - bw, bot);
      g.closePath();
      g.fill();
      g.globalAlpha = 1;
    }
    g.strokeStyle = heat > 0.1 ? hc : LINE;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(cx - tw, top);
    g.lineTo(cx - bw, bot);
    g.lineTo(cx + bw, bot);
    g.lineTo(cx + tw, top);
    g.stroke();
    g.beginPath();
    g.moveTo(cx - tw - 6, top);
    g.lineTo(cx + tw + 6, top);
    g.strokeStyle = LINE;
    g.stroke();
    // ondas de calor
    if (heat > 0.15) {
      g.strokeStyle = hc;
      for (let k = 0; k < 3; k++) {
        const ph = (this.time * 0.6 + k / 3) % 1;
        const x0 = cx + (k - 1) * tw * 0.6, y0 = top - 4 - ph * (top - b.y - 6);
        g.globalAlpha = 0.35 * heat * Math.sin(Math.PI * ph);
        g.beginPath();
        g.moveTo(x0, y0);
        for (let u = 1; u <= 5; u++) g.lineTo(x0 + Math.sin(this.time * 3 + k + u) * 2.5, y0 - u * 4);
        g.stroke();
      }
      g.globalAlpha = 1;
    }
    // fagulhas
    this.acc += dt * heat * 40;
    while (this.acc >= 1) {
      this.acc -= 1;
      this.spawn({ x: cx + rnd(-tw * 0.6, tw * 0.6), y: top + 2, vx: rnd(-14, 14), vy: rnd(-70, -25), life: rnd(0.4, 0.9), max: 0.9, size: rnd(0.8, 1.8) });
    }
    this.stepSparks(dt, 60, (s, a) => {
      g.fillStyle = hc;
      g.globalAlpha = a;
      g.fillRect(s.x - s.size / 2, s.y - s.size / 2, s.size, s.size);
    });
    g.globalAlpha = 1;
  }

  // ---------- bancada: dois lasers imprimem a peça em camadas ----------

  private drawLaser(dt: number, b: { x: number; y: number; w: number; h: number }, job: JobView | null): void {
    const g = this.g, acc = this.st?.accent ?? '#7fe7ff';
    const bedY = b.y + b.h - 12, bedW = b.w * 0.7, bx = b.x + (b.w - bedW) / 2;
    g.strokeStyle = LINE;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(bx, bedY + 0.5);
    g.lineTo(bx + bedW, bedY + 0.5);
    g.stroke();
    // a peça: camadas que crescem com o progresso do trabalho
    const total = 10;
    const p = job ? job.progress : 0;
    const layers = Math.floor(p * total);
    const pw = bedW * 0.5, px = bx + (bedW - pw) / 2, lh = Math.min(5, (bedY - b.y - 28) / total);
    for (let k = 0; k < layers; k++) {
      const wk = pw * (1 - k * 0.035);
      g.fillStyle = acc;
      g.globalAlpha = 0.18 + 0.05 * (k % 2);
      g.fillRect(px + (pw - wk) / 2, bedY - (k + 1) * lh, wk, lh - 1);
      g.globalAlpha = 0.7;
      g.fillRect(px + (pw - wk) / 2, bedY - (k + 1) * lh, wk, 1);
    }
    g.globalAlpha = 1;
    // emissores no alto e os feixes varrendo a camada de agora
    const ey = b.y + 8;
    const e1 = b.x + 10, e2 = b.x + b.w - 10;
    g.strokeStyle = LINE;
    g.strokeRect(e1 - 3.5, ey - 3.5, 7, 7);
    g.strokeRect(e2 - 3.5, ey - 3.5, 7, 7);
    if (this.work > 0.05) {
      const ly = bedY - layers * lh - 1;
      const wk = pw * (1 - layers * 0.035);
      const hx = px + (pw - wk) / 2 + (0.5 + 0.5 * Math.sin(this.time * 5)) * wk;
      g.strokeStyle = acc;
      g.globalAlpha = 0.25 + 0.6 * this.work;
      g.beginPath();
      g.moveTo(e1, ey);
      g.lineTo(hx, ly);
      g.moveTo(e2, ey);
      g.lineTo(hx, ly);
      g.stroke();
      g.globalAlpha = 1;
      if (Math.random() < dt * 30 * this.work) {
        for (let k = 0; k < 2; k++) this.spawn({ x: hx, y: ly, vx: rnd(-40, 40), vy: rnd(-50, -10), life: rnd(0.2, 0.45), max: 0.45, size: rnd(0.8, 1.5) });
      }
    }
    this.stepSparks(dt, 120, (s, a) => {
      g.fillStyle = acc;
      g.globalAlpha = a;
      g.fillRect(s.x, s.y, s.size, s.size);
    });
    g.globalAlpha = 1;
  }

  // ---------- eletrolisador: célula com bolhas ----------

  private drawCell(dt: number, b: { x: number; y: number; w: number; h: number }): void {
    const g = this.g, acc = this.st?.accent ?? '#5fd0ff';
    const tw = Math.min(b.w * 0.62, 110), th = b.h - 16, tx = b.x + (b.w - tw) / 2, ty = b.y + 8;
    const surf = ty + th * 0.3;
    // líquido
    g.fillStyle = acc;
    g.globalAlpha = 0.07 + 0.06 * this.work;
    g.fillRect(tx, surf, tw, ty + th - surf);
    g.globalAlpha = 1;
    g.strokeStyle = LINE;
    g.lineWidth = 1;
    g.strokeRect(tx + 0.5, ty + 0.5, tw - 1, th - 1);
    g.beginPath();
    g.moveTo(tx, surf + 0.5);
    g.lineTo(tx + tw, surf + 0.5);
    g.stroke();
    // eletrodos: o da esquerda solta hidrogênio (o dobro), o da direita oxigênio
    const ex = [tx + tw * 0.3, tx + tw * 0.7];
    g.strokeStyle = this.work > 0.05 ? acc : LINE;
    g.globalAlpha = 0.5 + 0.5 * this.work;
    g.beginPath();
    for (const x of ex) {
      g.moveTo(x + 0.5, ty - 4);
      g.lineTo(x + 0.5, ty + th - 10);
    }
    g.stroke();
    g.globalAlpha = 1;
    this.acc += dt * this.work * 26;
    while (this.acc >= 1) {
      this.acc -= 1;
      const side = Math.random() < 0.66 ? 0 : 1;
      this.spawn({ x: ex[side] + rnd(-3, 3), y: ty + th - 12 - rnd(0, th * 0.4), vx: rnd(-3, 3), vy: rnd(-30, -16), life: 3, max: 3, size: rnd(1, 2.2), side });
    }
    this.stepSparks(dt, 0, (s, a) => {
      if (s.y < surf) s.life = 0;
      g.strokeStyle = acc;
      g.globalAlpha = 0.5 + 0.5 * Math.min(1, a * 3);
      g.beginPath();
      g.arc(s.x + Math.sin(this.time * 4 + s.y * 0.2) * 1.2, s.y, s.size, 0, Math.PI * 2);
      g.stroke();
    });
    g.globalAlpha = 1;
  }
}
