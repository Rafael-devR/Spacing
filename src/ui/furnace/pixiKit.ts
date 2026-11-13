// Peças de interface em PixiJS (docs/design/FORNO.md): texto, painel, botão que aperta, lista que rola com o dedo e ícones.
// Direção de arte do Spacing: cartoon, cantos redondos, uma sombra chapada embaixo de tudo que aperta.
import { Container, Graphics, Rectangle, Sprite, Text, Texture, type FederatedPointerEvent } from 'pixi.js';
import { C, FONT_TITLE, FONT_UI, shade } from './theme';

/** resolução do texto (a mesma do renderizador) */
let textRes = 1;
export const setTextResolution = (r: number): void => {
  textRes = r;
};

export interface TxtOpts {
  size?: number;
  weight?: '400' | '500' | '600' | '700';
  fill?: number;
  title?: boolean;
  spacing?: number;
  align?: 'left' | 'center' | 'right';
  /** pivô horizontal: 0 esquerda, 0.5 centro, 1 direita */
  ax?: number;
  ay?: number;
  wrap?: number;
  lineHeight?: number;
}

/** Texto. `title` usa Fredoka (títulos e números); o resto, Rubik. */
export function txt(text: string, o: TxtOpts = {}): Text {
  const t = new Text({
    text,
    resolution: textRes,
    style: {
      fontFamily: o.title ? FONT_TITLE : FONT_UI,
      fontSize: o.size ?? 12,
      fontWeight: o.weight ?? (o.title ? '600' : '500'),
      fill: o.fill ?? C.ink,
      letterSpacing: o.spacing ?? 0,
      align: o.align ?? 'left',
      wordWrap: !!o.wrap,
      wordWrapWidth: o.wrap ?? 0,
      lineHeight: o.lineHeight,
    },
  });
  t.anchor.set(o.ax ?? 0, o.ay ?? 0);
  return t;
}

/** troca o texto só se mudou (refazer o texto custa) */
export function setText(t: Text, s: string): void {
  if (t.text !== s) t.text = s;
}

/** encolhe o texto para caber em `maxW` (sem refazer a fonte) */
export function fitWidth(t: Text, maxW: number): void {
  t.scale.set(1);
  const w = t.width;
  if (w > maxW && w > 0) t.scale.set(maxW / w);
}

export interface PanelOpts {
  fill?: number;
  line?: number;
  radius?: number;
  /** sombra chapada embaixo (pixels) */
  lip?: number;
  dashed?: boolean;
  alpha?: number;
}

/** Painel cartoon: sombra chapada, corpo, brilho fino no topo e contorno. */
export function drawPanel(g: Graphics, x: number, y: number, w: number, h: number, o: PanelOpts = {}): void {
  const r = Math.min(o.radius ?? 10, w / 2, h / 2);
  const fill = o.fill ?? C.panel;
  if (o.lip) g.roundRect(x, y + o.lip, w, h, r).fill({ color: C.shadow, alpha: 0.85 });
  g.roundRect(x, y, w, h, r).fill({ color: fill, alpha: o.alpha ?? 1 });
  if (o.dashed) {
    dashedRound(g, x, y, w, h, r, o.line ?? C.panelLine);
    return;
  }
  g.roundRect(x, y, w, h, r).stroke({ width: 1.5, color: o.line ?? C.panelLine, alpha: 0.9 });
  if (h > 20) g.roundRect(x + 2, y + 1.5, w - 4, Math.min(8, h / 3), Math.max(2, r - 2)).fill({ color: 0xffffff, alpha: 0.05 });
}

