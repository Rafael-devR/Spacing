// Tela cheia das estações (docs/design/CRAFTING.md e INTERFACE.md), desenhada em Canvas. Esquerda: receitas.
// Direita, em cima: a máquina com as vagas (cadinhos, células, mesa da impressora). Cada pontinho que se mexe é
// alguma coisa de verdade: um minério saindo do funil e entrando na vaga, um produto saindo para a bandeja, ou um
// pacote de energia vindo do sol ou da bateria e se dividindo entre as vagas que trabalham. Embaixo: a receita
// escolhida, quantas vezes fazer e o botão. Poucos números: tempo e quantidades; o resto é cor, barra e movimento.
import { EQUIPMENT, type EquipId } from '../data/equipment';
import { ITEMS, type ItemId } from '../data/items';
import { batchable, MAX_BATCH, RECIPES, recipeById, recipeSeconds, type Recipe, type RecipeOutput } from '../data/recipes';
import { STATIONS, type StationData, type StationId } from '../data/stations';
import { t } from '../i18n';
import type { Crafting, JobView } from '../systems/Crafting';
import { boltIcon, CanvasScreen, COLORS, FONT_TITLE, FONT_UI, fitText, hexA, roundRect, sunIcon, wrapText, type Rect } from './canvasScreen';

type Icons = { items: Record<ItemId, string>; equip: Record<EquipId, string>; stations: Partial<Record<StationId, string>> };

/** o que a tela precisa saber da energia (systems/Power.ts) */
export interface EnergyView {
  /** 0..1: energia que a estação recebe agora */
  speed(station: StationId): number;
}

const outName = (o: RecipeOutput): string =>
  o.kind === 'item' ? ITEMS[o.item].name : o.kind === 'equip' ? EQUIPMENT[o.equip].name : STATIONS[o.station].name;

/** 130 → "2 min 10 s" (arredondado para ficar fácil de ler) */
export function humanTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return t('craft.noEnergy');
  const s = Math.max(1, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const r = Math.round(s / 10) * 10;
  const m = Math.floor(r / 60), ss = r % 60;
  return ss ? `${m} min ${ss} s` : `${m} min`;
}

