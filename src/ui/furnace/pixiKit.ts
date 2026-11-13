// Peças de interface em PixiJS (docs/design/FORNO.md): texto, painel, botão que aperta, lista que rola com o dedo e ícones.
// Estilo de interface de nave: fios de 1 px, cantos chanfrados, nada de brilho nem sombra (ver theme.ts).
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

/** Texto. `title` usa Chakra Petch (títulos); o resto, JetBrains Mono (dados). */
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
  /** tamanho do chanfro dos cantos (pixels) */
  radius?: number;
  /** ignorado: o estilo sério não tem "lábio"; fica para não mexer nas chamadas */
  lip?: number;
  dashed?: boolean;
  alpha?: number;
  /** pequenos colchetes nos cantos, como mira de painel técnico */
  brackets?: boolean;
}

/** pontos de um retângulo com os cantos de cima à esquerda e de baixo à direita chanfrados */
export function chamfer(x: number, y: number, w: number, h: number, c: number): number[] {
  const k = Math.max(0, Math.min(c, w / 3, h / 3));
  return [x + k, y, x + w, y, x + w, y + h - k, x + w - k, y + h, x, y + h, x, y + k];
}

/** Painel técnico: fundo escuro, fio de 1 px, canto chanfrado e colchetes nos cantos. */
export function drawPanel(g: Graphics, x: number, y: number, w: number, h: number, o: PanelOpts = {}): void {
  const c = Math.min(o.radius ?? 8, 10) * 0.55;
  const line = o.line ?? C.panelLine;
  const pts = chamfer(x, y, w, h, c);
  g.poly(pts).fill({ color: o.fill ?? C.panel, alpha: o.alpha ?? 1 });
  if (o.dashed) {
    dashedPoly(g, pts, line);
    return;
  }
  g.poly(pts).stroke({ width: 1, color: line, alpha: 0.85 });
  if (o.brackets !== false && w > 60 && h > 40) {
    const L = Math.min(10, w / 5, h / 5);
    const bc = shade(line, 0.35);
    // colchetes: os quatro cantos, por cima do fio
    g.moveTo(x + 0.5, y + L).lineTo(x + 0.5, y + c + 0.5).lineTo(x + c + 0.5, y + 0.5).lineTo(x + L + c, y + 0.5);
    g.moveTo(x + w - L - c, y + h - 0.5).lineTo(x + w - c - 0.5, y + h - 0.5).lineTo(x + w - 0.5, y + h - c - 0.5).lineTo(x + w - 0.5, y + h - L);
    g.moveTo(x + w - L, y + 0.5).lineTo(x + w - 0.5, y + 0.5).lineTo(x + w - 0.5, y + L);
    g.moveTo(x + L, y + h - 0.5).lineTo(x + 0.5, y + h - 0.5).lineTo(x + 0.5, y + h - L);
    g.stroke({ width: 1.4, color: bc, alpha: 0.9 });
  }
}

/** contorno tracejado de um polígono */
function dashedPoly(g: Graphics, pts: number[], color: number): void {
  const dash = 4, gap = 4;
  const n = pts.length / 2;
  for (let i = 0; i < n; i++) {
    const x0 = pts[i * 2], y0 = pts[i * 2 + 1], x1 = pts[((i + 1) % n) * 2], y1 = pts[((i + 1) % n) * 2 + 1];
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len < 0.1) continue;
    const ux = (x1 - x0) / len, uy = (y1 - y0) / len;
    for (let d = 0; d < len; d += dash + gap) {
      const e = Math.min(len, d + dash);
      g.moveTo(x0 + ux * d, y0 + uy * d).lineTo(x0 + ux * e, y0 + uy * e);
    }
  }
  g.stroke({ width: 1, color, alpha: 0.7 });
}

export type Tone = 'neutral' | 'go' | 'ice' | 'orange' | 'danger' | 'gold';

/** cor do fio e do texto de cada tipo de botão */
const TONE: Record<Tone, { face: number; ink: number }> = {
  neutral: { face: 0x3a6479, ink: C.ink },
  go: { face: C.ok, ink: C.ok },
  ice: { face: C.ice, ink: C.ice },
  orange: { face: C.orange, ink: C.orange },
  danger: { face: C.warn, ink: C.warn },
  gold: { face: C.gold, ink: C.gold },
};

/**
 * Botão de painel técnico: fundo escuro, fio de 1 px na cor da função, chanfro num canto e texto em maiúsculas. Apertado, o
 * fundo acende. Sem brilho nem sombra. Registra o toque ao soltar dentro dele.
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
    this.caption = txt('', { title: true, weight: '600', ax: 0.5, ay: 0.5, spacing: 0.8 });
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
    setText(this.caption, s.length > 2 ? s.toUpperCase() : s);
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
    this.alpha = v ? 1 : 0.4;
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
    const strong = this.tone !== 'neutral' && this.tone !== 'danger' && this.enabled;
    const pts = chamfer(0, 0, this.w, this.h, Math.min(6, this.h / 4));
    g.poly(pts).fill({ color: this.pressed ? t.face : shade(t.face, -0.85), alpha: this.pressed ? 0.35 : strong ? 0.55 : 0.8 });
    if (strong && !this.pressed) g.poly(pts).fill({ color: t.face, alpha: 0.12 });
    g.poly(pts).stroke({ width: 1, color: t.face, alpha: this.enabled ? 0.9 : 0.5 });
    // marca de função: um risco curto no canto de baixo à esquerda
    if (this.w > 50) g.moveTo(3, this.h - 3.5).lineTo(10, this.h - 3.5).stroke({ width: 1.4, color: t.face, alpha: this.enabled ? 0.9 : 0.4 });
    this.caption.style.fill = this.enabled ? t.ink : C.faint;
    const iw = this.iconSpr.visible ? this.iconSpr.width + 6 : 0;
    this.caption.position.set(this.w / 2 + iw / 2, this.h / 2 + 0.5);
    this.iconSpr.position.set(this.w / 2 - this.caption.width / 2 - 2, this.h / 2);
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