/** contorno tracejado de um retângulo arredondado (aproximado por segmentos nas retas) */
function dashedRound(g: Graphics, x: number, y: number, w: number, h: number, r: number, color: number): void {
  const dash = 5, gap = 4;
  const line = (x0: number, y0: number, x1: number, y1: number): void => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const ux = (x1 - x0) / len, uy = (y1 - y0) / len;
    for (let d = 0; d < len; d += dash + gap) {
      const e = Math.min(len, d + dash);
      g.moveTo(x0 + ux * d, y0 + uy * d).lineTo(x0 + ux * e, y0 + uy * e);
    }
  };
  line(x + r, y, x + w - r, y);
  line(x + w, y + r, x + w, y + h - r);
  line(x + w - r, y + h, x + r, y + h);
  line(x, y + h - r, x, y + r);
  g.stroke({ width: 1.5, color, alpha: 0.8 });
  for (const [cx, cy, a0] of [[x + r, y + r, Math.PI], [x + w - r, y + r, -Math.PI / 2], [x + w - r, y + h - r, 0], [x + r, y + h - r, Math.PI / 2]] as const)
    g.moveTo(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r).arc(cx, cy, r, a0, a0 + Math.PI / 2);
  g.stroke({ width: 1.5, color, alpha: 0.8 });
}

export type Tone = 'neutral' | 'go' | 'ice' | 'orange' | 'danger' | 'gold';

const TONE: Record<Tone, { face: number; ink: number }> = {
  neutral: { face: 0x34306a, ink: C.ink },
  go: { face: 0x3ed98a, ink: 0x06281a },
  ice: { face: 0x66dff0, ink: 0x08303a },
  orange: { face: 0xff8a3d, ink: 0x3a1500 },
  danger: { face: 0x4a2f4f, ink: C.warn },
  gold: { face: 0xffcf5a, ink: 0x3a2a00 },
};

/**
 * Botão cartoon: corpo colorido com brilho em cima, "lábio" mais escuro embaixo. Apertado, o corpo desce e o lábio encolhe.
 * Registra o toque ao soltar dentro dele.
 */
export class PButton extends Container {
  private readonly g = new Graphics();
  private readonly caption: Text;
  private readonly iconSpr = new Sprite();
  private w = 0;
  private h = 0;
  private tone: Tone = 'neutral';
  private pressed = false;
  private enabled = true;
  readonly id: string;

  constructor(id: string, private readonly onTap: () => void) {
    super();
    this.id = id;
    this.caption = txt('', { title: true, weight: '600', ax: 0.5, ay: 0.5, spacing: 0.3 });
    this.iconSpr.anchor.set(0.5);
    this.iconSpr.visible = false;
    this.addChild(this.g, this.iconSpr, this.caption);
    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.on('pointerdown', () => this.press(true));
    this.on('pointerup', () => this.press(false));
    this.on('pointerupoutside', () => this.press(false));
    this.on('pointertap', () => {
      if (this.enabled) this.onTap();
    });
  }

  private press(v: boolean): void {
    if (!this.enabled && v) return;
    if (this.pressed === v) return;
    this.pressed = v;
    this.draw();
  }

  layout(x: number, y: number, w: number, h: number, size = 13): void {
    this.position.set(x, y);
    this.w = w;
    this.h = h;
    this.caption.style.fontSize = size;
    this.hitArea = new Rectangle(-3, -3, w + 6, h + 9);
    this.draw();
  }

  setLabel(s: string): void {
    setText(this.caption, s);
    fitWidth(this.caption, this.w - 14 - (this.iconSpr.visible ? this.iconSpr.width : 0));
  }

  setTone(t: Tone): void {
    if (t !== this.tone) {
      this.tone = t;
      this.draw();
    }
  }

