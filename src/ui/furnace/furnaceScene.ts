// A máquina da tela do forno (docs/design/FORNO.md), em PixiJS: espelhos mandando luz, a câmara de calor com três cadinhos, a
// ventoinha que esfria, o termômetro e a bandeja. Tudo que se mexe é estado de verdade: a luz é a energia (`sun`), o brilho é a
// temperatura (furnaceModel), cada cadinho é uma vaga (JobView) e cada unidade pronta sai do cadinho para a bandeja.
import { Container, FillGradient, Graphics, Rectangle, Sprite, Texture } from 'pixi.js';
import type { ItemId } from '../../data/items';
import type { Recipe } from '../../data/recipes';
import type { JobView } from '../../systems/Crafting';
import { t } from '../../i18n';
import { AMBIENT, heatColor, MAX_TEMP, targetTemp, tempText, ThermalModel } from './furnaceModel';
import { Particles, softTexture } from './particles';
import { drawPanel, fitWidth, setText, txt, type IconCache } from './pixiKit';
import { C, mix, shade } from './theme';

export interface SceneDeps {
  icons: IconCache;
  /** ícone do que a receita fabrica */
  outIcon: (r: Recipe) => string | undefined;
  itemIcon: (item: ItemId) => string | undefined;
  /** cor do conteúdo derretido */
  tint: (r: Recipe) => number;
}

export interface SceneState {
  jobs: (JobView | null)[];
  /** 0..1: sol que chega */
  sun: number;
  selected: number | null;
}

interface Geo {
  w: number;
  h: number;
  compact: boolean;
  mirror: Rectangle;
  chamber: Rectangle;
  cool: Rectangle;
  focus: { x: number; y: number };
  fan: { x: number; y: number; r: number };
  gauge: { x: number; y: number; r: number };
  tray: Rectangle;
  cols: Rectangle[];
}

interface SlotView {
  root: Container;
  g: Graphics;
  head: ReturnType<typeof txt>;
  clock: ReturnType<typeof txt>;
  step: ReturnType<typeof txt>;
  units: ReturnType<typeof txt>;
  free: Container;
  out: Sprite;
  /** nível do conteúdo derretido (suavizado) */
  level: number;
  /** unidades já vistas deste trabalho (para soltar os efeitos de cada unidade uma vez só) */
  seen: number;
  key: string;
  boom: number;
}

interface Token {
  spr: Sprite;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  t: number;
  dur: number;
  arc: number;
}

const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
const rnd = (a: number, b: number): number => a + Math.random() * (b - a);
const clock = (s: number): string => {
  if (!Number.isFinite(s)) return '--:--';
  const v = Math.max(0, Math.ceil(s));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
};

export class FurnaceScene extends Container {
  readonly thermal = new ThermalModel();
  onSlotTap: ((i: number) => void) | null = null;
  private geo: Geo | null = null;
  private time = 0;
  private readonly soft: Texture = softTexture();
  private readonly particles = new Particles(this.soft);
  // camadas
  private readonly back = new Graphics();
  private readonly beams = new Graphics();
  private readonly packets: Sprite[] = [];
  private readonly heatGlow = new Sprite(this.soft);
  private readonly chamberFill = new Graphics();
  private readonly shimmer = new Graphics();
  private readonly slotLayer = new Container();
  private readonly front = new Graphics();
  private readonly tokenLayer = new Container();
  private readonly overlay = new Graphics();
  // mirantes
  private readonly sun = new Container();
  private readonly sunRays = new Graphics();
  private sunCore: Graphics | null = null;
  private readonly sunGlow = new Sprite(this.soft);
  private mirrorPlates: Container[] = [];
  private readonly mirrorLayer = new Container();
  // ventoinha e termômetro
  private readonly fanBox = new Container();
  private readonly rotor = new Container();
  private readonly blur = new Graphics();
  private readonly gaugeG = new Graphics();
  private readonly needle = new Graphics();
  private needleAng = 0;
  private readonly lblMirror = txt('', { size: 9, weight: '600', fill: C.dim, spacing: 1.4 });
  private readonly kwText = txt('', { title: true, size: 15, fill: C.gold });
  private readonly lblFan = txt('', { size: 9, weight: '600', fill: C.dim, spacing: 1.4, ax: 0.5 });
  private readonly tempTextObj = txt('', { title: true, size: 17, fill: C.ink, ax: 0.5, ay: 0.5 });
  private readonly statusTxt = txt('', { size: 9.5, weight: '600', fill: C.dim, ax: 0.5, ay: 0.5, spacing: 0.8 });
  private readonly lblTray = txt('', { size: 9, weight: '600', fill: C.dim, spacing: 1.4 });
  private readonly trayIcons = new Container();
  private slots: SlotView[] = [];
  private tokens: Token[] = [];
  private limit = 1560;
  private sparkAcc = 0;
  private smokeAcc = 0;
  private airAcc = 0;
  private bubbleAcc = 0;
  private lastTemp = -1;

