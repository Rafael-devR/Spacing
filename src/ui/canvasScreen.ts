// Base das telas cheias desenhadas em Canvas 2D (estações e energia; docs/design/INTERFACE.md). Ocupa a tela
// inteira, desenha na resolução nativa do aparelho, cuida do laço de desenho, dos toques (botões e listas que
// rolam com o dedo) e do botão de voltar. Cada tela só desenha e diz onde estão os botões a cada quadro.
import { el } from './dom';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Hit extends Rect {
  id: string;
  onTap: () => void;
}

/** área que rola com o dedo (lista de receitas) */
export interface ScrollArea extends Rect {
  id: string;
  /** altura do conteúdo */
  content: number;
  /** horizontal em vez de vertical */
  horizontal?: boolean;
}

export const FONT_UI = 'Rubik, system-ui, sans-serif';
export const FONT_TITLE = 'Fredoka, Rubik, system-ui, sans-serif';

export const COLORS = {
  bg: '#070b1c',
  panel: 'rgba(16, 24, 52, 0.92)',
  line: 'rgba(127, 231, 255, 0.16)',
  ink: '#f4f0e8',
  dim: 'rgba(244, 240, 232, 0.6)',
  faint: 'rgba(244, 240, 232, 0.32)',
  ok: '#6dffb0',
  warn: '#ff9a85',
  work: '#ffb03a',
};

export function roundRect(x: CanvasRenderingContext2D, r: Rect, radius: number): void {
  const k = Math.min(radius, r.w / 2, r.h / 2);
  x.beginPath();
  x.moveTo(r.x + k, r.y);
  x.arcTo(r.x + r.w, r.y, r.x + r.w, r.y + r.h, k);
  x.arcTo(r.x + r.w, r.y + r.h, r.x, r.y + r.h, k);
  x.arcTo(r.x, r.y + r.h, r.x, r.y, k);
  x.arcTo(r.x, r.y, r.x + r.w, r.y, k);
  x.closePath();
}

export const inside = (r: Rect, px: number, py: number): boolean => px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;

/** corta o texto com reticências para caber em `w` */
export function fitText(x: CanvasRenderingContext2D, text: string, w: number): string {
  if (x.measureText(text).width <= w) return text;
  let t = text;
  while (t.length > 1 && x.measureText(t + '…').width > w) t = t.slice(0, -1);
  return t + '…';
}

/** quebra o texto em linhas de largura `w` */
export function wrapText(x: CanvasRenderingContext2D, text: string, w: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? line + ' ' + word : word;
    if (x.measureText(next).width > w && line) {
      out.push(line);
      line = word;
    } else line = next;
  }
  if (line) out.push(line);
  return out;
}

export abstract class CanvasScreen {
  onToggle: ((open: boolean) => void) | null = null;
  protected readonly root: HTMLElement;
  protected readonly canvas: HTMLCanvasElement;
  protected readonly g: CanvasRenderingContext2D;
  /** tamanho em pixels de CSS */
  protected W = 0;
  protected H = 0;
  /** margens seguras (entalhe da tela) */
  protected safe = { l: 0, r: 0, t: 0, b: 0 };
  protected time = 0;
  protected hits: Hit[] = [];
  protected scrolls: ScrollArea[] = [];
  /** quanto cada área já rolou */
  protected scrollPos = new Map<string, number>();
  private raf = 0;
  private last = 0;
  private press: { x: number; y: number; area: ScrollArea | null; start: number; moved: boolean } | null = null;
  private readonly imgs = new Map<string, HTMLImageElement>();

