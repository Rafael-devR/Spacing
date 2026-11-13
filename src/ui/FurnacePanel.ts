// Tela cheia do forno solar em PixiJS (docs/design/FORNO.md, ADR 0018). Substitui, só para o forno, a tela em Canvas 2D
// (ui/CraftPanel.ts). Tem a mesma interface (show, close, open, onCraft…) para o resto do jogo não notar. O Pixi tem canvas e
// contexto WebGL próprios, e o relógio fica parado enquanto a tela está fechada. As regras de fabricação continuam em
// systems/Crafting.ts: aqui só se lê e se pede.
import { Application, Container, Graphics, Rectangle, Sprite } from 'pixi.js';
import { EQUIPMENT, type EquipId } from '../data/equipment';
import { ITEMS, type ItemId } from '../data/items';
import { batchable, MAX_BATCH, recipeById, recipeSeconds, unitSeconds, type Recipe, type RecipeOutput } from '../data/recipes';
import { STATIONS, type StationId } from '../data/stations';
import { t } from '../i18n';
import type { Crafting, JobView } from '../systems/Crafting';
import { FurnaceScene } from './furnace/furnaceScene';
import { drawPanel, fitWidth, IconCache, PButton, ScrollList, setText, setTextResolution, txt, type ListItem } from './furnace/pixiKit';
import { C, hexNum, mix } from './furnace/theme';
import type { EnergyView } from './CraftPanel';

const STATION: StationId = 'furnace';

type Icons = { items: Record<ItemId, string>; equip: Record<EquipId, string>; stations: Partial<Record<StationId, string>> };

const outName = (o: RecipeOutput): string =>
  o.kind === 'item' ? ITEMS[o.item].name : o.kind === 'equip' ? EQUIPMENT[o.equip].name : STATIONS[o.station].name;

/** 130 → "2 min 10 s"; 8.4 → "8 s" */
function humanTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return t('craft.noEnergy');
  const s = Math.max(1, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60), ss = s % 60;
  return ss ? `${m} min ${ss} s` : `${m} min`;
}