  constructor(private readonly deps: SceneDeps) {
    super();
    this.heatGlow.anchor.set(0.5);
    this.heatGlow.blendMode = 'add';
    this.sunGlow.anchor.set(0.5);
    this.sunGlow.blendMode = 'add';
    this.sun.addChild(this.sunGlow, this.sunRays);
    this.addChild(
      this.back, this.mirrorLayer, this.beams, this.sun, this.chamberFill, this.heatGlow, this.shimmer, this.slotLayer,
      this.fanBox, this.front, this.particles.smoke.view, this.particles.glow.view, this.tokenLayer, this.trayIcons, this.overlay,
      this.lblMirror, this.kwText, this.lblFan, this.tempTextObj, this.statusTxt, this.lblTray,
    );
    this.fanBox.addChild(this.rotor, this.blur);
    this.addChild(this.gaugeG, this.needle);
    for (let i = 0; i < 12; i++) {
      const p = new Sprite(this.soft);
      p.anchor.set(0.5);
      p.blendMode = 'add';
      p.tint = C.gold;
      this.packets.push(p);
      this.addChild(p);
    }
  }

  // ---------- geometria ----------

  /** Recalcula tudo para o tamanho `w`×`h` (a tela girou ou mudou de tamanho). */
  layout(w: number, h: number, slots: number): void {
    const compact = w < 520;
    const coolW = compact ? 86 : clamp(w * 0.25, 108, 150);
    const mirrorW = compact ? w : clamp(w * 0.2, 92, 128);
    const mirrorH = compact ? 62 : h;
    const mirror = new Rectangle(0, 0, mirrorW, mirrorH);
    const chamber = compact ? new Rectangle(0, mirrorH + 8, w - coolW - 8, h - mirrorH - 8) : new Rectangle(mirrorW + 10, 0, w - mirrorW - coolW - 20, h);
    const cool = compact ? new Rectangle(w - coolW, mirrorH + 8, coolW, h - mirrorH - 8) : new Rectangle(w - coolW, 0, coolW, h);
    const trayH = 34;
    const tray = new Rectangle(chamber.x + 10, chamber.y + chamber.height - trayH - 8, chamber.width - 20, trayH);
    const innerX = chamber.x + 10, innerW = chamber.width - 20, gap = 8;
    const cw = (innerW - gap * (slots - 1)) / slots;
    const colTop = chamber.y + 22, colBottom = tray.y - 8;
    const cols: Rectangle[] = [];
    for (let i = 0; i < slots; i++) cols.push(new Rectangle(innerX + i * (cw + gap), colTop, cw, colBottom - colTop));
    const fr = clamp(Math.min(coolW - 36, (h - 120) / 2) / 2, 22, 44);
    const fan = { x: cool.x + cool.width / 2, y: cool.y + (compact ? 22 + fr : 30 + fr), r: fr };
    const gr = clamp(coolW / 2 - 22, 24, 38);
    const gauge = { x: cool.x + cool.width / 2, y: fan.y + fr + 18 + gr, r: gr };
    const focus = compact ? { x: chamber.x + chamber.width / 2, y: chamber.y + 4 } : { x: chamber.x + 2, y: chamber.y + chamber.height * 0.46 };
    this.geo = { w, h, compact, mirror, chamber, cool, focus, fan, gauge, tray, cols };
    this.buildStatic(slots);
  }

  slotRect(i: number): Rectangle | null {
    const c = this.geo?.cols[i];
    return c ? new Rectangle(this.x + c.x, this.y + c.y, c.width, c.height) : null;
  }

  trayRect(): Rectangle | null {
    const g = this.geo;
    return g ? new Rectangle(this.x + g.tray.x, this.y + g.tray.y, g.tray.width, g.tray.height) : null;
  }