  constructor(rootSel: string) {
    this.root = el(rootSel);
    this.canvas = el<HTMLCanvasElement>(`${rootSel} canvas`);
    const g = this.canvas.getContext('2d');
    if (!g) throw new Error('Canvas 2D indisponível');
    this.g = g;
    this.canvas.addEventListener('pointerdown', (e) => this.down(e));
    this.canvas.addEventListener('pointermove', (e) => this.move(e));
    this.canvas.addEventListener('pointerup', (e) => this.up(e));
    this.canvas.addEventListener('pointercancel', () => (this.press = null));
    this.canvas.addEventListener(
      'wheel',
      (e) => {
        const p = this.local(e);
        const a = this.scrolls.find((s) => inside(s, p.x, p.y));
        if (a) this.scrollBy(a, a.horizontal ? e.deltaX || e.deltaY : e.deltaY);
        e.preventDefault();
      },
      { passive: false },
    );
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  protected openScreen(): void {
    if (this.open) return;
    this.root.hidden = false;
    this.onToggle?.(true);
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  close(): void {
    if (!this.open) return;
    this.root.hidden = true;
    cancelAnimationFrame(this.raf);
    this.press = null;
    this.onToggle?.(false);
  }

  /** imagem (ícone) a partir de um endereço de dados, guardada */
  protected img(src: string | undefined): HTMLImageElement | null {
    if (!src) return null;
    let i = this.imgs.get(src);
    if (!i) {
      i = new Image();
      i.src = src;
      this.imgs.set(src, i);
    }
    return i.complete && i.naturalWidth ? i : null;
  }

  /** botão: área tocável deste quadro */
  protected hit(id: string, r: Rect, onTap: () => void): void {
    this.hits.push({ id, ...r, onTap });
  }

  protected scrollOf(id: string): number {
    return this.scrollPos.get(id) ?? 0;
  }

  private scrollBy(a: ScrollArea, d: number): void {
    const view = a.horizontal ? a.w : a.h;
    const max = Math.max(0, a.content - view);
    this.scrollPos.set(a.id, Math.max(0, Math.min(max, this.scrollOf(a.id) + d)));
  }

  private local(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private down(e: PointerEvent): void {
    const p = this.local(e);
    this.canvas.setPointerCapture?.(e.pointerId);
    this.press = { ...p, area: this.scrolls.find((s) => inside(s, p.x, p.y)) ?? null, start: 0, moved: false };
    if (this.press.area) this.press.start = this.scrollOf(this.press.area.id);
  }

  private move(e: PointerEvent): void {
    const pr = this.press;
    if (!pr) return;
    const p = this.local(e);
    const dx = p.x - pr.x, dy = p.y - pr.y;
    if (Math.hypot(dx, dy) > 8) pr.moved = true;
    if (pr.area && pr.moved) {
      const a = pr.area;
      const view = a.horizontal ? a.w : a.h;
      const max = Math.max(0, a.content - view);
      this.scrollPos.set(a.id, Math.max(0, Math.min(max, pr.start - (a.horizontal ? dx : dy))));
    }
  }

  private up(e: PointerEvent): void {
    const pr = this.press;
    this.press = null;
    if (!pr || pr.moved) return;
    const p = this.local(e);
    // o último botão desenhado fica por cima
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i];
      if (inside(h, p.x, p.y)) {
        h.onTap();
        return;
      }
    }
  }

  private readonly frame = (now: number): void => {
    if (!this.open) return;
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;
    const c = this.canvas;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const W = c.clientWidth, H = c.clientHeight;
    if (W > 0 && H > 0) {
      if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
        c.width = Math.round(W * dpr);
        c.height = Math.round(H * dpr);
        // o elemento de fora tem as margens seguras (env(safe-area-inset-*)) como padding
        const cs = getComputedStyle(this.root);
        this.safe = { l: parseFloat(cs.paddingLeft) || 0, r: parseFloat(cs.paddingRight) || 0, t: parseFloat(cs.paddingTop) || 0, b: parseFloat(cs.paddingBottom) || 0 };
      }
      this.W = W;
      this.H = H;
      const g = this.g;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      this.hits = [];
      this.scrolls = [];
      this.draw(dt);
    }
    this.raf = requestAnimationFrame(this.frame);
  };

  /** desenha um quadro inteiro (W, H, time prontos; registre botões com `hit` e listas em `scrolls`) */
  protected abstract draw(dt: number): void;

  // ---------- peças comuns ----------