const clockText = (seconds: number): string => {
  if (!Number.isFinite(seconds)) return '--:--';
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export interface Target {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** espera as letras do jogo ficarem prontas (o Pixi mede o texto uma vez só) */
async function waitFonts(): Promise<void> {
  const fonts = document.fonts as FontFaceSet | undefined;
  if (!fonts?.load) return;
  const wanted = ['600 14px Fredoka', '700 14px Fredoka', '500 12px Rubik', '600 12px Rubik'];
  await Promise.race([Promise.all(wanted.map((f) => fonts.load(f).catch(() => []))), new Promise((r) => setTimeout(r, 1500))]);
}

export class FurnacePanel {
  onToggle: ((open: boolean) => void) | null = null;
  onCraft: ((r: Recipe, batch: number) => void) | null = null;
  onTake: ((station: StationId, slot?: number) => void) | null = null;
  onPause: ((station: StationId, slot: number) => void) | null = null;
  onCancel: ((station: StationId, slot: number) => void) | null = null;

  private readonly icons = new IconCache();
  private iconSrc: Icons = { items: {} as Record<ItemId, string>, equip: {} as Record<EquipId, string>, stations: {} };
  private readonly scene: FurnaceScene;
  private readonly list: ScrollList;
  private readonly bg = new Graphics();
  private readonly ctrlBg = new Graphics();
  private readonly header = new Container();
  private readonly btn = new Map<string, PButton>();
  private readonly title = txt('', { title: true, size: 19, weight: '600', fill: C.ink });
  private readonly tagline = txt('', { size: 10.5, fill: C.dim });
  private readonly chip = new Container();
  private readonly chipG = new Graphics();
  private readonly chipVal = txt('', { title: true, size: 14, fill: C.ok });
  private readonly chipLbl = txt('', { size: 8.5, weight: '600', fill: C.dim, spacing: 1.2 });
  private readonly listTitle = txt('', { size: 9, weight: '600', fill: C.faint, spacing: 1.6 });
  // controle de baixo
  private readonly ctrl = new Container();
  private readonly recipeRow = new Container();
  private readonly ctrlName = txt('', { title: true, size: 14, weight: '600', fill: C.ink });
  private readonly ctrlSub = txt('', { size: 10.5, fill: C.dim });
  private readonly batchTxt = txt('', { title: true, size: 15, ax: 0.5, ay: 0.5 });
  private readonly infoBox = new Container();
  private readonly infoG = new Graphics();
  private readonly infoReaction = txt('', { title: true, size: 12.5, fill: C.orange });
  private readonly infoSteps = txt('', { size: 10, weight: '600', fill: C.ink, spacing: 0.6 });
  private readonly infoNote = txt('', { size: 11, fill: C.dim, wrap: 300, lineHeight: 14 });
  // estado
  private W = 0;
  private H = 0;
  private safe = { l: 0, r: 0, t: 0, b: 0 };
  private landscape = true;
  private ctrlRect = new Rectangle();
  private machineRect = new Rectangle();
  private listRect = new Rectangle();
  private selected: string | null = null;
  private slotSel: number | null = null;
  private batch = 1;
  private info = false;
  private confirmCancel = -10;
  private time = 0;
  private listSig = '';
  private listTimer = 0;
  private rowSig = '';
  private dirty = true;

  private constructor(
    private readonly crafting: Crafting,
    private readonly energy: EnergyView,
    private readonly root: HTMLElement,
    private readonly app: Application,
  ) {
    const stage = app.stage;
    stage.eventMode = 'static';
    stage.hitArea = app.screen;
    this.scene = new FurnaceScene({
      icons: this.icons,
      outIcon: (r) => this.iconFor(r.outputs[0]),
      itemIcon: (it) => this.iconSrc.items[it],
      tint: (r) => {
        const o = r.outputs[0];
        return o.kind === 'item' ? hexNum(ITEMS[o.item].tint) : hexNum(STATIONS[STATION].accent);
      },
    });
    this.scene.onSlotTap = (i) => {
      const j = this.crafting.slots(STATION)[i];
      if (!j) return;
      this.slotSel = this.slotSel === i ? null : i;
      this.confirmCancel = -10;
      this.info = false;
      this.dirty = true;
    };
    this.list = new ScrollList(false);
    this.list.setFadeColor(C.panel);
    this.buildUi();
    stage.addChild(this.bg, this.scene, this.listFrame, this.list, this.listTitle, this.ctrlBg, this.ctrl, this.header);
    for (const b of this.btn.values()) if (b.parent === null) stage.addChild(b);
    app.ticker.add((tk) => this.update(tk.deltaMS / 1000));
    app.stop();
    root.hidden = true;
    new ResizeObserver(() => this.open && this.resize()).observe(root);
    window.addEventListener('resize', () => this.open && this.resize());
    app.canvas.addEventListener('wheel', (e) => {
      if (!this.open) return;
      const r = app.canvas.getBoundingClientRect();
      if (this.listRect.contains(e.clientX - r.left, e.clientY - r.top)) this.list.scrollBy(this.landscape ? e.deltaY : e.deltaX || e.deltaY);
      e.preventDefault();
    }, { passive: false });
  }

  private readonly listFrame = new Graphics();

  /** Cria o painel: espera as letras, liga o Pixi no canvas da tela. Rejeita se o WebGL não iniciar. */
  static async create(crafting: Crafting, energy: EnergyView, root: HTMLElement): Promise<FurnacePanel> {
    const canvas = root.querySelector('canvas');
    if (!canvas) throw new Error('canvas do forno não encontrado');
    await waitFonts();
    const app = new Application();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    await app.init({
      canvas, width: Math.max(300, window.innerWidth), height: Math.max(200, window.innerHeight), resolution: dpr, autoDensity: true,
      backgroundColor: C.bg, antialias: true, preference: 'webgl', autoStart: false, powerPreference: 'high-performance',
    });
    setTextResolution(dpr);
    return new FurnacePanel(crafting, energy, root, app);
  }

  // ---------- API do painel ----------

  get open(): boolean {
    return !this.root.hidden;
  }

  get current(): StationId {
    return STATION;
  }

  setIcons(items: Record<ItemId, string>, equip: Record<EquipId, string>, stations: Partial<Record<StationId, string>> = {}): void {
    this.iconSrc = { items, equip, stations };
    this.dirty = true;
  }

  show(): void {
    if (this.open) return;
    this.selected = null;
    this.slotSel = null;
    this.batch = 1;
    this.info = false;
    this.confirmCancel = -10;
    this.rowSig = '';
    this.listSig = '';
    this.list.scrollTo(0);
    this.scene.reset();
    this.root.hidden = false;
    this.resize();
    this.app.start();
    this.onToggle?.(true);
  }

  close(): void {
    if (!this.open) return;
    this.root.hidden = true;
    this.app.stop();
    this.onToggle?.(false);
  }

  /** o inventário ou o estado mudou: refaz a lista na próxima oportunidade */
  render(): void {
    this.dirty = true;
  }

  /** onde estão os botões e cartões agora (coordenadas da tela), para o teste no navegador */
  targets(): Record<string, Target> {
    const out: Record<string, Target> = {};
    const cr = this.app.canvas.getBoundingClientRect();
    const add = (id: string, r: Rectangle | null): void => {
      if (r && r.width > 0) out[id] = { x: cr.left + r.x, y: cr.top + r.y, w: r.width, h: r.height };
    };
    for (const [id, b] of this.btn) {
      const ha = b.hitArea as Rectangle | null;
      if (!b.visible || !b.renderable || !ha) continue;
      const p = b.getGlobalPosition();
      add(id, new Rectangle(p.x, p.y, ha.width - 6, ha.height - 9));
    }
    for (const j of this.crafting.slots(STATION)) if (j) add(`slot:${j.slot}`, this.scene.slotRect(j.slot));
    for (const r of this.crafting.recipes(STATION)) add(`r:${r.id}`, this.list.itemRect(`r:${r.id}`));
    return out;
  }

  /** estado interno para o teste */
  get debug(): { temp: number; fan: number; particles: number; selected: string | null; slotSel: number | null; batch: number; w: number; h: number } {
    return { temp: this.scene.thermal.temp, fan: this.scene.thermal.fan, particles: this.scene.particleCount, selected: this.selected, slotSel: this.slotSel, batch: this.batch, w: this.W, h: this.H };
  }

  // ---------- construção da interface ----------

  private iconFor(o: RecipeOutput): string | undefined {
    if (o.kind === 'item') return this.iconSrc.items[o.item];
    if (o.kind === 'equip') return this.iconSrc.equip[o.equip];
    return this.iconSrc.stations[o.station];
  }

  private button(id: string, onTap: () => void): PButton {
    const b = new PButton(id, onTap);
    this.btn.set(id, b);
    return b;
  }

  private buildUi(): void {
    const st = STATIONS[STATION];
    setText(this.title, st.name);
    setText(this.tagline, st.tagline);
    setText(this.listTitle, t('craft.k.recipes'));
    // cabeçalho
    const back = this.button('back', () => this.close());
    back.setLabel('‹');
    this.header.addChild(this.title, this.tagline, this.chip);
    this.chip.addChild(this.chipG, this.chipVal, this.chipLbl);
    setText(this.chipLbl, t('craft.k.sun').toUpperCase());
    this.header.addChild(back);
    // controle de baixo
    this.ctrl.addChild(this.recipeRow, this.ctrlName, this.ctrlSub, this.batchTxt);
    const minus = this.button('minus', () => (this.batch = Math.max(1, this.batch - 1)));
    const plus = this.button('plus', () => (this.batch = Math.min(this.topBatch(), this.batch + 1)));
    const max = this.button('max', () => (this.batch = this.topBatch()));
    const make = this.button('make', () => {
      const r = this.shown();
      if (r && this.crafting.check(r, this.batch).ok) this.onCraft?.(r, this.batch);
    });
    const info = this.button('info', () => (this.info = !this.info));
    minus.setLabel('−');
    plus.setLabel('+');
    max.setLabel(t('craft.all'));
    info.setLabel('?');
    const closeJob = this.button('close-job', () => (this.slotSel = null));
    closeJob.setLabel('×');
    const takeSlot = this.button('take-slot', () => this.slotSel !== null && this.onTake?.(STATION, this.slotSel));
    const pause = this.button('pause', () => this.slotSel !== null && this.onPause?.(STATION, this.slotSel));
    const cancel = this.button('cancel', () => {
      const i = this.slotSel;
      if (i === null) return;
      if (this.time - this.confirmCancel < 3) {
        this.onCancel?.(STATION, i);
        this.slotSel = null;
        this.confirmCancel = -10;
      } else this.confirmCancel = this.time;
    });
    const take = this.button('take', () => this.onTake?.(STATION));
    take.setLabel(t('craft.takeAll'));
    take.setTone('go');
    for (const b of [minus, plus, max, make, info, closeJob, takeSlot, pause, cancel]) this.ctrl.addChild(b);
    // ciência da receita
    this.infoBox.addChild(this.infoG, this.infoReaction, this.infoSteps, this.infoNote);
    this.infoBox.visible = false;
    this.ctrl.addChild(this.infoBox);
    // `take` fica por cima da bandeja, fora do controle (entra no palco depois de todos)
  }

  // ---------- tamanho ----------

  private resize(): void {
    const W = this.root.clientWidth, H = this.root.clientHeight;
    if (W <= 0 || H <= 0) return;
    const cs = getComputedStyle(this.root);
    this.safe = { l: parseFloat(cs.paddingLeft) || 0, r: parseFloat(cs.paddingRight) || 0, t: parseFloat(cs.paddingTop) || 0, b: parseFloat(cs.paddingBottom) || 0 };
    this.W = W;
    this.H = H;
    this.app.renderer.resize(W, H);
    this.app.stage.hitArea = this.app.screen;
    this.layout();
  }

  private layout(): void {
    const { W, H, safe } = this;
    const pad = 10;
    const L = safe.l + pad, R = W - safe.r - pad, B = H - safe.b - pad;
    this.landscape = W >= H * 1.05;
    // fundo
    const g = this.bg;
    g.clear();
    g.rect(0, 0, W, H).fill({ color: C.bg });
    for (let x = 0; x < W; x += 24) g.moveTo(x + 0.5, 0).lineTo(x + 0.5, H);
    for (let y = 0; y < H; y += 24) g.moveTo(0, y + 0.5).lineTo(W, y + 0.5);
    g.stroke({ width: 1, color: C.panelLine, alpha: 0.12 });
    // cabeçalho
    const y0 = safe.t + 8;
    const back = this.btn.get('back') as PButton;
    back.layout(L, y0, 40, 38, 26);
    this.title.position.set(L + 52, y0 - 1);
    this.tagline.position.set(L + 52, y0 + 23);
    const chipW = Math.min(150, W * 0.2);
    this.chip.position.set(R - chipW, y0);
    this.drawChip(chipW, 0);
    fitWidth(this.tagline, R - chipW - 12 - (L + 52));
    // em pé o texto ficaria pequeno demais: some (o nome já diz o que é)
    this.tagline.visible = this.tagline.scale.x > 0.72;
    const top = y0 + 48;
    // regiões
    if (this.landscape) {
      const lw = Math.max(190, Math.min(262, W * 0.27));
      this.listRect = new Rectangle(R - lw, top, lw, B - top);
      const ch = Math.min(116, Math.max(100, (B - top) * 0.34));
      const mw = this.listRect.x - 10 - L;
      this.machineRect = new Rectangle(L, top, mw, B - top - ch - 12);
      this.ctrlRect = new Rectangle(L, this.machineRect.bottom + 12, mw, ch);
    } else {
      const lh = 96;
      this.listRect = new Rectangle(L, B - lh, R - L, lh);
      const ch = 128;
      this.ctrlRect = new Rectangle(L, this.listRect.y - 12 - ch, R - L, ch);
      this.machineRect = new Rectangle(L, top, R - L, this.ctrlRect.y - 12 - top);
    }
    this.scene.position.set(this.machineRect.x, this.machineRect.y);
    this.scene.layout(this.machineRect.width, this.machineRect.height, STATIONS[STATION].slots);
    // lista
    this.listFrame.clear();
    drawPanel(this.listFrame, this.listRect.x, this.listRect.y, this.listRect.width, this.listRect.height, { fill: C.panel, line: C.panelLine, radius: 12, lip: 3 });
    const lt = this.landscape ? 26 : 8;
    this.listTitle.visible = this.landscape;
    this.listTitle.position.set(this.listRect.x + 14, this.listRect.y + 10);
    this.list.layout(this.listRect.x, this.listRect.y + lt, this.listRect.width, this.listRect.height - lt - 6);
    // controle
    const c = this.ctrlRect;
    this.ctrlBg.clear();
    drawPanel(this.ctrlBg, c.x, c.y, c.width, c.height, { fill: C.panel, line: C.panelLine, radius: 12, lip: 3 });
    this.ctrl.position.set(c.x, c.y);
    const bh = 38, by = c.height - 12 - bh;
    (this.btn.get('minus') as PButton).layout(10, by, bh, bh, 18);
    this.batchTxt.position.set(10 + bh + 24, by + bh / 2);
    (this.btn.get('plus') as PButton).layout(10 + bh + 48, by, bh, bh, 18);
    (this.btn.get('max') as PButton).layout(10 + bh * 2 + 58, by, 60, bh, 12);
    const makeX = 10 + bh * 2 + 58 + 60 + 12;
    (this.btn.get('make') as PButton).layout(makeX, by, c.width - 10 - makeX, bh, 15);
    (this.btn.get('info') as PButton).layout(c.width - 40, 8, 30, 28, 15);
    (this.btn.get('close-job') as PButton).layout(c.width - 40, 8, 30, 28, 17);
    const jw = Math.min(150, (c.width - 40) / 3);
    (this.btn.get('take-slot') as PButton).layout(c.width - 10 - jw, by, jw, bh, 14);
    (this.btn.get('pause') as PButton).layout(c.width - 20 - jw * 2, by, jw, bh, 14);
    (this.btn.get('cancel') as PButton).layout(c.width - 30 - jw * 3, by, jw, bh, 14);
    // bandeja: o botão de pegar tudo fica sobre ela
    const tr = this.scene.trayRect();
    if (tr) (this.btn.get('take') as PButton).layout(tr.right - 108, tr.y + 5, 100, 24, 12);
    this.infoBox.position.set(4, 4);
    this.infoG.clear();
    drawPanel(this.infoG, 0, 0, c.width - 50, c.height - 8, { fill: 0x0d0a1c, line: C.orange, radius: 10 });
    this.infoNote.style.wordWrapWidth = Math.max(120, c.width - 78);
    this.infoReaction.position.set(12, 10);
    this.infoSteps.position.set(12, 30);
    this.infoNote.position.set(12, 48);
    this.rowSig = '';
    this.listSig = '';
    this.dirty = true;
  }

  private drawChip(w: number, frac: number): void {
    const g = this.chipG;
    g.clear();
    drawPanel(g, 0, 0, w, 38, { fill: C.panel, line: C.panelLine, radius: 10, lip: 2 });
    // sol pequeno
    g.circle(18, 19, 6.5).fill({ color: C.gold });
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      g.moveTo(18 + Math.cos(a) * 9, 19 + Math.sin(a) * 9).lineTo(18 + Math.cos(a) * 12, 19 + Math.sin(a) * 12);
    }
    g.stroke({ width: 1.6, color: C.gold });
    const bx = 78, bw = w - bx - 10;
    if (bw > 10) {
      g.roundRect(bx, 24, bw, 5, 2.5).fill({ color: C.metalLo });
      g.roundRect(bx, 24, bw * Math.max(0.05, Math.min(1, frac)), 5, 2.5).fill({ color: frac > 0.99 ? C.ok : frac > 0.5 ? C.gold : C.warn });
    }
    this.chipLbl.position.set(32, 7);
    this.chipVal.position.set(32, 19);
  }

  // ---------- receitas ----------

  private topBatch(): number {
    const r = this.shown();
    return r ? Math.max(1, Math.min(this.crafting.maxBatch(r), MAX_BATCH)) : 1;
  }

  private shown(): Recipe | null {
    if (!this.crafting.isBuilt(STATION)) return null;
    const list = this.crafting.recipes(STATION);
    const sel = this.selected ? recipeById(this.selected) : undefined;
    if (sel && sel.station === STATION) return sel;
    return list.find((r) => this.crafting.check(r).ok) ?? list.find((r) => !this.crafting.check(r).owned) ?? list[0] ?? null;
  }

  /** cartão de receita (uma tecla de toque, cartoon) */
  private recipeCard(r: Recipe, w: number, h: number, on: boolean): Container {
    const check = this.crafting.check(r);
    const can = check.ok && !check.owned;
    const c = new Container();
    const g = new Graphics();
    drawPanel(g, 0, 0, w, h, {
      fill: on ? mix(C.panelHi, C.ice, 0.14) : can ? mix(C.panelHi, C.ok, 0.1) : C.panelHi,
      line: on ? C.ice : can ? mix(C.panelLine, C.ok, 0.7) : C.panelLine, radius: 10, lip: 3,
    });
    c.addChild(g);
    const out = r.outputs[0];
    const s = h - 16;
    const ic = this.icons.sprite(this.iconFor(out), s);
    ic.position.set(8 + s / 2, h / 2);
    ic.alpha = check.owned ? 0.45 : 1;
    const name = txt(outName(out), { title: true, size: 13, fill: check.owned ? C.dim : C.ink });
    name.position.set(s + 16, 7);
    fitWidth(name, w - s - 16 - 44);
    c.addChild(ic, name);
    let x = s + 16;
    for (const [item, n] of Object.entries(r.inputs) as [ItemId, number][]) {
      if (x + 34 > w - 6) break;
      const have = this.crafting.has(item) >= n;
      const mi = this.icons.sprite(this.iconSrc.items[item], 17);
      mi.position.set(x + 8, h - 15);
      mi.alpha = have ? 1 : 0.5;
      const q = txt(`${n}`, { title: true, size: 11, fill: have ? C.dim : C.warn, ay: 0.5 });
      q.position.set(x + 19, h - 15);
      c.addChild(mi, q);
      x += 36;
    }
    // canto: ✓ (já tem), ou bolinha verde e ×N (dá para fazer agora)
    if (check.owned) {
      const k = txt('✓', { title: true, size: 13, fill: C.dim, ax: 1 });
      k.position.set(w - 10, 6);
      c.addChild(k);
    } else if (can) {
      const dg = new Graphics();
      dg.circle(w - 13, 14, 4).fill({ color: C.ok });
      c.addChild(dg);
      if (check.max > 1 && batchable(r)) {
        const n = txt(`×${check.max}`, { title: true, size: 11, fill: C.ok, ax: 1 });
        n.position.set(w - 22, 7);
        c.addChild(n);
      }
    }
    return c;
  }

  /** refaz os cartões só quando algo que eles mostram mudou */
  private buildList(): void {
    const recipes = this.crafting.recipes(STATION);
    const shown = this.slotSel === null ? this.shown() : null;
    const sig = recipes.map((r) => {
      const ck = this.crafting.check(r);
      return `${r.id}:${ck.ok ? 1 : 0}${ck.owned ? 1 : 0}${ck.max}:${shown?.id === r.id ? 1 : 0}`;
    }).join('|') + `#${this.landscape}#${this.listRect.width | 0}x${this.listRect.height | 0}`;
    if (sig === this.listSig) return;
    this.listSig = sig;
    this.list.content.removeChildren().forEach((c) => c.destroy({ children: true }));
    const horizontal = !this.landscape;
    const vh = this.listRect.height - (this.landscape ? 26 : 8) - 6;
    const cardH = horizontal ? vh - 8 : 56;
    const cardW = horizontal ? 168 : this.listRect.width - 20;
    const gap = 8;
    const items: ListItem[] = [];
    recipes.forEach((r, i) => {
      const card = this.recipeCard(r, cardW, cardH, shown?.id === r.id);
      const x = horizontal ? 10 + i * (cardW + gap) : 10, y = horizontal ? 2 : 4 + i * (cardH + gap);
      card.position.set(x, y);
      this.list.content.addChild(card);
      items.push({
        id: `r:${r.id}`, rect: new Rectangle(x, y, cardW, cardH + 3),
        onTap: () => {
          if (this.selected !== r.id) this.batch = 1;
          this.selected = r.id;
          this.slotSel = null;
          this.info = false;
          this.dirty = true;
        },
      });
    });
    const total = horizontal ? 10 + recipes.length * (cardW + gap) : 4 + recipes.length * (cardH + gap);
    this.list.setItems(items, total);
    for (const c of this.list.content.children) this.syncIcons(c);
  }

  /** põe as texturas dos ícones que carregaram depois de o cartão ser feito */
  private syncIcons(c: Container): void {
    for (const k of c.children) {
      if (k instanceof Sprite) this.icons.sync(k);
      else if (k instanceof Container) this.syncIcons(k);
    }
  }

  // ---------- controle de baixo ----------

  private stack(src: string | undefined, n: string, color: number, dim: boolean, x: number, y: number, size: number): Container {
    const c = new Container();
    const g = new Graphics();
    g.roundRect(0, 0, size + 8, size + 8, 8).fill({ color: 0x000000, alpha: 0.28 });
    g.roundRect(0, 0, size + 8, size + 8, 8).stroke({ width: 1.2, color: dim ? C.warn : C.panelLine, alpha: dim ? 0.7 : 1 });
    const ic = this.icons.sprite(src, size);
    ic.position.set(4 + size / 2, 4 + size / 2);
    ic.alpha = dim ? 0.5 : 1;
    c.addChild(g, ic);
    if (n) {
      const q = txt(n, { title: true, size: 12, fill: color, ax: 1, ay: 1 });
      q.position.set(size + 9, size + 10);
      c.addChild(q);
    }
    c.position.set(x, y);
    return c;
  }

  private refreshControl(jobs: (JobView | null)[]): void {
    const c = this.ctrlRect;
    const job = this.slotSel !== null ? jobs[this.slotSel] : null;
    if (this.slotSel !== null && !job) this.slotSel = null;
    const jobMode = !!job;
    const show = (id: string, v: boolean): void => {
      const b = this.btn.get(id) as PButton;
      b.visible = v;
      b.renderable = v;
    };
    for (const id of ['minus', 'plus', 'max', 'make', 'info']) show(id, !jobMode);
    for (const id of ['close-job', 'take-slot', 'pause', 'cancel']) show(id, jobMode);
    this.batchTxt.visible = !jobMode;
    if (job) {
      this.infoBox.visible = false;
      const sig = `job:${job.slot}:${job.recipe.id}:${job.batch}`;
      if (sig !== this.rowSig) {
        this.rowSig = sig;
        this.recipeRow.removeChildren().forEach((k) => k.destroy({ children: true }));
        this.recipeRow.addChild(this.stack(this.iconFor(job.recipe.outputs[0]), job.batch > 1 ? `${job.batch}` : '', C.ink, false, 10, 10, 30));
      }
      setText(this.ctrlName, job.recipe.outputs.map(outName).join(' + '));
      this.ctrlName.position.set(58, 28);
      this.ctrlSub.position.set(58, 48);
      const stateTxt = job.leftover ? t('craft.k.leftover') : job.ready ? t('craft.k.done') : job.paused ? t('craft.k.paused') : `${t('craft.k.left')} ${clockText(job.remaining)}`;
      setText(this.ctrlSub, `${t('craft.k.slot')}${job.slot + 1} · ${job.units}/${job.batch} ${t('craft.k.ready')} · ${stateTxt}`);
      fitWidth(this.ctrlName, c.width - 58 - 56);
      fitWidth(this.ctrlSub, c.width - 58 - 56);
      const take = this.btn.get('take-slot') as PButton;
      take.setLabel(job.waitingCount ? t('craft.takeN', { n: job.waitingCount }) : t('craft.take'));
      take.setTone('go');
      take.setEnabled(job.waitingCount > 0);
      const pause = this.btn.get('pause') as PButton;
      pause.setLabel(job.paused ? t('craft.resume') : t('craft.pause'));
      pause.setTone('gold');
      show('pause', !job.ready && !job.leftover);
      const cancel = this.btn.get('cancel') as PButton;
      const sure = this.time - this.confirmCancel < 3;
      cancel.setLabel(sure ? t('craft.cancelSure') : t('craft.cancel'));
      cancel.setTone(sure ? 'go' : 'danger');
      show('cancel', !job.ready && !job.leftover);
      this.btn.get('close-job')?.setTone('neutral');
      return;
    }
    const r = this.shown();
    if (!r) return;
    const max0 = this.crafting.maxBatch(r);
    if (this.batch > Math.max(1, max0)) this.batch = Math.max(1, Math.min(max0, MAX_BATCH));
    const check = this.crafting.check(r, this.batch);
    const can = batchable(r);
    const top = Math.max(1, Math.min(max0, MAX_BATCH));
    // entra → sai
    const sig = `rec:${r.id}:${this.batch}:${Object.keys(r.inputs).map((k) => (this.crafting.has(k as ItemId) >= (r.inputs[k as ItemId] ?? 0) * this.batch ? 1 : 0)).join('')}`;
    if (sig !== this.rowSig) {
      this.rowSig = sig;
      this.recipeRow.removeChildren().forEach((k) => k.destroy({ children: true }));
      let x = 10;
      for (const [item, n] of Object.entries(r.inputs) as [ItemId, number][]) {
        const need = n * this.batch, have = this.crafting.has(item);
        this.recipeRow.addChild(this.stack(this.iconSrc.items[item], `${need}`, have >= need ? C.ink : C.warn, have < need, x, 10, 30));
        x += 48;
      }
      const ar = new Graphics();
      ar.moveTo(x - 2, 25).lineTo(x + 16, 25).moveTo(x + 10, 19).lineTo(x + 16, 25).lineTo(x + 10, 31).stroke({ width: 2, color: C.dim, cap: 'round', join: 'round' });
      this.recipeRow.addChild(ar);
      x += 28;
      for (const o of r.outputs) {
        this.recipeRow.addChild(this.stack(this.iconFor(o), o.kind === 'item' ? `${o.n * this.batch}` : '', C.ok, false, x, 10, 30));
        x += 48;
      }
      this.ctrlName.position.set(x + 6, 11);
      this.ctrlSub.position.set(x + 6, 31);
      this.nameX = x + 6;
    }
    const others = this.crafting.freeSlot(STATION) >= 0 ? this.crafting.slots(STATION).filter((j) => j && !j.ready && !j.paused).length : 0;
    const speed = this.energy.speed(STATION);
    const est = (recipeSeconds(r, this.batch) * (others + 1)) / Math.max(0.0001, speed);
    setText(this.ctrlName, r.outputs.map(outName).join(' + '));
    let hint = `${t('craft.k.time')} ${humanTime(speed > 0.001 ? est : Infinity)}`;
    if (can && this.batch > 1) hint += ` · ${humanTime(unitSeconds(r) / Math.max(0.0001, speed))} ${t('craft.k.each')}`;
    if (others > 0) hint += ` · ${t('craft.sharing', { n: others + 1 })}`;
    setText(this.ctrlSub, hint);
    const room = c.width - this.nameX - 52;
    fitWidth(this.ctrlName, room);
    fitWidth(this.ctrlSub, room);
    // quantidade e botão
    const batchable_ = can && this.crafting.isBuilt(STATION);
    for (const id of ['minus', 'plus', 'max']) show(id, batchable_);
    this.batchTxt.visible = batchable_;
    setText(this.batchTxt, `${this.batch}×`);
    (this.btn.get('minus') as PButton).setEnabled(this.batch > 1);
    (this.btn.get('plus') as PButton).setEnabled(this.batch < top);
    (this.btn.get('max') as PButton).setEnabled(top > 1 && this.batch < top);
    let lbl: string;
    if (check.owned) lbl = r.outputs[0].kind === 'station' ? t('craft.installedTag') : t('craft.owned');
    else if (check.pending) lbl = t('craft.working');
    else if (check.full) lbl = t('craft.slotsFull');
    else if (check.missing.length) lbl = t('craft.missing');
    else lbl = this.batch > 1 ? t('craft.makeN', { n: this.batch }) : t('craft.make');
    const make = this.btn.get('make') as PButton;
    make.setLabel(lbl);
    make.setTone('go');
    make.setEnabled(check.ok);
    const info = this.btn.get('info') as PButton;
    info.setTone(this.info ? 'ice' : 'neutral');
    this.infoBox.visible = this.info;
    if (this.info) {
      setText(this.infoReaction, r.process.reaction);
      setText(this.infoSteps, r.process.steps.map((s, i) => `${i + 1}. ${s}`).join('   ').toUpperCase());
      setText(this.infoNote, r.process.note);
      fitWidth(this.infoReaction, c.width - 80);
      fitWidth(this.infoSteps, c.width - 80);
    }
  }

  private nameX = 140;

  // ---------- a cada quadro ----------

  private update(dt: number): void {
    if (!this.open) return;
    dt = Math.min(dt, 0.1);
    this.time += dt;
    const jobs = this.crafting.slots(STATION);
    const sun = this.energy.speed(STATION);
    this.scene.update(dt, { jobs, sun, selected: this.slotSel });
    this.list.update(dt);
    this.listTimer -= dt;
    if (this.dirty || this.listTimer <= 0) {
      this.buildList();
      this.syncIcons(this.list.content);
      this.dirty = false;
      this.listTimer = 0.25;
    }
    this.refreshControl(jobs);
    // sincroniza ícones que carregaram agora (cartões e controle)
    this.syncIcons(this.recipeRow);
    // selo do sol
    const chipW = Math.min(150, this.W * 0.2);
    const pct = `${Math.round(sun * 100)}%`;
    if (this.chipVal.text !== pct) {
      setText(this.chipVal, pct);
      this.chipVal.style.fill = sun > 0.99 ? C.ok : sun > 0.5 ? C.gold : C.warn;
      this.drawChip(chipW, sun);
    }
    // botão de pegar tudo sobre a bandeja
    const takeAll = this.btn.get('take') as PButton;
    const has = this.crafting.hasReady(STATION);
    takeAll.visible = takeAll.renderable = has;
    this.refreshTake(takeAll);
  }

  private refreshTake(b: PButton): void {
    const tr = this.scene.trayRect();
    if (tr && b.position.x !== tr.right - 108) b.layout(tr.right - 108, tr.y + 5, 100, 24, 12);
  }
}