/** relógio curto para as vagas: 75 → "1:15" */
const clock = (seconds: number): string => {
  if (!Number.isFinite(seconds)) return '—';
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

interface Token {
  img: HTMLImageElement | null;
  tint: string;
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
  dur: number;
}

/** o que já foi mostrado de cada trabalho (para cada minério virar um pontinho uma vez só) */
interface Seen {
  inn: number;
  out: number;
}

export class CraftPanel extends CanvasScreen {
  onCraft: ((r: Recipe, batch: number) => void) | null = null;
  onTake: ((station: StationId) => void) | null = null;
  private icons: Icons = { items: {} as Record<ItemId, string>, equip: {} as Record<EquipId, string>, stations: {} };
  private station: StationId = 'workbench';
  private selected: string | null = null;
  private batch = 1;
  private info = false;
  private tokens: Token[] = [];
  private sparks: Spark[] = [];
  private sparkT = 0;
  private sparkRR = 0;
  private readonly seen = new Map<string, Seen>();

  constructor(
    private readonly crafting: Crafting,
    private readonly energy: EnergyView,
  ) {
    super('#craft');
  }

  setIcons(items: Record<ItemId, string>, equip: Record<EquipId, string>, stations: Partial<Record<StationId, string>> = {}): void {
    this.icons = { items, equip, stations };
  }

  /** a estação aberta agora */
  get current(): StationId {
    return this.station;
  }

  show(station: StationId = 'workbench'): void {
    if (!this.open || this.station !== station) {
      this.station = station;
      this.selected = null;
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

  /** receita mostrada embaixo: a escolhida, ou a primeira que dá para fazer */
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
    const top = this.topBar(st.name, st.tagline, st.accent);
    this.energyChip(st, top);
    const pad = 12;
    const L = this.safe.l + pad, R = this.W - this.safe.r - pad, B = this.H - this.safe.b - pad;
    const landscape = this.W >= this.H * 1.05;
    let list: Rect, machine: Rect, control: Rect;
    if (landscape) {
      const lw = Math.max(190, Math.min(290, this.W * 0.28));
      list = { x: L, y: top + 2, w: lw, h: B - top - 2 };
      const rx = L + lw + pad, rw = R - rx, rh = B - top - 2;
      machine = { x: rx, y: top + 2, w: rw, h: Math.round(rh * 0.5) };
      control = { x: rx, y: machine.y + machine.h + 8, w: rw, h: rh - machine.h - 8 };
    } else {
      list = { x: L, y: top + 2, w: R - L, h: 78 };
      const ry = list.y + list.h + 8, rh = B - ry;
      machine = { x: L, y: ry, w: R - L, h: Math.round(rh * 0.52) };
      control = { x: L, y: machine.y + machine.h + 8, w: R - L, h: rh - machine.h - 8 };
    }
    this.drawList(list, !landscape);
    this.drawMachine(machine, st, dt);
    this.drawControl(control, st);
  }

  /** selo da energia no canto de cima: de onde vem e se está cheia, com barra e palavras */
  private energyChip(st: StationData, top: number): void {
    const g = this.g;
    const sp = this.energy.speed(this.station);
    const w = Math.min(230, this.W * 0.3), h = 36;
    const r = { x: this.W - this.safe.r - 12 - w, y: top - h - 10, w, h };
    g.fillStyle = 'rgba(255,255,255,0.06)';
    roundRect(g, r, 18);
    g.fill();
    const cx = r.x + 20, cy = r.y + h / 2;
    if (st.energy === 'sun') sunIcon(g, cx, cy, 7, this.time);
    else boltIcon(g, cx, cy, 9, sp > 0.99 ? '#ffd84a' : COLORS.warn);
    g.fillStyle = COLORS.ink;
    g.font = `500 12px ${FONT_UI}`;
    g.textAlign = 'left';
    const word = sp > 0.99 ? t('energy.full') : sp > 0.5 ? t('energy.weak') : sp > 0.01 ? t('energy.low') : t('energy.none');
    g.fillText(fitText(g, `${st.energyName} · ${word}`, w - 48), r.x + 36, r.y + 15);
    const bar = { x: r.x + 36, y: r.y + 22, w: w - 50, h: 5 };
    g.fillStyle = 'rgba(255,255,255,0.12)';
    roundRect(g, bar, 2.5);
    g.fill();
    g.fillStyle = sp > 0.99 ? COLORS.ok : sp > 0.5 ? COLORS.work : COLORS.warn;
    roundRect(g, { ...bar, w: bar.w * Math.max(0.03, sp) }, 2.5);
    g.fill();
  }

  // ---------- lista de receitas ----------

  private drawList(area: Rect, horizontal: boolean): void {
    const g = this.g;
    const built = this.crafting.isBuilt(this.station);
    g.fillStyle = COLORS.panel;
    roundRect(g, area, 14);
    g.fill();
    if (!built) {
      g.fillStyle = COLORS.dim;
      g.font = `400 13px ${FONT_UI}`;
      g.textAlign = 'left';
      wrapText(g, t('craft.locked', { name: STATIONS[this.station].name }), area.w - 28).forEach((line, i) =>
        g.fillText(line, area.x + 14, area.y + 26 + i * 18),
      );
      return;
    }
    const recipes = this.crafting.recipes(this.station);
    const shown = this.shown();
    const cardH = horizontal ? area.h - 12 : 60;
    const cardW = horizontal ? 168 : area.w - 12;
    const gap = 6;
    const content = recipes.length * ((horizontal ? cardW : cardH) + gap) + gap;
    this.scrolls.push({ id: 'list', ...area, content, horizontal });
    const off = this.scrollOf('list');
    g.save();
    roundRect(g, area, 14);
    g.clip();
    recipes.forEach((r, i) => {
      const k = gap + i * ((horizontal ? cardW : cardH) + gap) - off;
      const card = horizontal ? { x: area.x + k, y: area.y + 6, w: cardW, h: cardH } : { x: area.x + 6, y: area.y + k, w: cardW, h: cardH };
      if (horizontal ? card.x + card.w < area.x || card.x > area.x + area.w : card.y + card.h < area.y || card.y > area.y + area.h) return;
      this.recipeCard(card, r, shown?.id === r.id);
      this.hit(`r:${r.id}`, card, () => {
        if (this.selected !== r.id) this.batch = 1;
        this.selected = r.id;
        this.info = false;
      });
    });
    g.restore();
  }

  private recipeCard(c: Rect, r: Recipe, on: boolean): void {
    const g = this.g;
    const st = STATIONS[r.station];
    const check = this.crafting.check(r);
    g.fillStyle = on ? hexA(st.accent, 0.16) : 'rgba(255,255,255,0.035)';
    roundRect(g, c, 10);
    g.fill();
    if (on) {
      g.strokeStyle = st.accent;
      g.lineWidth = 1.5;
      g.stroke();
    }
    const out = r.outputs[0];
    const s = c.h - 16;
    const dim = check.owned ? 0.45 : 1;
    g.globalAlpha = dim;
    const ic = this.img(this.iconFor(out));
    if (ic) g.drawImage(ic, c.x + 6, c.y + 8, s, s);
    g.fillStyle = COLORS.ink;
    g.font = `500 13px ${FONT_UI}`;
    g.textAlign = 'left';
    g.fillText(fitText(g, outName(out), c.w - s - 42), c.x + s + 14, c.y + 22);
    // ingredientes em miniatura (de uma vez)
    let x = c.x + s + 14;
    for (const [item, n] of Object.entries(r.inputs) as [ItemId, number][]) {
      const have = this.crafting.has(item) >= n;
      if (x + 34 > c.x + c.w - 6) break;
      g.globalAlpha = dim * (have ? 1 : 0.4);
      const mi = this.img(this.icons.items[item]);
      if (mi) g.drawImage(mi, x, c.y + c.h - 30, 20, 20);
      g.fillStyle = have ? COLORS.dim : COLORS.warn;
      g.font = `500 10px ${FONT_UI}`;
      g.fillText(`${n}`, x + 23, c.y + c.h - 13);
      x += 34;
    }
    g.globalAlpha = 1;
    // quantas dá para fazer agora, ou já tem
    const badge = check.owned ? '✓' : check.max > 0 ? (batchable(r) ? `×${check.max}` : '●') : '';
    if (badge) {
      g.font = `600 11px ${FONT_UI}`;
      g.textAlign = 'right';
      g.fillStyle = check.owned ? COLORS.dim : COLORS.ok;
      g.fillText(badge, c.x + c.w - 8, c.y + 18);
    }
  }

  // ---------- a máquina, com as vagas ----------

  private drawMachine(area: Rect, st: StationData, dt: number): void {
    const g = this.g;
    g.fillStyle = 'rgba(4,8,22,0.55)';
    roundRect(g, area, 14);
    g.fill();
    g.strokeStyle = hexA(st.accent, 0.25);
    g.lineWidth = 1;
    g.stroke();
    const built = this.crafting.isBuilt(this.station);
    const slots = this.crafting.slots(this.station);
    const speed = this.energy.speed(this.station);
    // fonte de energia no alto
    const src = { x: area.x + area.w / 2, y: area.y + 20 };
    if (st.energy === 'sun') sunIcon(g, src.x, src.y, 9, this.time);
    else boltIcon(g, src.x, src.y, 11, speed > 0.99 ? '#ffd84a' : COLORS.warn);
    // vagas
    const n = slots.length;
    const gap = 14;
    const sw = Math.min(170, (area.w - 28 - gap * (n - 1)) / n);
    const sh = Math.max(70, area.h - 50);
    const x0 = area.x + (area.w - (sw * n + gap * (n - 1))) / 2;
    const rects: Rect[] = slots.map((_, i) => ({ x: x0 + i * (sw + gap), y: area.y + 42, w: sw, h: sh }));
    const working = slots.map((j) => !!j && !j.ready);
    // fios da fonte até as vagas (por onde passa a energia)
    rects.forEach((r, i) => {
      g.strokeStyle = working[i] ? hexA(st.accent, 0.4) : 'rgba(255,255,255,0.07)';
      g.lineWidth = working[i] ? 2 : 1;
      g.beginPath();
      g.moveTo(src.x, src.y + 12);
      g.quadraticCurveTo(r.x + r.w / 2, src.y + 12, r.x + r.w / 2, r.y);
      g.stroke();
    });
    // pacotes de energia: saem na velocidade que a estação recebe e se dividem entre as vagas que trabalham
    const active = working.map((w, i) => (w ? i : -1)).filter((i) => i >= 0);
    this.sparkT -= dt;
    if (built && active.length && speed > 0.01 && this.sparkT <= 0) {
      this.sparkT = 1 / (12 * speed);
      this.sparks.push({ slot: active[this.sparkRR++ % active.length], t: 0, dur: 0.7 });
    }
    this.sparks = this.sparks.filter((s) => (s.t += dt) < s.dur && working[s.slot]);
    for (const s of this.sparks) {
      const r = rects[s.slot];
      const u = s.t / s.dur, v = 1 - u;
      const tx = r.x + r.w / 2;
      const px = v * v * src.x + 2 * v * u * tx + u * u * tx;
      const py = v * v * (src.y + 12) + 2 * v * u * (src.y + 12) + u * u * r.y;
      g.fillStyle = st.energy === 'sun' ? '#ffd27a' : '#9fe8ff';
      g.globalAlpha = Math.sin(Math.PI * u);
      g.beginPath();
      g.arc(px, py, 2.4, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
    slots.forEach((j, i) => this.drawSlot(rects[i], st, j, speed, i));
    // minérios e produtos voando
    this.tokens = this.tokens.filter((k) => (k.t += dt) < k.dur);
    for (const k of this.tokens) {
      const u = k.t / k.dur, e = u * u * (3 - 2 * u);
      const x = k.x0 + (k.x1 - k.x0) * e, y = k.y0 + (k.y1 - k.y0) * e - Math.sin(Math.PI * u) * k.arc;
      if (k.img) g.drawImage(k.img, x - k.size / 2, y - k.size / 2, k.size, k.size);
      else {
        g.fillStyle = k.tint;
        g.fillRect(x - 3, y - 3, 6, 6);
      }
    }
    // pegar tudo
    if (this.crafting.hasReady(this.station)) {
      const b = { x: area.x + area.w - 132, y: area.y + 6, w: 122, h: 32 };
      this.button('take', b, t('craft.takeAll'), { color: COLORS.ok }, () => this.onTake?.(this.station));
    }
    if (!built) {
      g.fillStyle = COLORS.dim;
      g.font = `500 13px ${FONT_UI}`;
      g.textAlign = 'center';
      g.fillText(t('craft.status.locked'), area.x + area.w / 2, area.y + area.h / 2);
    }
  }

  private drawSlot(r: Rect, st: StationData, j: JobView | null, speed: number, i: number): void {
    const g = this.g;
    const built = this.crafting.isBuilt(this.station);
    if (!j) {
      g.setLineDash([5, 5]);
      g.strokeStyle = built ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.08)';
      g.lineWidth = 1.5;
      roundRect(g, r, 12);
      g.stroke();
      g.setLineDash([]);
      if (built) {
        g.fillStyle = COLORS.faint;
        g.font = `500 12px ${FONT_UI}`;
        g.textAlign = 'center';
        g.fillText(t('craft.slotFree'), r.x + r.w / 2, r.y + r.h / 2 + 4);
      }
      return;
    }
    const heat = j.ready ? 0.15 : Math.min(1, speed * (0.4 + 0.6 * j.share));
    this.chamber(r, st, j, heat);
    g.strokeStyle = j.ready ? COLORS.ok : hexA(st.accent, 0.7);
    g.lineWidth = j.ready ? 2.5 : 1.5;
    g.globalAlpha = j.ready ? 0.6 + 0.4 * Math.sin(this.time * 5) : 1;
    roundRect(g, r, 12);
    g.stroke();
    g.globalAlpha = 1;
    const seq = inputSequence(j.recipe, j.batch);
    const outs = outputSequence(j.recipe, j.batch);
    const key = `${j.station}:${j.slot}:${j.recipe.id}:${j.batch}`;
    const usedNow = Math.min(seq.length, Math.floor(j.progress * seq.length + 1e-6));
    const madeNow = j.ready ? outs.length : Math.min(outs.length, Math.floor(j.progress * outs.length + 1e-6));
    let seen = this.seen.get(key);
    if (!seen || seen.inn > usedNow) {
      seen = { inn: usedNow, out: madeNow };
      this.seen.set(key, seen);
    }
    const hop = { x: r.x + 8, y: r.y + 8, s: 28 };
    const tray = { x: r.x + r.w / 2, y: r.y + r.h - 22 };
    const mouth = { x: r.x + r.w / 2, y: r.y + r.h * 0.45 };
    // cada minério que a máquina gastou vira um pontinho do funil para dentro
    while (seen.inn < usedNow) {
      const item = seq[seen.inn++];
      this.tokens.push({
        img: this.img(this.icons.items[item]), tint: ITEMS[item].tint, x0: hop.x + hop.s / 2, y0: hop.y + hop.s / 2, x1: mouth.x, y1: mouth.y,
        t: 0, dur: 0.6, size: 18, arc: 16,
      });
    }
    // cada produto que ficou pronto sai para a bandeja
    while (seen.out < madeNow) {
      const o = outs[seen.out++];
      this.tokens.push({
        img: this.img(this.iconFor(o)), tint: st.accent, x0: mouth.x, y0: mouth.y, x1: tray.x - 16, y1: tray.y, t: 0, dur: 0.7, size: 22, arc: 20,
      });
    }
    // funil: o que ainda vai entrar
    const left = seq.length - usedNow;
    if (left > 0) {
      const hi = this.img(this.icons.items[seq[usedNow]]);
      g.fillStyle = 'rgba(4,8,22,0.85)';
      roundRect(g, { x: hop.x - 2, y: hop.y - 2, w: hop.s + 4, h: hop.s + 4 }, 8);
      g.fill();
      if (hi) g.drawImage(hi, hop.x, hop.y, hop.s, hop.s);
      g.fillStyle = COLORS.ink;
      g.font = `600 11px ${FONT_UI}`;
      g.textAlign = 'left';
      g.fillText(`${left}`, hop.x + hop.s + 4, hop.y + hop.s - 2);
    }
    // bandeja: o que já saiu
    const made = Math.min(seen.out, outs.length);
    const oi = this.img(this.iconFor(j.recipe.outputs[0]));
    g.fillStyle = 'rgba(4,8,22,0.8)';
    roundRect(g, { x: tray.x - 34, y: tray.y - 13, w: 68, h: 26 }, 8);
    g.fill();
    if (oi) {
      g.globalAlpha = made ? 1 : 0.35;
      g.drawImage(oi, tray.x - 30, tray.y - 12, 24, 24);
      g.globalAlpha = 1;
    }
    g.fillStyle = made ? COLORS.ink : COLORS.faint;
    g.font = `600 12px ${FONT_UI}`;
    g.textAlign = 'left';
    g.fillText(`${made}/${outs.length}`, tray.x - 2, tray.y + 4);
    // progresso e tempo
    const bar = { x: r.x + 10, y: r.y + r.h - 5, w: r.w - 20, h: 3 };
    g.fillStyle = 'rgba(255,255,255,0.12)';
    roundRect(g, bar, 2);
    g.fill();
    g.fillStyle = j.ready ? COLORS.ok : st.accent;
    roundRect(g, { ...bar, w: bar.w * j.progress }, 2);
    g.fill();
    g.font = `600 13px ${FONT_UI}`;
    g.textAlign = 'right';
    g.fillStyle = j.ready ? COLORS.ok : COLORS.ink;
    g.fillText(j.ready ? t('craft.status.ready') : clock(j.remaining), r.x + r.w - 8, r.y + 20);
    if (!j.ready && r.h > 110) {
      g.fillStyle = COLORS.dim;
      g.font = `500 10px ${FONT_UI}`;
      g.textAlign = 'center';
      g.fillText(fitText(g, j.recipe.process.steps[j.step], r.w - 16), r.x + r.w / 2, r.y + 44);
    }
    if (j.ready) this.hit(`slot:${i}`, r, () => this.onTake?.(this.station));
    else this.hit(`slot:${i}`, r, () => (this.selected = j.recipe.id));
  }

  /** dentro da vaga: cadinho com metal fundido, célula com bolhas, ou mesa da impressora */
  private chamber(r: Rect, st: StationData, j: JobView, heat: number): void {
    const g = this.g;
    g.save();
    roundRect(g, r, 12);
    g.clip();
    g.fillStyle = 'rgba(6,10,24,0.95)';
    g.fillRect(r.x, r.y, r.w, r.h);
    const cx = r.x + r.w / 2;
    if (st.chamber === 'heat') {
      // brilho do calor (cor pela temperatura da receita), banho fundido subindo com o progresso
      const temp = j.recipe.process.temp ?? 1200;
      const hot = Math.min(1, temp / 1600) * heat;
      const gr = g.createRadialGradient(cx, r.y + r.h * 0.75, 4, cx, r.y + r.h * 0.75, r.w);
      gr.addColorStop(0, `rgba(255,${Math.round(120 + 120 * hot)},${Math.round(40 + 80 * hot * hot)},${0.2 + 0.7 * heat})`);
      gr.addColorStop(1, 'rgba(60,10,0,0)');
      g.fillStyle = gr;
      g.fillRect(r.x, r.y, r.w, r.h);
      const cw = r.w * 0.56, ch = r.h * 0.42, cy = r.y + r.h * 0.4;
      g.fillStyle = '#3a3340';
      g.beginPath();
      g.moveTo(cx - cw / 2, cy);
      g.lineTo(cx + cw / 2, cy);
      g.lineTo(cx + cw * 0.38, cy + ch);
      g.lineTo(cx - cw * 0.38, cy + ch);
      g.closePath();
      g.fill();
      const lvl = ch * (0.15 + 0.75 * j.progress);
      const top = cy + ch - lvl;
      const k = (ch - lvl) / ch;
      g.fillStyle = `rgba(255,${Math.round(150 + 90 * hot)},${Math.round(60 + 60 * hot)},${0.5 + 0.5 * heat})`;
      g.beginPath();
      g.moveTo(cx - cw * (0.38 + 0.12 * (1 - k)), top + Math.sin(this.time * 3) * 1.5);
      g.lineTo(cx + cw * (0.38 + 0.12 * (1 - k)), top - Math.sin(this.time * 3) * 1.5);
      g.lineTo(cx + cw * 0.38, cy + ch);
      g.lineTo(cx - cw * 0.38, cy + ch);
      g.closePath();
      g.fill();
      for (let k2 = 0; k2 < 10; k2++) {
        const f = (this.time * (0.3 + (k2 % 4) * 0.08) + k2 * 0.17) % 1;
        g.fillStyle = `rgba(255,${190 + (k2 % 3) * 20},90,${(1 - f) * heat})`;
        g.fillRect(cx - cw / 2 + (((k2 * 37) % 100) / 100) * cw, top - f * r.h * 0.4, 2, 2);
      }
    } else if (st.chamber === 'cell') {
      const lt = r.y + r.h * 0.3;
      g.fillStyle = `rgba(40,${Math.round(120 + 70 * heat)},${Math.round(200 + 40 * heat)},0.5)`;
      g.fillRect(r.x, lt, r.w, r.h);
      const ex = [r.x + r.w * 0.33, r.x + r.w * 0.67];
      g.fillStyle = '#8c90a0';
      for (const e of ex) g.fillRect(e - 2.5, r.y + 30, 5, r.h - 48);
      // bolhas: cada lado na cor do gás que sai nele (a água solta o dobro de H₂)
      const tints = j.recipe.outputs.map((o) => (o.kind === 'item' ? ITEMS[o.item].tint : '#ffffff'));
      const counts = [j.recipe.id === 'water' ? 12 : 8, 6];
      for (let side = 0; side < 2; side++)
        for (let k2 = 0; k2 < counts[side]; k2++) {
          const f = (this.time * (0.35 + (k2 % 4) * 0.08) + k2 * 0.173) % 1;
          g.fillStyle = tints[side] ?? '#ffffff';
          g.globalAlpha = heat * 0.9;
          g.beginPath();
          g.arc(ex[side] + (side ? 7 : -7) + Math.sin(f * 10 + k2) * 3, r.y + r.h - 22 - f * (r.h - 22 - lt), 1.5 + (k2 % 3) * 0.6, 0, Math.PI * 2);
          g.fill();
        }
      g.globalAlpha = 1;
    } else {
      // impressora: a peça aparece de baixo para cima, com a linha da camada
      const oi = this.img(this.iconFor(j.recipe.outputs[0]));
      const s = Math.min(r.w, r.h) * 0.6;
      const px = cx - s / 2, py = r.y + (r.h - s) / 2;
      if (oi) {
        g.globalAlpha = 0.2;
        g.drawImage(oi, px, py, s, s);
        g.globalAlpha = 1;
        const done = j.progress;
        g.save();
        g.beginPath();
        g.rect(px, py + s * (1 - done), s, s * done + 1);
        g.clip();
        g.drawImage(oi, px, py, s, s);
        g.restore();
        if (!j.ready) {
          const ly = py + s * (1 - done);
          g.strokeStyle = `rgba(160,240,255,${0.5 + 0.5 * heat})`;
          g.lineWidth = 1.5;
          g.beginPath();
          g.moveTo(px - 6, ly);
          g.lineTo(px + s + 6, ly);
          g.stroke();
          const tx = px + s * (0.5 + 0.45 * Math.sin(this.time * 6));
          g.strokeStyle = `rgba(255,255,255,${0.7 * heat})`;
          g.beginPath();
          g.moveTo(cx, r.y);
          g.lineTo(tx, ly);
          g.stroke();
        }
      }
    }
    g.restore();
  }

  // ---------- receita escolhida e botão ----------

  private drawControl(area: Rect, st: StationData): void {
    const g = this.g;
    g.fillStyle = COLORS.panel;
    roundRect(g, area, 14);
    g.fill();
    const r = this.shown();
    if (!r) return;
    const built = this.crafting.isBuilt(this.station);
    const can = batchable(r);
    const max0 = this.crafting.maxBatch(r);
    if (this.batch > Math.max(1, max0)) this.batch = Math.max(1, Math.min(max0, MAX_BATCH));
    const check = this.crafting.check(r, this.batch);
    const pad = 14;
    // linha: ingredientes → produtos, na quantidade do lote
    const icon = Math.max(28, Math.min(40, (area.h - 120) * 0.9));
    let x = area.x + pad;
    const y = area.y + pad;
    for (const [item, n] of Object.entries(r.inputs) as [ItemId, number][]) {
      const need = n * this.batch, have = this.crafting.has(item);
      this.stack(x, y, icon, this.icons.items[item], `${need}`, have >= need ? COLORS.ink : COLORS.warn, have < need);
      x += icon + 18;
    }
    g.strokeStyle = COLORS.dim;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x, y + icon / 2);
    g.lineTo(x + 22, y + icon / 2);
    g.moveTo(x + 16, y + icon / 2 - 5);
    g.lineTo(x + 22, y + icon / 2);
    g.lineTo(x + 16, y + icon / 2 + 5);
    g.stroke();
    x += 36;
    for (const o of r.outputs) {
      this.stack(x, y, icon, this.iconFor(o), o.kind === 'item' ? `${o.n * this.batch}` : '', COLORS.ok, false);
      x += icon + 18;
    }
    // nome e quanto tempo leva
    const name = r.outputs.map(outName).join(' + ');
    g.fillStyle = COLORS.ink;
    g.font = `600 15px ${FONT_TITLE}`;
    g.textAlign = 'left';
    const ty = y + icon + 20;
    g.fillText(fitText(g, name, area.w - pad * 2 - 44), area.x + pad, ty);
    // se começar agora, divide a energia com os que já trabalham (só se houver vaga)
    const others = this.crafting.freeSlot(this.station) >= 0 ? this.crafting.slots(this.station).filter((j) => j && !j.ready).length : 0;
    const speed = this.energy.speed(this.station);
    const est = (recipeSeconds(r, this.batch) * (others + 1)) / Math.max(0.0001, speed);
    let hint = t('craft.takes', { time: humanTime(speed > 0.001 ? est : Infinity) });
    if (others > 0) hint += ' · ' + t('craft.sharing', { n: others + 1 });
    if (speed < 0.99) hint += ' · ' + t('craft.slowEnergy');
    g.fillStyle = COLORS.dim;
    g.font = `400 12px ${FONT_UI}`;
    g.fillText(fitText(g, hint, area.w - pad * 2), area.x + pad, ty + 17);
    // "?" abre a ciência da receita
    const qb = { x: area.x + area.w - 40, y: area.y + 10, w: 30, h: 30 };
    g.fillStyle = this.info ? st.accent : 'rgba(255,255,255,0.1)';
    roundRect(g, qb, 15);
    g.fill();
    g.fillStyle = this.info ? '#120f26' : COLORS.ink;
    g.font = `700 15px ${FONT_UI}`;
    g.textAlign = 'center';
    g.fillText('?', qb.x + 15, qb.y + 20);
    this.hit('info', { x: qb.x - 6, y: qb.y - 6, w: qb.w + 12, h: qb.h + 12 }, () => (this.info = !this.info));
    // quantidade e botão, embaixo
    const bh = 40;
    const by = Math.max(ty + 26, area.y + area.h - 12 - bh);
    let bx = area.x + pad;
    if (can && built) {
      const top = Math.max(1, Math.min(max0, MAX_BATCH));
      const ghost = { color: 'rgba(255,255,255,0.12)', ink: COLORS.ink };
      this.button('minus', { x: bx, y: by, w: bh, h: bh }, '−', { ...ghost, enabled: this.batch > 1 }, () => (this.batch = Math.max(1, this.batch - 1)));
      g.fillStyle = COLORS.ink;
      g.font = `600 18px ${FONT_TITLE}`;
      g.textAlign = 'center';
      g.fillText(`${this.batch}×`, bx + bh + 25, by + 27);
      this.button('plus', { x: bx + bh + 50, y: by, w: bh, h: bh }, '+', { ...ghost, enabled: this.batch < top }, () => (this.batch = Math.min(top, this.batch + 1)));
      this.button('max', { x: bx + bh * 2 + 58, y: by, w: 62, h: bh }, t('craft.all'), { ...ghost, enabled: top > 1 && this.batch < top }, () => (this.batch = top));
      bx += bh * 2 + 128;
    }
    let label: string;
    if (!built) label = t('craft.buildAtBench');
    else if (check.owned) label = r.outputs[0].kind === 'station' ? t('craft.installedTag') : t('craft.owned');
    else if (check.pending) label = t('craft.working');
    else if (check.full) label = t('craft.slotsFull');
    else if (check.missing.length) label = t('craft.missing');
    else label = this.batch > 1 ? t('craft.makeN', { n: this.batch }) : t('craft.make');
    const bw = Math.max(120, Math.min(260, area.x + area.w - pad - bx));
    this.button('make', { x: area.x + area.w - pad - bw, y: by, w: bw, h: bh }, label, { color: st.accent, enabled: check.ok }, () => {
      if (this.crafting.check(r, this.batch).ok) this.onCraft?.(r, this.batch);
    });
    if (this.info) this.drawInfo(area, r, st);
  }

  /** ícone com a quantidade embaixo à direita */
  private stack(x: number, y: number, s: number, src: string | undefined, n: string, color: string, dim: boolean): void {
    const g = this.g;
    g.fillStyle = 'rgba(255,255,255,0.06)';
    roundRect(g, { x: x - 3, y: y - 3, w: s + 6, h: s + 6 }, 8);
    g.fill();
    const i = this.img(src);
    g.globalAlpha = dim ? 0.45 : 1;
    if (i) g.drawImage(i, x, y, s, s);
    g.globalAlpha = 1;
    if (!n) return;
    g.font = `700 12px ${FONT_UI}`;
    g.textAlign = 'right';
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(4,8,22,0.9)';
    g.strokeText(n, x + s + 6, y + s + 4);
    g.fillStyle = color;
    g.fillText(n, x + s + 6, y + s + 4);
  }

  /** a ciência da receita, por cima da parte de baixo */
  private drawInfo(area: Rect, r: Recipe, st: StationData): void {
    const g = this.g;
    const box = { x: area.x + 6, y: area.y + 46, w: area.w - 12, h: area.h - 52 };
    g.fillStyle = 'rgba(8,12,30,0.98)';
    roundRect(g, box, 12);
    g.fill();
    g.strokeStyle = hexA(st.accent, 0.5);
    g.lineWidth = 1;
    g.stroke();
    this.hit('info-box', box, () => (this.info = false));
    const x = box.x + 14;
    let y = box.y + 22;
    g.textAlign = 'left';
    g.fillStyle = st.accent;
    g.font = `500 13px ui-monospace, Menlo, monospace`;
    g.fillText(fitText(g, r.process.reaction, box.w - 28), x, y);
    y += 22;
    g.font = `500 11px ${FONT_UI}`;
    let sx = x;
    r.process.steps.forEach((s, i) => {
      const label = `${i + 1}. ${s}`;
      const w = g.measureText(label).width + 14;
      if (sx + w > box.x + box.w - 10) return;
      g.fillStyle = 'rgba(255,255,255,0.08)';
      roundRect(g, { x: sx, y: y - 13, w, h: 20 }, 10);
      g.fill();
      g.fillStyle = COLORS.ink;
      g.fillText(label, sx + 7, y + 1);
      sx += w + 6;
    });
    y += 24;
    g.fillStyle = COLORS.dim;
    g.font = `400 12px ${FONT_UI}`;
    for (const line of wrapText(g, r.process.note, box.w - 28).slice(0, 3)) {
      if (y > box.y + box.h - 6) break;
      g.fillText(line, x, y);
      y += 16;
    }
    // por que demora: em palavras
    const why = (Object.keys(r.inputs) as ItemId[])
      .map((item) => {
        const tr = ITEMS[item].traits;
        const w: string[] = [];
        if (tr.heat >= 2) w.push(t('craft.why.heat'));
        if (tr.mass >= 2) w.push(t('craft.why.mass'));
        if (tr.rarity >= 2) w.push(t('craft.why.rare'));
        return w.length ? `${ITEMS[item].name}: ${w.join(', ')}` : '';
      })
      .filter(Boolean);
    if (why.length && y < box.y + box.h - 6) {
      g.fillStyle = COLORS.faint;
      g.fillText(fitText(g, `${t('craft.whyTime')} ${why.join(' · ')}`, box.w - 28), x, y + 2);
    }
  }
}

/** sequência dos minérios na ordem em que entram (cada pontinho é um minério de verdade) */
export function inputSequence(r: Recipe, batch: number): ItemId[] {
  const out: ItemId[] = [];
  for (let b = 0; b < batch; b++) for (const [item, n] of Object.entries(r.inputs) as [ItemId, number][]) for (let k = 0; k < n; k++) out.push(item);
  return out;
}

export function outputSequence(r: Recipe, batch: number): RecipeOutput[] {
  const out: RecipeOutput[] = [];
  for (let b = 0; b < batch; b++) for (const o of r.outputs) for (let k = 0; k < (o.kind === 'item' ? o.n : 1); k++) out.push(o);
  return out;
}