  setEnabled(v: boolean): void {
    if (v === this.enabled) return;
    this.enabled = v;
    if (!v) this.pressed = false;
    this.alpha = v ? 1 : 0.45;
    this.cursor = v ? 'pointer' : 'default';
    this.draw();
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  setIcon(tex: Texture | null, size = 18): void {
    this.iconSpr.visible = !!tex;
    if (tex) {
      this.iconSpr.texture = tex;
      this.iconSpr.width = this.iconSpr.height = size;
    }
    this.draw();
  }

  private draw(): void {
    const g = this.g;
    g.clear();
    if (this.w <= 0) return;
    const t = TONE[this.enabled ? this.tone : 'neutral'];
    const r = Math.min(12, this.h / 2.4);
    const lip = this.pressed ? 1 : 4;
    const dy = this.pressed ? 3 : 0;
    g.roundRect(0, dy + lip, this.w, this.h, r).fill({ color: shade(t.face, -0.55) });
    g.roundRect(0, dy, this.w, this.h, r).fill({ color: t.face });
    g.roundRect(3, dy + 2, this.w - 6, Math.max(4, this.h * 0.32), Math.max(2, r - 3)).fill({ color: 0xffffff, alpha: 0.22 });
    g.roundRect(0, dy, this.w, this.h, r).stroke({ width: 1.2, color: shade(t.face, -0.35), alpha: 0.9 });
    const ink = this.enabled ? t.ink : C.faint;
    this.caption.style.fill = ink;
    const iw = this.iconSpr.visible ? this.iconSpr.width + 6 : 0;
    this.caption.position.set(this.w / 2 + iw / 2, dy + this.h / 2 + 0.5);
    this.iconSpr.position.set(this.w / 2 - this.caption.width / 2 - 2, dy + this.h / 2);
    fitWidth(this.caption, this.w - 14 - iw);
  }
}

export interface ListItem {
  id: string;
  /** retângulo no conteúdo (coordenadas da lista) */
  rect: Rectangle;
  onTap: () => void;
}

/**
 * Lista que rola com o dedo (vertical ou horizontal), com inércia e esmaecimento nas bordas. Os toques são tratados aqui, não nos
 * filhos: um arrasto maior que 8 px rola; senão é toque no item sob o dedo.
 */
export class ScrollList extends Container {
  readonly content = new Container();
  private readonly maskG = new Graphics();
  private readonly fadeTop = new Graphics();
  private readonly fadeBottom = new Graphics();
  private items: ListItem[] = [];
  private vw = 0;
  private vh = 0;
  private total = 0;
  private pos = 0;
  private vel = 0;
  private press: { x: number; y: number; start: number; moved: boolean; t: number; last: number } | null = null;
  private fadeColor: number = C.panel;

  constructor(private readonly horizontal = false) {
    super();
    this.addChild(this.content, this.fadeTop, this.fadeBottom, this.maskG);
    this.content.mask = this.maskG;
    this.eventMode = 'static';
    this.on('pointerdown', (e: FederatedPointerEvent) => this.down(e));
    this.on('globalpointermove', (e: FederatedPointerEvent) => this.move(e));
    this.on('pointerup', (e: FederatedPointerEvent) => this.up(e));
    this.on('pointerupoutside', (e: FederatedPointerEvent) => this.up(e));
  }

  setFadeColor(c: number): void {
    this.fadeColor = c;
  }

  layout(x: number, y: number, w: number, h: number): void {
    this.position.set(x, y);
    this.vw = w;
    this.vh = h;
    this.hitArea = new Rectangle(0, 0, w, h);
    this.maskG.clear().rect(0, 0, w, h).fill(0xffffff);
    this.clamp();
    this.apply();
  }

  /** define os itens e o tamanho total do conteúdo */
  setItems(items: ListItem[], total: number): void {
    this.items = items;
    this.total = total;
    this.clamp();
    this.apply();
  }

  get offset(): number {
    return this.pos;
  }

  scrollTo(v: number): void {
    this.pos = v;
    this.vel = 0;
    this.clamp();
    this.apply();
  }

  scrollBy(d: number): void {
    this.scrollTo(this.pos + d);
  }

  /** a posição do item `id` na tela (para o teste) */
  itemRect(id: string): Rectangle | null {
    const it = this.items.find((i) => i.id === id);
    if (!it) return null;
    const p = this.content.position;
    return new Rectangle(this.position.x + p.x + it.rect.x, this.position.y + p.y + it.rect.y, it.rect.width, it.rect.height);
  }

  private get max(): number {
    return Math.max(0, this.total - (this.horizontal ? this.vw : this.vh));
  }

  private clamp(): void {
    this.pos = Math.max(0, Math.min(this.max, this.pos));
  }

  private apply(): void {
    if (this.horizontal) this.content.position.set(-this.pos, 0);
    else this.content.position.set(0, -this.pos);
    this.drawFades();
  }

