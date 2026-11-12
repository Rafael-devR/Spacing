// Tela cheia das estações (docs/design/CRAFTING.md e INTERFACE.md), desenhada em Canvas, no estilo de painel técnico
// (referência do dono: o jogo Idle CPU). Esquerda: módulos da máquina (de onde vem a energia e o calor/corrente). Meio:
// o barramento de energia e as vagas; cada vaga é uma grade de células, uma por unidade do lote, que acende quando a
// unidade fica pronta. Direita (perto do polegar): as receitas. Embaixo: a receita escolhida, ou a vaga escolhida com
// Pegar, Pausar e Cancelar. Todo movimento é algo de verdade: minério entrando na célula, produto saindo para a bandeja,
// pacote de energia correndo no barramento e se dividindo entre as vagas que trabalham.
import { EQUIPMENT, type EquipId } from '../data/equipment';
import { ITEMS, type ItemId } from '../data/items';
import { batchable, MAX_BATCH, RECIPES, recipeById, recipeSeconds, unitSeconds, type Recipe, type RecipeOutput } from '../data/recipes';
import { STATIONS, type StationData, type StationId } from '../data/stations';
import { t } from '../i18n';
import type { Crafting, JobView } from '../systems/Crafting';
import { boltIcon, CanvasScreen, COLORS, FONT_UI, fitText, hexA, roundRect, sunIcon, wrapText, type Rect } from './canvasScreen';

type Icons = { items: Record<ItemId, string>; equip: Record<EquipId, string>; stations: Partial<Record<StationId, string>> };

/** o que a tela precisa saber da energia (systems/Power.ts) */
export interface EnergyView {
  /** 0..1: energia que a estação recebe agora */
  speed(station: StationId): number;
  /** 0..1: carga da bateria da base */
  battery(): number;
}

const MONO = '"JetBrains Mono", ui-monospace, Menlo, monospace';

const outName = (o: RecipeOutput): string =>
  o.kind === 'item' ? ITEMS[o.item].name : o.kind === 'equip' ? EQUIPMENT[o.equip].name : STATIONS[o.station].name;

/** 130 → "2 min 10 s"; 8.4 → "8 s" */
export function humanTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return t('craft.noEnergy');
  const s = Math.max(1, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60), ss = s % 60;
  return ss ? `${m} min ${ss} s` : `${m} min`;
}