  /** fundo: degradê escuro com grade técnica bem fraca e a cor da tela */
  protected background(accent: string): void {
    const g = this.g;
    const grd = g.createLinearGradient(0, 0, 0, this.H);
    grd.addColorStop(0, '#0b1230');
    grd.addColorStop(1, COLORS.bg);
    g.fillStyle = grd;
    g.fillRect(0, 0, this.W, this.H);
    const glow = g.createRadialGradient(this.W * 0.6, this.H * 0.35, 10, this.W * 0.6, this.H * 0.35, this.W * 0.6);
    glow.addColorStop(0, hexA(accent, 0.1));
    glow.addColorStop(1, hexA(accent, 0));
    g.fillStyle = glow;
    g.fillRect(0, 0, this.W, this.H);
    g.strokeStyle = 'rgba(127,231,255,0.035)';
    g.lineWidth = 1;
    for (let x = 0; x < this.W; x += 24) {
      g.beginPath();
      g.moveTo(x + 0.5, 0);
      g.lineTo(x + 0.5, this.H);
      g.stroke();
    }
    for (let y = 0; y < this.H; y += 24) {
      g.beginPath();
      g.moveTo(0, y + 0.5);
      g.lineTo(this.W, y + 0.5);
      g.stroke();
    }
  }

  /** barra de cima: voltar, título e subtítulo. Devolve a altura. */
  protected topBar(title: string, subtitle: string, accent: string): number {
    const g = this.g;
    const h = 56;
    const x0 = this.safe.l + 10, y0 = this.safe.t + 8;
    const back = { x: x0, y: y0, w: 40, h: 40 };
    g.fillStyle = 'rgba(255,255,255,0.08)';
    roundRect(g, back, 20);
    g.fill();
    g.strokeStyle = COLORS.ink;
    g.lineWidth = 2.6;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(back.x + 23, back.y + 12);
    g.lineTo(back.x + 15, back.y + 20);
    g.lineTo(back.x + 23, back.y + 28);
    g.stroke();
    this.hit('back', { x: 0, y: 0, w: back.x + back.w + 6, h: back.y + back.h + 6 }, () => this.close());
    g.fillStyle = accent;
    g.font = `600 19px ${FONT_TITLE}`;
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    g.fillText(title, back.x + 54, y0 + 18);
    g.fillStyle = COLORS.dim;
    g.font = `400 12px ${FONT_UI}`;
    g.fillText(fitText(g, subtitle, this.W * 0.5), back.x + 54, y0 + 35);
    return this.safe.t + h;
  }

  /** botão grande com texto */
  protected button(id: string, r: Rect, label: string, opts: { color?: string; enabled?: boolean; ink?: string } = {}, onTap?: () => void): void {
    const g = this.g;
    const on = opts.enabled !== false;
    g.globalAlpha = on ? 1 : 0.4;
    g.fillStyle = opts.color ?? COLORS.ink;
    roundRect(g, r, Math.min(14, r.h / 2));
    g.fill();
    g.fillStyle = opts.ink ?? '#120f26';
    g.font = `600 ${Math.min(18, r.h * 0.4)}px ${FONT_TITLE}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(fitText(g, label, r.w - 16), r.x + r.w / 2, r.y + r.h / 2 + 1);
    g.textBaseline = 'alphabetic';
    g.globalAlpha = 1;
    if (on && onTap) this.hit(id, r, onTap);
  }
}

/** '#rrggbb' com transparência */
export function hexA(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** sol girando (energia do forno, painéis) */
export function sunIcon(g: CanvasRenderingContext2D, x: number, y: number, r: number, time: number): void {
  g.save();
  g.translate(x, y);
  g.rotate(time * 0.4);
  g.strokeStyle = '#ffd27a';
  g.lineWidth = 2;
  g.lineCap = 'round';
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    g.beginPath();
    g.moveTo(Math.cos(a) * r * 1.4, Math.sin(a) * r * 1.4);
    g.lineTo(Math.cos(a) * r * 1.8, Math.sin(a) * r * 1.8);
    g.stroke();
  }
  g.restore();
  g.fillStyle = '#ffcf5a';
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
}

/** raio (eletricidade) */
export function boltIcon(g: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(x + r * 0.15, y - r);
  g.lineTo(x - r * 0.6, y + r * 0.15);
  g.lineTo(x - r * 0.05, y + r * 0.15);
  g.lineTo(x - r * 0.2, y + r);
  g.lineTo(x + r * 0.6, y - r * 0.2);
  g.lineTo(x + r * 0.05, y - r * 0.2);
  g.closePath();
  g.fill();
}