  private drawFades(): void {
    const len = 18;
    const a = Math.min(1, this.pos / 16), b = Math.min(1, (this.max - this.pos) / 16);
    for (const [g, v, bottom] of [[this.fadeTop, a, false], [this.fadeBottom, b, true]] as const) {
      g.clear();
      if (v < 0.02 || this.max < 4) continue;
      for (let i = 0; i < 6; i++) {
        const k = i / 6;
        const alpha = v * (1 - k) * 0.95;
        if (this.horizontal) g.rect(bottom ? this.vw - (i + 1) * (len / 6) : i * (len / 6), 0, len / 6 + 0.5, this.vh).fill({ color: this.fadeColor, alpha });
        else g.rect(0, bottom ? this.vh - (i + 1) * (len / 6) : i * (len / 6), this.vw, len / 6 + 0.5).fill({ color: this.fadeColor, alpha });
      }
    }
  }

  private local(e: FederatedPointerEvent): { x: number; y: number } {
    const p = this.toLocal(e.global);
    return { x: p.x, y: p.y };
  }

  private down(e: FederatedPointerEvent): void {
    const p = this.local(e);
    this.vel = 0;
    this.press = { x: p.x, y: p.y, start: this.pos, moved: false, t: performance.now(), last: this.horizontal ? p.x : p.y };
  }

  private move(e: FederatedPointerEvent): void {
    const pr = this.press;
    if (!pr) return;
    const p = this.local(e);
    const d = this.horizontal ? p.x - pr.x : p.y - pr.y;
    if (Math.abs(d) > 8 || Math.hypot(p.x - pr.x, p.y - pr.y) > 8) pr.moved = true;
    if (!pr.moved) return;
    const now = performance.now();
    const cur = this.horizontal ? p.x : p.y;
    const dt = Math.max(1, now - pr.t);
    this.vel = (-(cur - pr.last) / dt) * 16;
    pr.t = now;
    pr.last = cur;
    this.pos = pr.start - d;
    this.clamp();
    this.apply();
  }

  private up(e: FederatedPointerEvent): void {
    const pr = this.press;
    this.press = null;
    if (!pr) return;
    if (pr.moved) {
      if (performance.now() - pr.t > 90) this.vel = 0;
      return;
    }
    const p = this.local(e);
    const cx = p.x + (this.horizontal ? this.pos : 0), cy = p.y + (this.horizontal ? 0 : this.pos);
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      if (it.rect.contains(cx, cy)) {
        it.onTap();
        return;
      }
    }
  }

  /** inércia depois de soltar */
  update(dt: number): void {
    if (this.press || Math.abs(this.vel) < 0.02) return;
    this.pos += this.vel * dt * 60;
    this.vel *= Math.exp(-dt * 5);
    const before = this.pos;
    this.clamp();
    if (this.pos !== before) this.vel = 0;
    this.apply();
  }
}

/** Ícones (imagens em endereço de dados) viram texturas do Pixi uma vez só; devolve null até a imagem carregar. */
export class IconCache {
  private readonly map = new Map<string, Texture | null>();

  get(src: string | undefined): Texture | null {
    if (!src) return null;
    const have = this.map.get(src);
    if (have !== undefined) return have;
    this.map.set(src, null);
    const img = new Image();
    img.onload = () => this.map.set(src, Texture.from(img));
    img.src = src;
    return null;
  }

  /** um sprite com o ícone (a textura entra quando carregar; chame `sync` a cada quadro, ou use `ensure`) */
  sprite(src: string | undefined, size: number): Sprite {
    const s = new Sprite(Texture.EMPTY);
    s.anchor.set(0.5);
    s.width = s.height = size;
    (s as Sprite & { _src?: string; _size?: number })._src = src;
    (s as Sprite & { _src?: string; _size?: number })._size = size;
    this.sync(s);
    return s;
  }

  /** põe a textura no sprite quando ela estiver pronta */
  sync(s: Sprite): void {
    const o = s as Sprite & { _src?: string; _size?: number };
    if (!o._src || s.texture !== Texture.EMPTY) return;
    const t = this.get(o._src);
    if (t) {
      s.texture = t;
      s.width = s.height = o._size ?? 20;
    }
  }
}