  private buildStatic(slots: number): void {
    const g = this.geo;
    if (!g) return;
    const b = this.back;
    b.clear();
    // espelhos
    drawPanel(b, g.mirror.x, g.mirror.y, g.mirror.width, g.mirror.height, { fill: C.panel, line: mix(C.panelLine, C.gold, 0.25), radius: 12, lip: 3 });
    // câmara: corpo de metal com borda grossa
    const ch = g.chamber;
    drawPanel(b, ch.x, ch.y, ch.width, ch.height, { fill: C.metal, line: C.metalHi, radius: 14, lip: 3 });
    // chaminé
    b.roundRect(ch.x + ch.width / 2 - 14, ch.y - 7, 28, 14, 4).fill({ color: C.metalLo });
    b.roundRect(ch.x + ch.width / 2 - 14, ch.y - 7, 28, 14, 4).stroke({ width: 1.2, color: C.metalHi });
    // resfriamento
    drawPanel(b, g.cool.x, g.cool.y, g.cool.width, g.cool.height, { fill: C.panel, line: mix(C.panelLine, C.ice, 0.3), radius: 12, lip: 3 });
    // duto entre a ventoinha e a câmara
    const duct = { x0: ch.x + ch.width, x1: g.cool.x, y: g.fan.y };
    if (!g.compact) {
      b.rect(duct.x0 - 2, duct.y - 6, duct.x1 - duct.x0 + 4, 12).fill({ color: C.metalLo });
      b.rect(duct.x0 - 2, duct.y - 6, duct.x1 - duct.x0 + 4, 12).stroke({ width: 1, color: C.metalHi, alpha: 0.7 });
    }
    // tray
    this.front.clear();
    // interior da câmara é redesenhado a cada quadro (muda de cor); o chão e as paredes ficam aqui
    // ventoinha: carcaça, hastes e cubo
    const f = g.fan;
    this.fanBox.position.set(f.x, f.y);
    this.rotor.removeChildren().forEach((c) => c.destroy());
    const housing = new Graphics();
    housing.circle(0, 0, f.r + 7).fill({ color: C.metalLo });
    housing.circle(0, 0, f.r + 7).stroke({ width: 2, color: C.metalHi });
    housing.circle(0, 0, f.r + 1).fill({ color: C.chamber });
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 4;
      housing.moveTo(Math.cos(a) * (f.r + 7), Math.sin(a) * (f.r + 7)).lineTo(-Math.cos(a) * (f.r + 7), -Math.sin(a) * (f.r + 7));
    }
    housing.stroke({ width: 1, color: C.metalHi, alpha: 0.25 });
    this.fanBox.addChildAt(housing, 0);
    // pás: cinco, cada uma uma gota achatada, em um contêiner que gira
    const blades = new Graphics();
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a), cp = Math.cos(a + 1.1), sp = Math.sin(a + 1.1);
      const rr = f.r * 0.96;
      blades.poly([0, 0, ca * rr * 0.55 + cp * rr * 0.34, sa * rr * 0.55 + sp * rr * 0.34, ca * rr, sa * rr, ca * rr * 0.8 - cp * rr * 0.1, sa * rr * 0.8 - sp * rr * 0.1]).fill({ color: C.ice, alpha: 0.9 });
      blades.poly([0, 0, ca * rr, sa * rr, ca * rr * 0.8 - cp * rr * 0.1, sa * rr * 0.8 - sp * rr * 0.1]).fill({ color: 0xffffff, alpha: 0.16 });
    }
    blades.circle(0, 0, f.r * 0.24).fill({ color: C.metalHi }).circle(0, 0, f.r * 0.1).fill({ color: C.metalLo });
    this.rotor.addChild(blades);
    // termômetro: trilho do arco
    this.gaugeG.clear();
    this.placeTexts(slots);
    this.buildMirrors();
    this.buildSlots(slots);
    this.heatGlow.position.set(ch.x + ch.width / 2, ch.y + ch.height * 0.5);
    this.heatGlow.width = ch.width * 1.5;
    this.heatGlow.height = ch.height * 1.5;
  }

  private placeTexts(_slots: number): void {
    const g = this.geo;
    if (!g) return;
    setText(this.lblMirror, t('craft.k.mirrors'));
    this.lblMirror.position.set(g.mirror.x + 10, g.mirror.y + g.mirror.height - (g.compact ? 16 : 34));
    this.kwText.position.set(g.mirror.x + 10, g.mirror.y + g.mirror.height - (g.compact ? 16 : 20));
    if (g.compact) {
      this.lblMirror.position.set(g.mirror.x + 10, g.mirror.y + 6);
      this.kwText.position.set(g.mirror.x + g.mirror.width - 70, g.mirror.y + 4);
    }
    setText(this.lblFan, 'RESFRIAMENTO');
    this.lblFan.position.set(g.cool.x + g.cool.width / 2, g.cool.y + 9);
    const dy = g.compact ? g.gauge.r + 12 : g.gauge.r * 0.58;
    this.tempTextObj.position.set(g.gauge.x, g.gauge.y + dy);
    this.statusTxt.position.set(g.gauge.x, g.gauge.y + dy + 19);
    setText(this.lblTray, t('craft.k.slot') === 'V' ? 'BANDEJA' : 'BANDEJA');
    this.lblTray.position.set(g.tray.x + 10, g.tray.y + 5);
  }

  private buildMirrors(): void {
    const g = this.geo;
    if (!g) return;
    this.mirrorLayer.removeChildren().forEach((c) => c.destroy());
    this.mirrorPlates = [];
    const n = g.compact ? 6 : 4;
    const m = g.mirror;
    // sol
    this.sun.position.set(m.x + (g.compact ? 34 : 30), m.y + (g.compact ? 30 : 34));
    this.sunGlow.width = this.sunGlow.height = g.compact ? 70 : 90;
    const core = new Graphics();
    core.circle(0, 0, 11).fill({ color: C.gold }).circle(0, 0, 11).stroke({ width: 2, color: 0xfff1b8 });
    core.circle(-3, -3, 4).fill({ color: 0xffffff, alpha: 0.5 });
    this.sunCore?.destroy();
    this.sunCore = core;
    this.sun.addChild(core);
    this.sunRays.clear();
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      this.sunRays.moveTo(Math.cos(a) * 15, Math.sin(a) * 15).lineTo(Math.cos(a) * (k % 2 ? 20 : 24), Math.sin(a) * (k % 2 ? 20 : 24));
    }
    this.sunRays.stroke({ width: 2.2, color: C.gold, alpha: 0.9 });
    // as placas: um poste e um espelho que acompanha o sol
    const baseY = g.compact ? m.y + m.height - 12 : m.y + m.height - 62;
    for (let i = 0; i < n; i++) {
      const x = g.compact ? m.x + 90 + (i * (m.width - 130)) / (n - 1) : m.x + 20 + (i * (m.width - 40)) / (n - 1);
      const c = new Container();
      c.position.set(x, baseY);
      const post = new Graphics();
      post.roundRect(-2, 0, 4, 12, 1.5).fill({ color: C.metalHi });
      post.roundRect(-8, 10, 16, 4, 2).fill({ color: C.metalLo });
      const plate = new Container();
      const pg = new Graphics();
      const pw = g.compact ? 13 : 15;
      pg.roundRect(-pw, -3, pw * 2, 6, 2.5).fill({ color: 0xbfeaff });
      pg.roundRect(-pw, -3, pw * 2, 6, 2.5).stroke({ width: 1.2, color: C.metalHi });
      pg.roundRect(-pw + 2, -2.2, pw * 1.1, 1.6, 0.8).fill({ color: 0xffffff, alpha: 0.7 });
      plate.addChild(pg);
      c.addChild(post, plate);
      this.mirrorLayer.addChild(c);
      this.mirrorPlates.push(plate);
    }
  }

  private buildSlots(n: number): void {
    const g = this.geo;
    if (!g) return;
    for (const s of this.slots) s.root.destroy({ children: true });
    this.slots = [];
    this.slotLayer.removeChildren();
    for (let i = 0; i < n; i++) {
      const col = g.cols[i];
      const root = new Container();
      root.position.set(col.x, col.y);
      const gfx = new Graphics();
      const head = txt(`${t('craft.k.slot')}${i + 1}`, { size: 10.5, weight: '700', title: true, fill: C.dim });
      head.position.set(3, 0);
      const clk = txt('', { size: 10.5, weight: '600', title: true, fill: C.orange, ax: 1 });
      clk.position.set(col.width - 3, 0);
      const step = txt('', { size: 9.5, fill: C.dim, ax: 0.5 });
      step.position.set(col.width / 2, col.height - 11);
      const units = txt('', { size: 10.5, title: true, weight: '600', fill: C.ok });
      units.position.set(18, col.height - 28);
      const out = this.deps.icons.sprite(undefined, 14);
      out.position.set(9, col.height - 22);
      const free = new Container();
      const plus = new Graphics();
      plus.moveTo(-7, 0).lineTo(7, 0).moveTo(0, -7).lineTo(0, 7).stroke({ width: 2, color: C.faint, alpha: 0.7 });
      const fl = txt(t('craft.k.free'), { size: 9, weight: '600', fill: C.faint, ax: 0.5, spacing: 1.4 });
      fl.position.set(0, 16);
      free.addChild(plus, fl);
      free.position.set(col.width / 2, col.height * 0.42);
      root.addChild(gfx, free, head, clk, step, out, units);
      root.eventMode = 'static';
      root.hitArea = new Rectangle(-2, -2, col.width + 4, col.height + 4);
      root.on('pointertap', () => this.onSlotTap?.(i));
      this.slotLayer.addChild(root);
      this.slots.push({ root, g: gfx, head, clock: clk, step, units, free, out, level: 0, seen: -1, key: '', boom: 0 });
    }
  }

  // ---------- quadro a quadro ----------

  update(dt: number, st: SceneState): void {
    const g = this.geo;
    if (!g) return;
    dt = Math.min(dt, 0.1);
    this.time += dt;
    const target = targetTemp(st.jobs, st.sun);
    this.thermal.update(dt, target);
    const th = this.thermal;
    const working = st.jobs.some((j) => j && !j.ready && !j.paused && !j.leftover);
    this.limit = Math.max(1200, ...st.jobs.map((j) => (j && !j.ready ? j.recipe.process.temp ?? 1200 : 0)));
    this.drawChamber(th.temp, th.heat);
    this.drawMirrors(st.sun, dt);
    this.drawFan(dt);
    this.drawGauge(th.temp, working, st);
    this.drawSlots(dt, st);
    this.spawnFx(dt, st);
    this.particles.update(dt);
    this.updateTokens(dt);
    this.drawTray(st);
    this.drawShimmer(th.heat);
  }

  /** o fundo da câmara e o brilho do calor */
  private drawChamber(temp: number, heat: number): void {
    const g = this.geo;
    if (!g) return;
    if (Math.abs(temp - this.lastTemp) < 0.4 && this.lastTemp >= 0) return;
    this.lastTemp = temp;
    const ch = g.chamber;
    const hc = heatColor(temp);
    const f = this.chamberFill;
    f.clear();
    // o calor sobe do chão: mais escuro no teto, mais quente embaixo
    const grad = new FillGradient({
      type: 'linear', start: { x: 0, y: 0 }, end: { x: 0, y: 1 }, textureSpace: 'local',
      colorStops: [{ offset: 0, color: mix(C.chamber, hc, 0.06 + 0.16 * heat) }, { offset: 1, color: mix(C.chamber, hc, 0.2 + 0.5 * heat) }],
    });
    f.roundRect(ch.x + 6, ch.y + 6, ch.width - 12, ch.height - 12, 10).fill(grad);
    // chão da câmara: faixa mais clara sob os cadinhos
    f.roundRect(ch.x + 6, g.tray.y - 12, ch.width - 12, 6, 3).fill({ color: mix(C.metalLo, hc, 0.25 + 0.4 * heat) });
    this.heatGlow.tint = hc;
    this.heatGlow.alpha = 0.08 + 0.34 * heat;
  }

  private drawMirrors(sun: number, dt: number): void {
    const g = this.geo;
    if (!g) return;
    this.sunGlow.alpha = 0.15 + 0.55 * sun + 0.06 * Math.sin(this.time * 2);
    this.sunRays.rotation += dt * (0.2 + 0.5 * sun);
    const n = this.mirrorPlates.length;
    const bl = this.beams;
    bl.clear();
    let pi = 0;
    for (let i = 0; i < n; i++) {
      const plate = this.mirrorPlates[i];
      const base = plate.parent;
      if (!base) continue;
      const px = base.x, py = base.y;
      // o espelho aponta entre o sol e o foco (metade do ângulo)
      const toSun = Math.atan2(this.sun.y - py, this.sun.x - px);
      const toFocus = Math.atan2(g.focus.y - py, g.focus.x - px);
      plate.rotation = (toSun + toFocus) / 2 + Math.PI / 2 + Math.sin(this.time * 0.3 + i) * 0.03;
      const a = 0.06 + 0.5 * sun;
      bl.moveTo(this.sun.x, this.sun.y).lineTo(px, py).stroke({ width: 1, color: C.gold, alpha: a * 0.35 });
      bl.moveTo(px, py).lineTo(g.focus.x, g.focus.y).stroke({ width: 1.6, color: 0xfff1b8, alpha: a });
      // pacotes de luz correndo pelo feixe
      for (let k = 0; k < 3; k++) {
        const p = this.packets[pi++];
        if (!p) continue;
        const u = (this.time * (0.25 + 0.7 * sun) + i * 0.31 + k / 3) % 1;
        p.position.set(px + (g.focus.x - px) * u, py + (g.focus.y - py) * u);
        p.width = p.height = 8;
        p.alpha = sun * 0.9;
        p.visible = sun > 0.02;
      }
    }
    for (; pi < this.packets.length; pi++) this.packets[pi].visible = false;
    setText(this.kwText, `${(6 * sun).toFixed(1)} kW`);
  }

  private drawFan(dt: number): void {
    const g = this.geo;
    if (!g) return;
    const th = this.thermal;
    this.rotor.rotation = th.angle;
    // com a ventoinha rápida as pás viram um borrão
    const f = g.fan;
    this.blur.clear();
    if (th.fan > 0.3) this.blur.circle(0, 0, f.r).fill({ color: C.ice, alpha: 0.28 * (th.fan - 0.3) });
    this.rotor.alpha = 1 - 0.35 * clamp((th.fan - 0.4) / 0.6, 0, 1);
    void dt;
  }

  private drawGauge(temp: number, working: boolean, st: SceneState): void {
    const g = this.geo;
    if (!g) return;
    const { x, y, r } = g.gauge;
    const a0 = Math.PI * 0.8, a1 = Math.PI * 2.2;
    const frac = clamp((temp - AMBIENT) / (MAX_TEMP - AMBIENT), 0, 1);
    const gg = this.gaugeG;
    gg.clear();
    gg.arc(x, y, r, a0, a1).stroke({ width: 7, color: C.metalLo, cap: 'round' });
    if (frac > 0.01) gg.arc(x, y, r, a0, a0 + (a1 - a0) * frac).stroke({ width: 7, color: heatColor(temp), cap: 'round' });
    // marca do limite do processo
    const lm = a0 + (a1 - a0) * clamp((this.limit - AMBIENT) / (MAX_TEMP - AMBIENT), 0, 1);
    gg.moveTo(x + Math.cos(lm) * (r - 7), y + Math.sin(lm) * (r - 7)).lineTo(x + Math.cos(lm) * (r + 6), y + Math.sin(lm) * (r + 6)).stroke({ width: 2, color: C.warn });
    // ponteiro: vai até o valor com um pouco de mola
    const want = a0 + (a1 - a0) * frac;
    this.needleAng += (want - this.needleAng) * 0.18;
    const n = this.needle;
    n.clear();
    const na = this.needleAng || a0;
    n.moveTo(x, y).lineTo(x + Math.cos(na) * (r - 11), y + Math.sin(na) * (r - 11)).stroke({ width: 2.4, color: C.ink, cap: 'round' });
    n.circle(x, y, 3.2).fill({ color: C.ink });
    setText(this.tempTextObj, tempText(temp));
    const th = this.thermal;
    let s: string;
    let col: number;
    if (working && temp < target(st) - 40) [s, col] = ['ESQUENTANDO', C.orange];
    else if (working) [s, col] = ['TRABALHANDO', C.ok];
    else if (th.cooling) [s, col] = ['ESFRIANDO', C.ice];
    else [s, col] = ['EM ESPERA', C.faint];
    setText(this.statusTxt, s);
    this.statusTxt.style.fill = col;
    fitWidth(this.statusTxt, g.cool.width - 12);
  }

  private drawSlots(dt: number, st: SceneState): void {
    const g = this.geo;
    if (!g) return;
    for (let i = 0; i < this.slots.length; i++) {
      const sv = this.slots[i];
      const col = g.cols[i];
      const j = st.jobs[i] ?? null;
      const gf = sv.g;
      gf.clear();
      const sel = st.selected === i;
      // casinha da coluna
      const edge = sel ? C.ice : j?.ready ? C.ok : j && !j.paused ? mix(C.orange, C.metalHi, 0.3) : C.metalHi;
      gf.roundRect(0, 0, col.width, col.height, 9).fill({ color: 0x000000, alpha: 0.22 });
      if (!j) gf.roundRect(0, 0, col.width, col.height, 9).stroke({ width: 1.2, color: edge, alpha: 0.35 });
      else gf.roundRect(0, 0, col.width, col.height, 9).stroke({ width: sel ? 2.4 : 1.4, color: edge, alpha: sel ? 1 : 0.75 });
      sv.free.visible = !j;
      sv.head.style.fill = j ? C.ink : C.faint;
      const bowlW = Math.min(col.width - 10, 86);
      const bowlH = clamp(col.height * 0.34, 32, 56);
      const cx = col.width / 2, top = 28;
      // cadinho vazio: contorno
      this.drawBowl(gf, cx, top, bowlW, bowlH, j, sv, dt, st);
      // unidades
      sv.units.visible = sv.step.visible = sv.out.visible = sv.clock.visible = !!j;
      if (!j) {
        sv.key = '';
        sv.seen = -1;
        sv.level = Math.max(0, sv.level - dt * 2);
        continue;
      }
      this.cellsRow(gf, col, j, top + bowlH + 12);
      setText(sv.clock, j.paused ? t('craft.k.paused') : j.ready ? t('craft.k.done') : clock(j.remaining));
      sv.clock.style.fill = j.paused ? C.gold : j.ready ? C.ok : C.orange;
      const stepTxt = j.ready ? t('craft.k.done') : (j.recipe.process.steps[j.step] ?? '');
      setText(sv.step, stepTxt);
      fitWidth(sv.step, col.width - 8);
      setText(sv.units, `${j.units}/${j.batch}`);
      sv.units.style.fill = j.waitingCount ? C.ok : C.faint;
      const src = this.deps.outIcon(j.recipe);
      const o = sv.out as Sprite & { _src?: string };
      if (o._src !== src) {
        o._src = src;
        o.texture = Texture.EMPTY;
      }
      this.deps.icons.sync(o);
    }
  }

  /** o cadinho: casco de metal, conteúdo derretido que sobe com a unidade, borda brilhando com o calor */
  private drawBowl(gf: Graphics, cx: number, top: number, w: number, h: number, j: JobView | null, sv: SlotView, dt: number, st: SceneState): void {
    const rx = w / 2;
    const th = this.thermal;
    const hc = heatColor(th.temp);
    // pontos do casco (curva suave sob a borda)
    const pts: [number, number][] = [];
    for (let k = 0; k <= 14; k++) {
      const u = k / 14;
      const x = cx - rx + w * u;
      const y = top + h * (1 - Math.pow(Math.abs(u * 2 - 1), 2.2)) * 0.98;
      pts.push([x, y]);
    }
    const poly = (arr: [number, number][]): number[] => arr.flatMap(([x, y]) => [x, y]);
    // sombra no chão da câmara
    gf.ellipse(cx, top + h + 4, rx * 0.95, 4).fill({ color: 0x000000, alpha: 0.3 });
    if (!j) {
      gf.poly(poly(pts)).fill({ color: C.metalLo, alpha: 0.55 });
      gf.poly(poly(pts)).stroke({ width: 1.4, color: C.metalHi, alpha: 0.6 });
      gf.ellipse(cx, top, rx, 5).stroke({ width: 1.4, color: C.metalHi, alpha: 0.6 });
      sv.level = Math.max(0, sv.level - dt * 2);
      return;
    }
    const tint = this.deps.tint(j.recipe);
    const working = !j.ready && !j.paused;
    // nível do que está derretendo: sobe com o progresso da unidade; pronta, fica cheio e esfria
    const want = j.ready ? 1 : clamp(0.18 + j.unitProgress * 0.7, 0, 0.92);
    sv.level += (want - sv.level) * (1 - Math.exp(-dt * 6));
    const surf = top + h * (1 - sv.level * 0.82) - 1;
    // casco
    gf.poly(poly(pts)).fill({ color: mix(0x1a1535, hc, 0.12 * th.heat) });
    // conteúdo
    const filled = pts.map(([x, y]) => [x, Math.max(y, surf + 2)] as [number, number]);
    const hot = working ? mix(heatColor(Math.min(th.temp, 1280)), tint, 0.16 + 0.08 * Math.sin(this.time * 6 + sv.root.x)) : j.ready ? shade(tint, -0.2) : mix(tint, C.faint, 0.6);
    gf.poly(poly(filled)).fill({ color: hot });
    gf.ellipse(cx, surf, rx * Math.min(1, 0.55 + 0.45 * ((surf - top) / h + 0.4)), 4.4).fill({ color: shade(hot, working ? 0.3 : 0.1) });
    // casco por cima (aro) e brilho
    gf.poly(poly(pts)).stroke({ width: 1.8, color: mix(C.metalHi, hc, 0.35 * th.heat) });
    gf.ellipse(cx, top, rx, 5).stroke({ width: 1.6, color: mix(C.metalHi, hc, 0.4 * th.heat) });
    gf.ellipse(cx - rx * 0.45, top + h * 0.45, 2.2, 6).fill({ color: 0xffffff, alpha: 0.12 });
    if (working) {
      // halo do calor embaixo do cadinho
      gf.ellipse(cx, top + h + 2, rx * 1.1, 6).fill({ color: hc, alpha: 0.18 + 0.2 * th.heat });
    }
    // chegou uma unidade nova: um anel que abre
    if (sv.boom > 0) {
      sv.boom -= dt * 2;
      const u = 1 - sv.boom;
      gf.ellipse(cx, top + h * 0.55, rx * (0.6 + u * 0.9), 5 + u * 8).stroke({ width: 2.2, color: C.ok, alpha: Math.max(0, sv.boom) });
    }
    void st;
  }

  private cellsRow(gf: Graphics, col: Rectangle, j: JobView, y: number): void {
    const n = Math.min(j.batch, 12);
    const w = Math.min(15, (col.width - 12 - (n - 1) * 3) / n);
    const total = n * w + (n - 1) * 3;
    const x0 = (col.width - total) / 2;
    for (let k = 0; k < n; k++) {
      const frac = n === j.batch ? 1 : j.batch / n;
      const unitsDone = j.units / frac;
      const done = k < Math.floor(unitsDone + 1e-6);
      const now = !done && k === Math.floor(unitsDone + 1e-6) && !j.ready;
      const x = x0 + k * (w + 3);
      gf.roundRect(x, y, w, 9, 2.5).fill({ color: done ? C.ok : 0xffffff, alpha: done ? 0.9 : 0.06 });
      if (now) gf.roundRect(x, y + 9 * (1 - j.unitProgress), w, 9 * j.unitProgress, 2.5).fill({ color: j.paused ? C.gold : C.orange });
      gf.roundRect(x, y, w, 9, 2.5).stroke({ width: 1, color: done ? C.ok : now ? (j.paused ? C.gold : C.orange) : C.faint, alpha: done ? 1 : 0.7 });
    }
  }

  /** ondas de calor subindo sobre os cadinhos */
  private drawShimmer(heat: number): void {
    const g = this.geo;
    const s = this.shimmer;
    s.clear();
    if (!g || heat < 0.2) return;
    const ch = g.chamber;
    const n = 5;
    for (let k = 0; k < n; k++) {
      const x0 = ch.x + 18 + ((ch.width - 36) * (k + 0.5)) / n;
      const phase = (this.time * 0.5 + k * 0.23) % 1;
      const yy = ch.y + ch.height * 0.62 - phase * ch.height * 0.45;
      s.moveTo(x0, yy);
      for (let u = 1; u <= 6; u++) s.lineTo(x0 + Math.sin(this.time * 3 + k + u * 0.9) * 3, yy - u * 4);
      s.stroke({ width: 1.2, color: 0xffd9a0, alpha: 0.22 * heat * Math.sin(Math.PI * phase) });
    }
  }

  // ---------- partículas ----------

  private spawnFx(dt: number, st: SceneState): void {
    const g = this.geo;
    if (!g) return;
    const th = this.thermal;
    const P = this.particles;
    const ch = g.chamber;
    // fagulhas e bolhas dos cadinhos que trabalham
    this.sparkAcc += dt;
    this.bubbleAcc += dt;
    for (let i = 0; i < this.slots.length; i++) {
      const j = st.jobs[i];
      if (!j || j.ready || j.paused || j.leftover) continue;
      const col = g.cols[i];
      const cx = ch.x + 0 + col.x - ch.x + col.width / 2;
      const by = col.y + 28;
      if (this.sparkAcc > 0.05) {
        for (let q = 0; q < 2; q++)
          P.glow.spawn({
            x: cx + rnd(-16, 16), y: by + 4, vx: rnd(-34, 34), vy: rnd(-95, -35), ay: 140, size: rnd(4, 8), life: rnd(0.6, 1.2),
            color: 0xffe08a, to: 0xff4a12, alpha: 1, drag: 0.35,
          });
      }
      if (this.bubbleAcc > 0.18) {
        P.glow.spawn({ x: cx + rnd(-16, 16), y: by + 12, vx: 0, vy: rnd(-16, -8), size: rnd(3, 5), life: rnd(0.4, 0.7), color: 0xfff1b8, alpha: 0.9 });
      }
    }
    if (this.sparkAcc > 0.05) this.sparkAcc = 0;
    if (this.bubbleAcc > 0.18) this.bubbleAcc = 0;
    // fumaça da chaminé
    this.smokeAcc += dt * (0.5 + 5 * th.heat);
    if (th.heat > 0.25 && this.smokeAcc > 1) {
      this.smokeAcc = 0;
      P.smoke.spawn({
        x: ch.x + ch.width / 2 + rnd(-4, 4), y: ch.y - 8, vx: rnd(-8, 12), vy: rnd(-34, -20), size: rnd(10, 16), growTo: 2.6, life: rnd(1.6, 2.6),
        color: 0x8e86b8, to: 0x3a3470, alpha: 0.5, drag: 0.6,
      });
    }
    // ar da ventoinha: sai da carcaça e vai embora
    this.airAcc += dt * th.fan * 22;
    while (this.airAcc >= 1) {
      this.airAcc -= 1;
      const f = g.fan;
      const a = rnd(-0.9, 0.9);
      P.glow.spawn({
        x: f.x + (g.compact ? 0 : f.r * 0.4), y: f.y + rnd(-f.r * 0.5, f.r * 0.5), vx: 40 + 150 * th.fan, vy: Math.sin(a) * 26, size: rnd(5, 9), growTo: 1.6,
        life: rnd(0.5, 0.9), color: C.ice, to: 0x3b5fff, alpha: 0.4 * th.fan + 0.1, drag: 1.1,
      });
    }
    // brilhos nos espelhos quando há sol
    if (st.sun > 0.3 && Math.random() < dt * 3 * st.sun) {
      const m = this.mirrorPlates[(Math.random() * this.mirrorPlates.length) | 0];
      const base = m?.parent;
      if (base) P.glow.spawn({ x: base.x + rnd(-10, 10), y: base.y - 2, vx: 0, vy: -10, size: rnd(5, 9), life: 0.5, color: 0xffffff, alpha: 0.9 });
    }
  }

  /** Um minério cai no cadinho (começou uma unidade) ou uma barra sai para a bandeja (uma unidade ficou pronta). */
  private checkUnits(st: SceneState): void {
    const g = this.geo;
    if (!g) return;
    for (let i = 0; i < this.slots.length; i++) {
      const sv = this.slots[i];
      const j = st.jobs[i];
      if (!j) continue;
      const key = `${j.recipe.id}:${j.batch}:${j.slot}`;
      const col = g.cols[i];
      const cx = col.x + col.width / 2;
      if (sv.key !== key) {
        sv.key = key;
        sv.seen = j.units;
        // começo do trabalho: o minério cai no cadinho
        this.dropOre(j, cx, col.y);
        continue;
      }
      if (j.units > sv.seen) {
        sv.boom = 1;
        const tray = g.tray;
        for (let k = sv.seen; k < j.units; k++) {
          const src = this.deps.outIcon(j.recipe);
          const spr = this.deps.icons.sprite(src, 16);
          this.tokenLayer.addChild(spr);
          this.tokens.push({ spr, x0: cx, y0: col.y + 40, x1: tray.x + 40 + k * 14, y1: tray.y + tray.height / 2 + 2, t: -(k - sv.seen) * 0.12, dur: 0.7, arc: 22 });
          for (let q = 0; q < 8; q++) {
            this.particles.glow.spawn({ x: cx, y: col.y + 44, vx: rnd(-80, 80), vy: rnd(-110, -30), ay: 220, size: rnd(3, 6), life: rnd(0.4, 0.8), color: 0xfff1b8, to: C.orange, alpha: 1, drag: 0.5 });
          }
          // a próxima unidade: mais minério entra
          if (k + 1 < j.batch) this.dropOre(j, cx, col.y);
        }
        sv.seen = j.units;
      }
    }
  }

  private dropOre(j: JobView, cx: number, y: number): void {
    const items = Object.keys(j.recipe.inputs) as ItemId[];
    items.slice(0, 2).forEach((item, k) => {
      const spr = this.deps.icons.sprite(this.deps.itemIcon(item), 14);
      this.tokenLayer.addChild(spr);
      this.tokens.push({ spr, x0: cx + (k - 0.5) * 14, y0: y - 6, x1: cx + (k - 0.5) * 8, y1: y + 40, t: -k * 0.1, dur: 0.55, arc: -8 });
    });
  }

  private updateTokens(dt: number): void {
    for (let i = this.tokens.length - 1; i >= 0; i--) {
      const k = this.tokens[i];
      k.t += dt;
      if (k.t < 0) {
        k.spr.visible = false;
        continue;
      }
      if (k.t >= k.dur) {
        k.spr.destroy();
        this.tokens.splice(i, 1);
        continue;
      }
      const u = k.t / k.dur, e = u * u * (3 - 2 * u);
      k.spr.visible = true;
      this.deps.icons.sync(k.spr);
      k.spr.position.set(k.x0 + (k.x1 - k.x0) * e, k.y0 + (k.y1 - k.y0) * e - Math.sin(Math.PI * u) * k.arc);
      k.spr.alpha = u > 0.85 && k.arc < 0 ? 1 - (u - 0.85) / 0.15 : 1;
    }
  }

  // ---------- bandeja ----------

  private trayKey = '';

  private drawTray(st: SceneState): void {
    const g = this.geo;
    if (!g) return;
    this.checkUnits(st);
    const tr = g.tray;
    const waiting = new Map<ItemId, number>();
    for (const j of st.jobs) if (j) for (const [it, n] of Object.entries(j.waiting) as [ItemId, number][]) waiting.set(it, (waiting.get(it) ?? 0) + n);
    const key = [...waiting.entries()].map(([k, n]) => `${k}${n}`).join(',');
    const ov = this.overlay;
    ov.clear();
    ov.roundRect(tr.x, tr.y, tr.width, tr.height, 9).fill({ color: 0x000000, alpha: 0.3 });
    ov.roundRect(tr.x, tr.y, tr.width, tr.height, 9).stroke({ width: 1.2, color: waiting.size ? C.ok : C.metalHi, alpha: waiting.size ? 0.9 : 0.5 });
    setText(this.lblTray, waiting.size ? 'PRONTO' : 'BANDEJA');
    this.lblTray.style.fill = waiting.size ? C.ok : C.faint;
    if (key !== this.trayKey) {
      this.trayKey = key;
      this.trayIcons.removeChildren().forEach((c) => c.destroy({ children: true }));
      let x = tr.x + 14 + 56;
      for (const [item, n] of waiting) {
        const s = this.deps.icons.sprite(this.deps.itemIcon(item), 20);
        s.position.set(x, tr.y + tr.height / 2 + 3);
        const c = txt(`×${n}`, { title: true, size: 12, fill: C.ok, ay: 0.5 });
        c.position.set(x + 13, tr.y + tr.height / 2 + 3);
        this.trayIcons.addChild(s, c);
        x += 54;
      }
    }
    for (const c of this.trayIcons.children) if (c instanceof Sprite) this.deps.icons.sync(c);
  }

  /** limpa efeitos (a tela fechou ou trocou de estação) */
  reset(): void {
    this.particles.clear();
    for (const k of this.tokens) k.spr.destroy();
    this.tokens = [];
    this.thermal.temp = AMBIENT;
    this.thermal.fan = 0;
    this.trayKey = '';
    this.lastTemp = -1;
    for (const s of this.slots) {
      s.key = '';
      s.seen = -1;
      s.level = 0;
    }
  }

  /** quantas partículas vivas (para teste e para o teste de desempenho) */
  get particleCount(): number {
    return this.particles.active;
  }
}

function target(st: SceneState): number {
  return targetTemp(st.jobs, st.sun);
}