const clock = (seconds: number): string => {
  if (!Number.isFinite(seconds)) return '--:--';
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

interface Token {
  img: HTMLImageElement | null;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  t: number;
  dur: number;
  size: number;
  arc: number;
}

interface Spark {
  slot: number;
  t: number;
}

export class CraftPanel extends CanvasScreen {
  onCraft: ((r: Recipe, batch: number) => void) | null = null;
  onTake: ((station: StationId, slot?: number) => void) | null = null;
  onPause: ((station: StationId, slot: number) => void) | null = null;
  onCancel: ((station: StationId, slot: number) => void) | null = null;
  private icons: Icons = { items: {} as Record<ItemId, string>, equip: {} as Record<EquipId, string>, stations: {} };
  private station: StationId = 'workbench';
  private selected: string | null = null;
  /** vaga escolhida (mostra Pegar, Pausar, Cancelar embaixo) */
  private slotSel: number | null = null;
  private confirmCancel = -10;
  private batch = 1;
  private info = false;
  private tokens: Token[] = [];
  private sparks: Spark[] = [];
  private sparkT = 0;
  private sparkRR = 0;
  /** unidades já mostradas de cada trabalho (cada minério e cada produto vira um pontinho uma vez só) */
  private readonly seen = new Map<string, number>();

  constructor(
    private readonly crafting: Crafting,
    private readonly energy: EnergyView,
  ) {
    super('#craft');
  }

  setIcons(items: Record<ItemId, string>, equip: Record<EquipId, string>, stations: Partial<Record<StationId, string>> = {}): void {
    this.icons = { items, equip, stations };
  }

  get current(): StationId {
    return this.station;
  }

  show(station: StationId = 'workbench'): void {
    if (!this.open || this.station !== station) {
      this.station = station;
      this.selected = null;
      this.slotSel = null;
      this.batch = 1;
      this.info = false;
      this.tokens = [];
      this.sparks = [];
      this.seen.clear();
      this.scrollPos.clear();
    }
    this.openScreen();
  }

  /** compatibilidade: a tela se redesenha sozinha a cada quadro */
  render(): void {}

  private iconFor(o: RecipeOutput): string | undefined {
    if (o.kind === 'item') return this.icons.items[o.item];
    if (o.kind === 'equip') return this.icons.equip[o.equip];
    return this.icons.stations[o.station];
  }

  private shown(): Recipe | null {
    if (!this.crafting.isBuilt(this.station)) return RECIPES.find((r) => r.outputs.some((o) => o.kind === 'station' && o.station === this.station)) ?? null;
    const list = this.crafting.recipes(this.station);
    const sel = this.selected ? recipeById(this.selected) : undefined;
    if (sel && sel.station === this.station) return sel;
    return list.find((r) => this.crafting.check(r).ok) ?? list.find((r) => !this.crafting.check(r).owned) ?? list[0] ?? null;
  }

  // ---------- desenho ----------

  protected draw(dt: number): void {
    const st = STATIONS[this.station];
    this.background(st.accent);
    const top = this.header(st);
    const pad = 10;
    const L = this.safe.l + pad, R = this.W - this.safe.r - pad, B = this.H - this.safe.b - pad;
    const landscape = this.W >= this.H * 1.05;
    let list: Rect, machine: Rect, control: Rect;
    if (landscape) {
      // receitas à direita: perto do polegar
      const lw = Math.max(180, Math.min(260, this.W * 0.26));
      list = { x: R - lw, y: top, w: lw, h: B - top };
      const wx = L, ww = list.x - pad - L;
      const ch = Math.min(112, Math.max(96, (B - top) * 0.34));
      machine = { x: wx, y: top, w: ww, h: B - top - ch - 8 };
      control = { x: wx, y: machine.y + machine.h + 8, w: ww, h: ch };
    } else {
      const lh = 76;
      list = { x: L, y: B - lh, w: R - L, h: lh };
      const ch = 128;
      control = { x: L, y: list.y - 8 - ch, w: R - L, h: ch };
      machine = { x: L, y: top, w: R - L, h: control.y - 8 - top };
    }
    this.drawList(list, !landscape);
    this.drawMachine(machine, st, dt, landscape);
    this.drawControl(control, st);
  }

  /** cabeçalho: voltar, nome em letras de painel, de onde vem a energia e a bateria */
  private header(st: StationData): number {
    const g = this.g;
    const x0 = this.safe.l + 10, y0 = this.safe.t + 8;
    const back = { x: x0, y: y0, w: 38, h: 38 };
    g.fillStyle = 'rgba(255,255,255,0.07)';
    roundRect(g, back, 19);
    g.fill();
    g.strokeStyle = hexA(st.accent, 0.5);
    g.lineWidth = 1.5;
    g.stroke();
    g.strokeStyle = COLORS.ink;
    g.lineWidth = 2.6;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(back.x + 22, back.y + 11);
    g.lineTo(back.x + 14, back.y + 19);
    g.lineTo(back.x + 22, back.y + 27);
    g.stroke();
    this.hit('back', { x: 0, y: 0, w: back.x + back.w + 8, h: back.y + back.h + 6 }, () => this.close());
    const sp = this.energy.speed(this.station);
    const chipW = Math.min(160, this.W * 0.19);
    let cx = this.W - this.safe.r - 10 - chipW;
    this.statChip({ x: cx, y: y0, w: chipW, h: 38 }, st.energy === 'sun' ? t('craft.k.sun') : t('craft.k.grid'), `${Math.round(sp * 100)}%`, sp, st.energy === 'sun' ? 'sun' : 'bolt');
    if (st.energy === 'grid') {
      cx -= chipW + 8;
      const b = this.energy.battery();
      this.statChip({ x: cx, y: y0, w: chipW, h: 38 }, t('craft.k.battery'), `${Math.round(b * 100)}%`, b, 'battery');
    }
    const tw = cx - 12 - (back.x + 50);
    g.textAlign = 'left';
    g.fillStyle = st.accent;
    g.font = `700 16px ${MONO}`;
    label(g, fitText(g, st.name.toUpperCase(), tw), back.x + 50, y0 + 17, 1.5);
    g.fillStyle = COLORS.dim;
    g.font = `500 10px ${MONO}`;
    label(g, fitText(g, t(`craft.sub.${this.station}`).toUpperCase(), tw - 20), back.x + 50, y0 + 33, 1);
    return y0 + 48;
  }

  private statChip(r: Rect, k: string, v: string, f: number, icon: 'sun' | 'bolt' | 'battery'): void {
    const g = this.g;
    const color = f > 0.99 ? COLORS.ok : f > 0.5 ? COLORS.work : COLORS.warn;
    g.fillStyle = 'rgba(10,18,40,0.9)';
    roundRect(g, r, 9);
    g.fill();
    g.strokeStyle = hexA(color, 0.55);
    g.lineWidth = 1.2;
    g.stroke();
    const cx = r.x + 17, cy = r.y + r.h / 2;
    if (icon === 'sun') sunIcon(g, cx, cy, 6, this.time);
    else if (icon === 'bolt') boltIcon(g, cx, cy, 8, color);
    else {
      g.strokeStyle = color;
      g.lineWidth = 1.5;
      g.strokeRect(cx - 5, cy - 8, 10, 16);
      g.fillStyle = color;
      g.fillRect(cx - 3, cy + 6 - 12 * f, 6, 12 * f);
    }
    g.textAlign = 'left';
    g.fillStyle = COLORS.dim;
    g.font = `500 9px ${MONO}`;
    label(g, k.toUpperCase(), r.x + 32, r.y + 14, 1);
    g.fillStyle = color;
    g.font = `700 13px ${MONO}`;
    g.fillText(v, r.x + 32, r.y + 30);
    const bar = { x: r.x + 78, y: r.y + 24, w: r.w - 88, h: 4 };
    if (bar.w > 10) {
      g.fillStyle = 'rgba(255,255,255,0.1)';
      g.fillRect(bar.x, bar.y, bar.w, bar.h);
      g.fillStyle = color;
      g.fillRect(bar.x, bar.y, bar.w * Math.max(0.02, Math.min(1, f)), bar.h);
    }
  }

  // ---------- receitas ----------

  private drawList(area: Rect, horizontal: boolean): void {
    const g = this.g;
    const st = STATIONS[this.station];
    const built = this.crafting.isBuilt(this.station);
    frame(g, area, hexA(st.accent, 0.3));
    g.fillStyle = COLORS.dim;
    g.font = `500 9px ${MONO}`;
    g.textAlign = 'left';
    if (!horizontal) label(g, t('craft.k.recipes'), area.x + 10, area.y + 15, 1.5);
    if (!built) {
      g.fillStyle = COLORS.dim;
      g.font = `400 12px ${FONT_UI}`;
      wrapText(g, t('craft.locked', { name: st.name }), area.w - 20).forEach((line, i) => g.fillText(line, area.x + 10, area.y + 38 + i * 17));
      return;
    }
    const recipes = this.crafting.recipes(this.station);
    const shown = this.slotSel === null ? this.shown() : null;
    const top = horizontal ? 6 : 22;
    const view: Rect = { x: area.x, y: area.y + top, w: area.w, h: area.h - top - 4 };
    const cardH = horizontal ? view.h - 2 : 54;
    const cardW = horizontal ? 160 : view.w - 12;
    const gap = 5;
    const content = recipes.length * ((horizontal ? cardW : cardH) + gap) + gap;
    this.scrolls.push({ id: 'list', ...view, content, horizontal });
    const off = this.scrollOf('list');
    g.save();
    g.beginPath();
    g.rect(view.x, view.y, view.w, view.h);
    g.clip();
    recipes.forEach((r, i) => {
      const k = gap + i * ((horizontal ? cardW : cardH) + gap) - off;
      const card = horizontal ? { x: view.x + k, y: view.y, w: cardW, h: cardH } : { x: view.x + 6, y: view.y + k, w: cardW, h: cardH };
      if (horizontal ? card.x + card.w < view.x || card.x > view.x + view.w : card.y + card.h < view.y || card.y > view.y + view.h) return;
      this.recipeCard(card, r, shown?.id === r.id);
      this.hit(`r:${r.id}`, card, () => {
        if (this.selected !== r.id) this.batch = 1;
        this.selected = r.id;
        this.slotSel = null;
        this.info = false;
      });
    });
    g.restore();
  }

  private recipeCard(c: Rect, r: Recipe, on: boolean): void {
    const g = this.g;
    const st = STATIONS[r.station];
    const check = this.crafting.check(r);
    g.fillStyle = on ? hexA(st.accent, 0.14) : 'rgba(255,255,255,0.03)';
    roundRect(g, c, 8);
    g.fill();
    g.strokeStyle = on ? st.accent : 'rgba(255,255,255,0.07)';
    g.lineWidth = on ? 1.5 : 1;
    g.stroke();
    const out = r.outputs[0];
    const s = c.h - 14;
    const dim = check.owned ? 0.45 : 1;
    g.globalAlpha = dim;
    const ic = this.img(this.iconFor(out));
    if (ic) g.drawImage(ic, c.x + 5, c.y + 7, s, s);
    g.fillStyle = COLORS.ink;
    g.font = `500 12.5px ${FONT_UI}`;
    g.textAlign = 'left';
    g.fillText(fitText(g, outName(out), c.w - s - 40), c.x + s + 12, c.y + 19);
    let x = c.x + s + 12;
    for (const [item, n] of Object.entries(r.inputs) as [ItemId, number][]) {
      if (x + 32 > c.x + c.w - 4) break;
      const have = this.crafting.has(item) >= n;
      g.globalAlpha = dim * (have ? 1 : 0.4);
      const mi = this.img(this.icons.items[item]);
      if (mi) g.drawImage(mi, x, c.y + c.h - 25, 17, 17);
      g.fillStyle = have ? COLORS.dim : COLORS.warn;
      g.font = `500 9.5px ${MONO}`;
      g.fillText(`${n}`, x + 19, c.y + c.h - 12);
      x += 32;
    }
    g.globalAlpha = 1;
    const badge = check.owned ? '✓' : check.max > 0 ? (batchable(r) ? `×${check.max}` : '●') : '';
    if (badge) {
      g.font = `700 10px ${MONO}`;
      g.textAlign = 'right';
      g.fillStyle = check.owned ? COLORS.dim : COLORS.ok;
      g.fillText(badge, c.x + c.w - 7, c.y + 16);
    }
  }

  // ---------- máquina: módulos, barramento e vagas ----------

  private drawMachine(area: Rect, st: StationData, dt: number, landscape: boolean): void {
    const g = this.g;
    frame(g, area, hexA(st.accent, 0.25));
    const built = this.crafting.isBuilt(this.station);
    const slots = this.crafting.slots(this.station);
    const speed = this.energy.speed(this.station);
    const running = slots.map((j) => !!j && !j.ready && !j.paused);
    // módulos à esquerda (no retrato ficam escondidos para dar lugar às vagas)
    const modW = landscape ? Math.min(118, area.w * 0.22) : 0;
    let busFrom = { x: area.x + 12, y: area.y + 22 };
    if (modW) {
      const mh = (area.h - 24) / 2;
      const m1 = { x: area.x + 8, y: area.y + 8, w: modW, h: mh };
      const m2 = { x: area.x + 8, y: m1.y + mh + 8, w: modW, h: mh };
      this.moduleSource(m1, st, speed, running.some(Boolean));
      this.moduleProcess(m2, st, slots, speed);
      busFrom = { x: m1.x + m1.w, y: m1.y + 22 };
    }
    // vagas
    const n = slots.length;
    const zone = { x: area.x + modW + 22, y: area.y + 36, w: area.w - modW - 32, h: area.h - 42 };
    const gap = 10;
    const sw = Math.min(190, (zone.w - gap * (n - 1)) / n);
    const x0 = zone.x + (zone.w - (sw * n + gap * (n - 1))) / 2;
    const rects: Rect[] = slots.map((_, i) => ({ x: x0 + i * (sw + gap), y: zone.y, w: sw, h: zone.h }));
    // barramento: da fonte até cada vaga
    const busY = area.y + 22;
    g.strokeStyle = hexA(st.accent, built ? 0.45 : 0.15);
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(busFrom.x, busFrom.y);
    g.lineTo(busFrom.x + 8, busY);
    g.lineTo(rects[n - 1].x + rects[n - 1].w / 2, busY);
    g.stroke();
    rects.forEach((r, i) => {
      g.strokeStyle = running[i] ? hexA(st.accent, 0.8) : 'rgba(255,255,255,0.1)';
      g.lineWidth = running[i] ? 2 : 1;
      g.beginPath();
      g.moveTo(r.x + r.w / 2, busY);
      g.lineTo(r.x + r.w / 2, r.y + 18);
      g.stroke();
      g.fillStyle = running[i] ? st.accent : 'rgba(255,255,255,0.15)';
      g.beginPath();
      g.arc(r.x + r.w / 2, busY, 3, 0, Math.PI * 2);
      g.fill();
    });
    // pacotes de energia: saem na velocidade que a estação recebe e se dividem entre as vagas que trabalham
    const active = running.map((w, i) => (w ? i : -1)).filter((i) => i >= 0);
    this.sparkT -= dt;
    if (active.length && speed > 0.01 && this.sparkT <= 0) {
      this.sparkT = 1 / (10 * speed);
      this.sparks.push({ slot: active[this.sparkRR++ % active.length], t: 0 });
    }
    this.sparks = this.sparks.filter((s) => (s.t += dt) < 0.9 && running[s.slot]);
    for (const s of this.sparks) {
      const r = rects[s.slot];
      const tx = r.x + r.w / 2;
      const len1 = tx - busFrom.x, len2 = r.y + 18 - busY;
      const d = (s.t / 0.9) * (len1 + len2);
      const px = d < len1 ? busFrom.x + d : tx;
      const py = d < len1 ? busY : busY + (d - len1);
      const c = st.energy === 'sun' ? '#ffd27a' : '#9fe8ff';
      g.fillStyle = c;
      g.shadowColor = c;
      g.shadowBlur = 6;
      g.beginPath();
      g.arc(px, py, 2.3, 0, Math.PI * 2);
      g.fill();
      g.shadowBlur = 0;
    }
    slots.forEach((j, i) => this.drawSlot(rects[i], st, j, i));
    // minérios e produtos voando
    this.tokens = this.tokens.filter((k) => (k.t += dt) < k.dur);
    for (const k of this.tokens) {
      if (k.t < 0) continue;
      const u = k.t / k.dur, e = u * u * (3 - 2 * u);
      const x = k.x0 + (k.x1 - k.x0) * e, y = k.y0 + (k.y1 - k.y0) * e - Math.sin(Math.PI * u) * k.arc;
      if (k.img) g.drawImage(k.img, x - k.size / 2, y - k.size / 2, k.size, k.size);
    }
    // pegar tudo
    if (this.crafting.hasReady(this.station)) {
      const b = { x: area.x + area.w - 116, y: area.y + 6, w: 108, h: 24 };
      this.button('take', b, t('craft.takeAll'), { color: COLORS.ok }, () => this.onTake?.(this.station));
    }
  }

  /** módulo de cima: de onde vem a energia (espelhos ou rede), com uma onda que cresce com ela */
  private moduleSource(r: Rect, st: StationData, speed: number, working: boolean): void {
    const g = this.g;
    const color = st.energy === 'sun' ? '#ffcf5a' : '#9fe8ff';
    frame(g, r, hexA(color, 0.45));
    g.textAlign = 'left';
    g.fillStyle = COLORS.dim;
    g.font = `500 9px ${MONO}`;
    label(g, (st.energy === 'sun' ? t('craft.k.mirrors') : t('craft.k.grid')).toUpperCase(), r.x + 9, r.y + 15, 1.5);
    const amp = r.h * 0.14 * (working ? Math.max(0.15, speed) : 0.08);
    g.strokeStyle = color;
    g.lineWidth = 2;
    g.beginPath();
    const wy = r.y + r.h * 0.5;
    for (let x = 0; x <= r.w - 18; x += 2) {
      const y = wy + Math.sin(x * 0.14 + this.time * (working ? 6 : 1.5)) * amp;
      if (x === 0) g.moveTo(r.x + 9 + x, y);
      else g.lineTo(r.x + 9 + x, y);
    }
    g.stroke();
    const kw = st.energy === 'sun' ? 6 * speed : working ? st.kw * speed : 0;
    g.fillStyle = color;
    g.font = `700 13px ${MONO}`;
    g.fillText(`${kw.toFixed(1)} kW`, r.x + 9, r.y + r.h - 10);
  }

  /** módulo de baixo: o que a câmara faz agora (temperatura, corrente ou laser) */
  private moduleProcess(r: Rect, st: StationData, slots: (JobView | null)[], speed: number): void {
    const g = this.g;
    const run = slots.filter((j): j is JobView => !!j && !j.ready && !j.paused);
    const heat = run.length ? Math.min(1, speed) : 0;
    const accent = st.accent;
    frame(g, r, hexA(accent, 0.45));
    g.textAlign = 'left';
    g.fillStyle = COLORS.dim;
    g.font = `500 9px ${MONO}`;
    const k = st.chamber === 'heat' ? t('craft.k.temp') : st.chamber === 'cell' ? t('craft.k.current') : t('craft.k.laser');
    label(g, k, r.x + 9, r.y + 15, 1.5);
    let value: string, f: number, max = 1;
    if (st.chamber === 'heat') {
      const target = Math.max(0, ...run.map((j) => j.recipe.process.temp ?? 1200));
      const temp = 22 + (target - 22) * heat;
      value = `${Math.round(temp)}°C`;
      f = temp / 1800;
      max = 1600 / 1800;
    } else if (st.chamber === 'cell') {
      const a = 120 * heat * (0.95 + 0.05 * Math.sin(this.time * 7));
      value = `${Math.round(a)} A`;
      f = a / 140;
    } else {
      const kw = 1.2 * heat * (0.92 + 0.08 * Math.sin(this.time * 11));
      value = `${kw.toFixed(2)} kW`;
      f = kw / 1.4;
    }
    g.fillStyle = heat > 0 ? accent : COLORS.faint;
    g.font = `700 16px ${MONO}`;
    g.fillText(value, r.x + 9, r.y + r.h * 0.58);
    const bar = { x: r.x + 9, y: r.y + r.h - 15, w: r.w - 18, h: 5 };
    g.fillStyle = 'rgba(255,255,255,0.1)';
    g.fillRect(bar.x, bar.y, bar.w, bar.h);
    g.fillStyle = accent;
    g.fillRect(bar.x, bar.y, bar.w * Math.max(0, Math.min(1, f)), bar.h);
    if (max < 1) {
      g.fillStyle = COLORS.warn;
      g.fillRect(bar.x + bar.w * max, bar.y - 3, 2, bar.h + 6);
    }
  }

  private drawSlot(r: Rect, st: StationData, j: JobView | null, i: number): void {
    const g = this.g;
    const built = this.crafting.isBuilt(this.station);
    const sel = this.slotSel === i;
    const headH = 18, footH = 26;
    g.textAlign = 'left';
    g.fillStyle = j ? COLORS.ink : COLORS.faint;
    g.font = `700 10.5px ${MONO}`;
    label(g, `${t('craft.k.slot')}${i + 1}`, r.x + 2, r.y + 11, 1);
    if (j) {
      g.fillStyle = j.paused ? COLORS.work : j.ready ? COLORS.ok : st.accent;
      g.textAlign = 'right';
      g.fillText(j.paused ? t('craft.k.paused') : j.ready ? t('craft.k.done') : clock(j.remaining), r.x + r.w - 2, r.y + 11);
    }
    const body = { x: r.x, y: r.y + headH, w: r.w, h: r.h - headH - footH };
    g.fillStyle = 'rgba(6,10,26,0.9)';
    roundRect(g, body, 10);
    g.fill();
    g.strokeStyle = sel ? COLORS.ink : j?.ready ? COLORS.ok : j && !j.paused ? hexA(st.accent, 0.85) : 'rgba(255,255,255,0.14)';
    g.lineWidth = sel ? 2.2 : 1.4;
    if (!j) g.setLineDash([4, 4]);
    g.stroke();
    g.setLineDash([]);
    if (!j) {
      if (built) {
        g.fillStyle = COLORS.faint;
        g.font = `500 10px ${MONO}`;
        label(g, t('craft.k.free'), body.x + body.w / 2, body.y + body.h / 2 + 3, 1.5, 'center');
      }
      return;
    }
    this.hit(`slot:${i}`, { x: r.x, y: r.y, w: r.w, h: r.h }, () => {
      this.slotSel = this.slotSel === i ? null : i;
      this.confirmCancel = -10;
      this.info = false;
    });
    this.cells(body, st, j);
    // rodapé: quantas unidades prontas e barra segmentada do trabalho
    const foot = { x: r.x, y: body.y + body.h + 5, w: r.w, h: footH - 5 };
    const oi = this.img(this.iconFor(j.recipe.outputs[0]));
    if (oi) {
      g.globalAlpha = j.waitingCount ? 1 : 0.35;
      g.drawImage(oi, foot.x, foot.y - 1, 17, 17);
      g.globalAlpha = 1;
    }
    g.textAlign = 'left';
    g.fillStyle = j.waitingCount ? COLORS.ok : COLORS.faint;
    g.font = `700 10.5px ${MONO}`;
    g.fillText(`${j.units}/${j.batch}`, foot.x + 20, foot.y + 12);
    const sx = foot.x + 58, avail = foot.w - 60;
    const segs = Math.min(12, Math.max(3, Math.floor(avail / 9)));
    const sw = avail / segs;
    for (let k = 0; k < segs; k++) {
      const on = (k + 1) / segs <= j.progress + 1e-6;
      g.fillStyle = on ? (j.ready ? COLORS.ok : st.accent) : 'rgba(255,255,255,0.1)';
      g.fillRect(sx + k * sw, foot.y + 4, sw - 2.5, 8);
    }
  }

  /** a grade de células: uma por unidade do lote (ou uma grande para equipamento e máquina) */
  private cells(body: Rect, st: StationData, j: JobView): void {
    const g = this.g;
    const n = j.batch;
    const pad = 7, gap = 4;
    const iw = body.w - pad * 2, ih = body.h - pad * 2;
    let cols = 1;
    while (cols < n && Math.ceil(n / cols) * ((iw - (cols - 1) * gap) / cols) > ih) cols++;
    const rows = Math.ceil(n / cols);
    const size = Math.max(6, Math.min((iw - (cols - 1) * gap) / cols, (ih - (rows - 1) * gap) / rows, n === 1 ? 110 : 44));
    const gw = cols * size + (cols - 1) * gap, gh = rows * size + (rows - 1) * gap;
    const gx = body.x + (body.w - gw) / 2, gy = body.y + (body.h - gh) / 2;
    const perUnit = j.recipe.outputs.reduce((s, o) => s + (o.kind === 'item' ? o.n : 1), 0);
    const waitingUnits = Math.min(j.units, Math.ceil(j.waitingCount / Math.max(1, perUnit)));
    const takenUnits = j.units - waitingUnits;
    const outImg = this.img(this.iconFor(j.recipe.outputs[0]));
    const inItem = Object.keys(j.recipe.inputs)[0] as ItemId | undefined;
    const inImg = inItem ? this.img(this.icons.items[inItem]) : null;
    const tint = j.recipe.outputs[0].kind === 'item' ? ITEMS[j.recipe.outputs[0].item].tint : st.accent;
    const rad = Math.min(6, size * 0.18);
    const cellAt = (k: number): Rect => ({ x: gx + (k % cols) * (size + gap), y: gy + Math.floor(k / cols) * (size + gap), w: size, h: size });
    const icon = (img: HTMLImageElement, c: Rect, a = 1, k = 0.76): void => {
      g.globalAlpha = a;
      g.drawImage(img, c.x + (c.w * (1 - k)) / 2, c.y + (c.h * (1 - k)) / 2, c.w * k, c.h * k);
      g.globalAlpha = 1;
    };
    for (let k = 0; k < n; k++) {
      const c = cellAt(k);
      const done = k < j.units, now = k === j.units && !j.ready;
      const taken = done && k < takenUnits;
      g.fillStyle = done ? hexA(tint, taken ? 0.05 : 0.2) : 'rgba(255,255,255,0.03)';
      roundRect(g, c, rad);
      g.fill();
      g.strokeStyle = done ? (taken ? 'rgba(255,255,255,0.12)' : COLORS.ok) : now ? (j.paused ? COLORS.work : st.accent) : 'rgba(255,255,255,0.12)';
      g.lineWidth = now || (done && !taken) ? 1.6 : 1;
      g.stroke();
      if (now) {
        // a unidade que está sendo feita: enche de baixo para cima, com o brilho da câmara
        const f = j.unitProgress;
        const ly = c.y + c.h * (1 - f);
        g.save();
        roundRect(g, c, rad);
        g.clip();
        const glow = st.chamber === 'heat' ? '255,140,50' : st.chamber === 'cell' ? '80,190,255' : '150,240,255';
        g.fillStyle = `rgba(${glow},${j.paused ? 0.15 : 0.32 + 0.12 * Math.sin(this.time * 8)})`;
        g.fillRect(c.x, ly, c.w, c.h - (ly - c.y));
        if (outImg) {
          icon(outImg, c, 0.22);
          g.beginPath();
          g.rect(c.x, ly, c.w, c.h);
          g.clip();
          icon(outImg, c);
        }
        g.restore();
        if (!j.paused) {
          g.strokeStyle = 'rgba(255,255,255,0.75)';
          g.lineWidth = 1;
          g.beginPath();
          g.moveTo(c.x + 2, ly);
          g.lineTo(c.x + c.w - 2, ly);
          g.stroke();
        }
      } else if (done && !taken && outImg) icon(outImg, c);
      else if (!done && inImg && size >= 18) icon(inImg, c, 0.22, 0.6);
    }
    // pontinhos de verdade: cada unidade pronta sai para a bandeja; os minérios da próxima entram na célula dela
    const key = `${j.station}:${j.slot}:${j.recipe.id}:${j.batch}`;
    const seen = this.seen.get(key);
    if (seen === undefined || seen > j.units) this.seen.set(key, j.units);
    else if (seen < j.units) {
      for (let k = seen; k < j.units; k++) {
        const c = cellAt(k);
        this.tokens.push({ img: outImg, x0: c.x + c.w / 2, y0: c.y + c.h / 2, x1: body.x + 8, y1: body.y + body.h + 13, t: 0, dur: 0.6, size: 16, arc: 10 });
        if (k + 1 < n) {
          const next = cellAt(k + 1);
          let q = 0;
          for (const [item, cnt] of Object.entries(j.recipe.inputs) as [ItemId, number][])
            for (let m = 0; m < Math.min(3, cnt); m++, q++)
              this.tokens.push({
                img: this.img(this.icons.items[item]), x0: body.x + body.w / 2 + (q - 1) * 10, y0: body.y - 14,
                x1: next.x + next.w / 2, y1: next.y + next.h / 2, t: -q * 0.08, dur: 0.55, size: 13, arc: 6,
              });
        }
      }
      this.seen.set(key, j.units);
    }
  }

  // ---------- embaixo: receita escolhida, ou a vaga escolhida ----------

  private drawControl(area: Rect, st: StationData): void {
    const g = this.g;
    frame(g, area, hexA(st.accent, 0.3));
    const job = this.slotSel !== null ? this.crafting.slots(this.station)[this.slotSel] : null;
    if (this.slotSel !== null && !job) this.slotSel = null;
    if (job) {
      this.drawJobControl(area, st, job);
      return;
    }
    const r = this.shown();
    if (!r) return;
    const built = this.crafting.isBuilt(this.station);
    const can = batchable(r);
    const max0 = this.crafting.maxBatch(r);
    if (this.batch > Math.max(1, max0)) this.batch = Math.max(1, Math.min(max0, MAX_BATCH));
    const check = this.crafting.check(r, this.batch);
    const pad = 10;
    const icon = 30;
    let x = area.x + pad;
    const y = area.y + 10;
    for (const [item, n] of Object.entries(r.inputs) as [ItemId, number][]) {
      const need = n * this.batch, have = this.crafting.has(item);
      this.stack(x, y, icon, this.icons.items[item], `${need}`, have >= need ? COLORS.ink : COLORS.warn, have < need);
      x += icon + 16;
    }
    arrow(g, x - 2, y + icon / 2, COLORS.dim);
    x += 26;
    for (const o of r.outputs) {
      this.stack(x, y, icon, this.iconFor(o), o.kind === 'item' ? `${o.n * this.batch}` : '', COLORS.ok, false);
      x += icon + 16;
    }
    // nome e tempo, ao lado dos ícones
    const tx = x + 6;
    const tw = area.x + area.w - 46 - tx;
    const others = this.crafting.freeSlot(this.station) >= 0 ? this.crafting.slots(this.station).filter((j) => j && !j.ready && !j.paused).length : 0;
    const speed = this.energy.speed(this.station);
    const est = (recipeSeconds(r, this.batch) * (others + 1)) / Math.max(0.0001, speed);
    g.textAlign = 'left';
    if (tw > 80) {
      g.fillStyle = COLORS.ink;
      g.font = `600 13px ${FONT_UI}`;
      g.fillText(fitText(g, r.outputs.map(outName).join(' + '), tw), tx, y + 12);
      g.fillStyle = COLORS.dim;
      g.font = `500 10px ${MONO}`;
      let hint = `${t('craft.k.time')} ${humanTime(speed > 0.001 ? est : Infinity)}`;
      if (can && this.batch > 1) hint += ` · ${humanTime(unitSeconds(r) / Math.max(0.0001, speed))} ${t('craft.k.each')}`;
      if (others > 0) hint += ` · ${t('craft.sharing', { n: others + 1 })}`;
      g.fillText(fitText(g, hint.toUpperCase(), tw), tx, y + 28);
    }
    const qb = { x: area.x + area.w - 36, y: area.y + 8, w: 28, h: 28 };
    g.fillStyle = this.info ? st.accent : 'rgba(255,255,255,0.08)';
    roundRect(g, qb, 14);
    g.fill();
    g.fillStyle = this.info ? '#120f26' : COLORS.ink;
    g.font = `700 14px ${MONO}`;
    g.textAlign = 'center';
    g.fillText('?', qb.x + 14, qb.y + 19);
    this.hit('info', { x: qb.x - 6, y: qb.y - 6, w: qb.w + 12, h: qb.h + 12 }, () => (this.info = !this.info));
    // quantidade e botão
    const bh = 38;
    const by = area.y + area.h - 10 - bh;
    let bx = area.x + pad;
    if (can && built) {
      const top = Math.max(1, Math.min(max0, MAX_BATCH));
      const ghost = { color: 'rgba(255,255,255,0.1)', ink: COLORS.ink };
      this.button('minus', { x: bx, y: by, w: bh, h: bh }, '−', { ...ghost, enabled: this.batch > 1 }, () => (this.batch = Math.max(1, this.batch - 1)));
      g.fillStyle = COLORS.ink;
      g.font = `700 15px ${MONO}`;
      g.textAlign = 'center';
      g.fillText(`${this.batch}×`, bx + bh + 22, by + 25);
      this.button('plus', { x: bx + bh + 44, y: by, w: bh, h: bh }, '+', { ...ghost, enabled: this.batch < top }, () => (this.batch = Math.min(top, this.batch + 1)));
      this.button('max', { x: bx + bh * 2 + 50, y: by, w: 58, h: bh }, t('craft.all'), { ...ghost, enabled: top > 1 && this.batch < top }, () => (this.batch = top));
      bx += bh * 2 + 116;
    }
    let lbl: string;
    if (!built) lbl = t('craft.buildAtBench');
    else if (check.owned) lbl = r.outputs[0].kind === 'station' ? t('craft.installedTag') : t('craft.owned');
    else if (check.pending) lbl = t('craft.working');
    else if (check.full) lbl = t('craft.slotsFull');
    else if (check.missing.length) lbl = t('craft.missing');
    else lbl = this.batch > 1 ? t('craft.makeN', { n: this.batch }) : t('craft.make');
    const bw = Math.max(110, Math.min(240, area.x + area.w - pad - bx));
    this.button('make', { x: area.x + area.w - pad - bw, y: by, w: bw, h: bh }, lbl, { color: st.accent, enabled: check.ok }, () => {
      if (this.crafting.check(r, this.batch).ok) this.onCraft?.(r, this.batch);
    });
    if (this.info) this.drawInfo(area, r, st);
  }

  /** vaga escolhida: o que está fazendo, e Pegar, Pausar/Retomar, Cancelar */
  private drawJobControl(area: Rect, st: StationData, j: JobView): void {
    const g = this.g;
    const i = j.slot;
    const icon = 32;
    const x = area.x + 10, y = area.y + 10;
    this.stack(x, y, icon, this.iconFor(j.recipe.outputs[0]), j.batch > 1 ? `${j.batch}` : '', COLORS.ink, false);
    const tx = x + icon + 14;
    g.textAlign = 'left';
    g.fillStyle = st.accent;
    g.font = `700 10px ${MONO}`;
    label(g, `${t('craft.k.slot')}${i + 1}`, tx, y + 9, 1);
    g.fillStyle = COLORS.ink;
    g.font = `600 13px ${FONT_UI}`;
    g.fillText(fitText(g, j.recipe.outputs.map(outName).join(' + '), area.x + area.w - 50 - tx), tx, y + 25);
    g.fillStyle = COLORS.dim;
    g.font = `500 10px ${MONO}`;
    const state = j.leftover ? t('craft.k.leftover') : j.ready ? t('craft.k.done') : j.paused ? t('craft.k.paused') : `${t('craft.k.left')} ${clock(j.remaining)}`;
    g.fillText(fitText(g, `${j.units}/${j.batch} ${t('craft.k.ready')} · ${state}`.toUpperCase(), area.x + area.w - 50 - tx), tx, y + 40);
    this.button('close-job', { x: area.x + area.w - 36, y: area.y + 8, w: 28, h: 28 }, '×', { color: 'rgba(255,255,255,0.08)', ink: COLORS.ink }, () => (this.slotSel = null));
    const bh = 38, by = area.y + area.h - 10 - bh;
    const bw = Math.min(150, (area.w - 36) / 3);
    let bx = area.x + area.w - 10 - bw;
    this.button(
      'take-slot', { x: bx, y: by, w: bw, h: bh }, j.waitingCount ? t('craft.takeN', { n: j.waitingCount }) : t('craft.take'),
      { color: COLORS.ok, enabled: j.waitingCount > 0 }, () => this.onTake?.(this.station, i),
    );
    if (!j.ready && !j.leftover) {
      bx -= bw + 8;
      this.button('pause', { x: bx, y: by, w: bw, h: bh }, j.paused ? t('craft.resume') : t('craft.pause'), { color: COLORS.work }, () => this.onPause?.(this.station, i));
      bx -= bw + 8;
      const sure = this.time - this.confirmCancel < 3;
      this.button(
        'cancel', { x: bx, y: by, w: bw, h: bh }, sure ? t('craft.cancelSure') : t('craft.cancel'),
        { color: sure ? COLORS.warn : 'rgba(255,154,133,0.18)', ink: sure ? '#120f26' : COLORS.warn },
        () => {
          if (sure) {
            this.onCancel?.(this.station, i);
            this.slotSel = null;
            this.confirmCancel = -10;
          } else this.confirmCancel = this.time;
        },
      );
    }
  }

  /** ícone com a quantidade embaixo à direita */
  private stack(x: number, y: number, s: number, src: string | undefined, n: string, color: string, dim: boolean): void {
    const g = this.g;
    g.fillStyle = 'rgba(255,255,255,0.05)';
    roundRect(g, { x: x - 3, y: y - 3, w: s + 6, h: s + 6 }, 7);
    g.fill();
    const i = this.img(src);
    g.globalAlpha = dim ? 0.45 : 1;
    if (i) g.drawImage(i, x, y, s, s);
    g.globalAlpha = 1;
    if (!n) return;
    g.font = `700 11px ${MONO}`;
    g.textAlign = 'right';
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(4,8,22,0.9)';
    g.strokeText(n, x + s + 5, y + s + 3);
    g.fillStyle = color;
    g.fillText(n, x + s + 5, y + s + 3);
  }

  /** a ciência da receita, por cima da parte de baixo */
  private drawInfo(area: Rect, r: Recipe, st: StationData): void {
    const g = this.g;
    const box = { x: area.x + 4, y: area.y + 4, w: area.w - 46, h: area.h - 8 };
    g.fillStyle = 'rgba(8,12,30,0.98)';
    roundRect(g, box, 10);
    g.fill();
    g.strokeStyle = hexA(st.accent, 0.5);
    g.lineWidth = 1;
    g.stroke();
    this.hit('info-box', box, () => (this.info = false));
    const x = box.x + 12;
    let y = box.y + 18;
    g.textAlign = 'left';
    g.fillStyle = st.accent;
    g.font = `500 12px ${MONO}`;
    g.fillText(fitText(g, r.process.reaction, box.w - 24), x, y);
    y += 18;
    g.fillStyle = COLORS.ink;
    g.font = `500 10px ${MONO}`;
    g.fillText(fitText(g, r.process.steps.map((s, i) => `${i + 1}.${s}`).join('  ').toUpperCase(), box.w - 24), x, y);
    y += 17;
    g.fillStyle = COLORS.dim;
    g.font = `400 11.5px ${FONT_UI}`;
    for (const line of wrapText(g, r.process.note, box.w - 24)) {
      if (y > box.y + box.h - 6) break;
      g.fillText(line, x, y);
      y += 15;
    }
  }
}

/** moldura de módulo do painel */
function frame(g: CanvasRenderingContext2D, r: Rect, color: string): void {
  g.fillStyle = 'rgba(8,13,32,0.85)';
  roundRect(g, r, 10);
  g.fill();
  g.strokeStyle = color;
  g.lineWidth = 1.2;
  g.stroke();
}

/** texto com espaço entre as letras (rótulos de painel) */
function label(g: CanvasRenderingContext2D, text: string, x: number, y: number, spacing: number, align: 'left' | 'center' = 'left'): void {
  const c = g as CanvasRenderingContext2D & { letterSpacing?: string };
  const has = 'letterSpacing' in c;
  const prev = c.letterSpacing;
  if (has) c.letterSpacing = `${spacing}px`;
  g.textAlign = align;
  g.fillText(text, x, y);
  if (has) c.letterSpacing = prev ?? '0px';
}

function arrow(g: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  g.strokeStyle = color;
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x + 18, y);
  g.moveTo(x + 12, y - 5);
  g.lineTo(x + 18, y);
  g.lineTo(x + 12, y + 5);
  g.stroke();
}
