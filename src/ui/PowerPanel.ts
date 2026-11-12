// Tela cheia da energia da base (docs/design/ENERGIA.md), aberta no console do habitat. Mostra de onde vem e para
// onde vai cada pedaço de energia: sol → painéis → bateria → máquinas. Cada pontinho que corre num fio é um pacote
// de energia; quanto mais energia passa, mais pontinhos e fio mais grosso. Quase sem números: frases curtas dizem o
// que está acontecendo e o que fazer.
import { POWER } from '../data/power';
import { STATIONS, type StationId } from '../data/stations';
import { t } from '../i18n';
import type { Power } from '../systems/Power';
import { boltIcon, CanvasScreen, COLORS, FONT_TITLE, FONT_UI, fitText, hexA, roundRect, sunIcon, wrapText, type Rect } from './canvasScreen';

interface Node extends Rect {
  id: string;
  label: string;
  sub: string;
  on: boolean;
  color: string;
}

interface Dot {
  wire: string;
  t: number;
  dur: number;
}

interface Wire {
  id: string;
  a: { x: number; y: number };
  b: { x: number; y: number };
  kw: number;
  color: string;
}

const ACCENT = '#ffd84a';

export class PowerPanel extends CanvasScreen {
  private dots: Dot[] = [];
  private readonly emitT = new Map<string, number>();

  constructor(private readonly power: Power) {
    super('#power');
  }

  show(): void {
    this.dots = [];
    this.openScreen();
  }

  protected draw(dt: number): void {
    const p = this.power;
    this.background(ACCENT);
    const top = this.topBar(t('power.title'), t('power.subtitle'), ACCENT);
    const pad = 14;
    const L = this.safe.l + pad, R = this.W - this.safe.r - pad, B = this.H - this.safe.b - pad;
    const area = { x: L, y: top + 4, w: R - L, h: B - top - 4 };
    const g = this.g;
    g.fillStyle = 'rgba(4,8,22,0.5)';
    roundRect(g, area, 14);
    g.fill();
    const textH = 54;
    const diag = { x: area.x, y: area.y, w: area.w, h: area.h - textH };

    // colunas: sol | geração | bateria | consumo
    const col = (k: number): number => diag.x + diag.w * k;
    const nodeW = Math.min(170, diag.w * 0.2), nodeH = 40;
    const sun = { x: col(0.07), y: diag.y + diag.h / 2 };
    const panelsAll = p.panels;
    const linked = panelsAll.filter((x) => x.linked);
    const shaded = linked.filter((x) => x.light < 0.5).length;
    const far = panelsAll.length - linked.length;
    const roofKw = p.roofKw;
    const groundKw = linked.reduce((s, x) => s + x.kw, 0);
    const gens: Node[] = [
      { id: 'roof', x: col(0.2), y: diag.y + diag.h * 0.3 - nodeH / 2, w: nodeW, h: nodeH, label: t('power.roof'), sub: t('power.roofSub', { n: POWER.roofPanels }), on: roofKw > 0.01, color: ACCENT },
      {
        id: 'ground', x: col(0.2), y: diag.y + diag.h * 0.7 - nodeH / 2, w: nodeW, h: nodeH, label: t('power.ground'),
        sub: panelsAll.length ? t('power.groundSub', { n: linked.length }) : t('power.noPanels'), on: groundKw > 0.01, color: ACCENT,
      },
    ];
    const bat = { x: col(0.47) - 34, y: diag.y + diag.h / 2 - 56, w: 68, h: 112 };
    const loads = new Map(p.lastLoads.map((l) => [l.id, l.kw]));
    const consumers: { id: string; label: string }[] = [
      { id: 'life', label: t('power.life') },
      ...(['workbench', 'electrolyzer', 'furnace'] as StationId[]).map((id) => ({ id, label: STATIONS[id].name })),
      { id: 'suit', label: t('power.suit') },
    ];
    const cn = consumers.length;
    const cGap = 6;
    const cH = Math.min(nodeH, (diag.h - 20 - cGap * (cn - 1)) / cn);
    const cons: Node[] = consumers.map((c, i) => {
      const kw = loads.get(c.id) ?? 0;
      return {
        id: c.id, x: R - pad - nodeW, y: diag.y + 10 + i * (cH + cGap), w: nodeW, h: cH, label: c.label,
        // o ar do habitat tem prioridade: só as máquinas e a recarga desaceleram
        sub: kw > 0 ? (p.satisfaction < 0.99 && c.id !== 'life' ? t('power.slow') : t('power.on')) : t('power.off'), on: kw > 0, color: '#9fe8ff',
      };
    });

    // fios com a energia que passa
    const charge = p.generation - p.demand;
    const wires: Wire[] = [
      { id: 'sun-roof', a: sun, b: { x: gens[0].x, y: gens[0].y + nodeH / 2 }, kw: roofKw, color: ACCENT },
      { id: 'sun-ground', a: sun, b: { x: gens[1].x, y: gens[1].y + nodeH / 2 }, kw: groundKw, color: ACCENT },
      { id: 'roof-bat', a: { x: gens[0].x + nodeW, y: gens[0].y + nodeH / 2 }, b: { x: bat.x, y: bat.y + bat.h * 0.35 }, kw: roofKw, color: '#9fe8ff' },
      { id: 'ground-bat', a: { x: gens[1].x + nodeW, y: gens[1].y + nodeH / 2 }, b: { x: bat.x, y: bat.y + bat.h * 0.65 }, kw: groundKw, color: '#9fe8ff' },
      ...cons.map((c) => ({
        id: `bat-${c.id}`, a: { x: bat.x + bat.w, y: bat.y + bat.h / 2 }, b: { x: c.x, y: c.y + c.h / 2 },
        kw: (loads.get(c.id) ?? 0) * p.satisfaction, color: '#9fe8ff',
      })),
    ];
    for (const w of wires) this.wire(w);
    this.flow(wires, dt);

    // nós
    sunIcon(g, sun.x, sun.y, 16 * Math.max(0.5, p.sun), this.time);
    g.fillStyle = COLORS.dim;
    g.font = `500 12px ${FONT_UI}`;
    g.textAlign = 'center';
    g.fillText(p.sun > 0.95 ? t('power.sunFull') : t('power.sunWeak'), sun.x, sun.y + 42);
    for (const n of [...gens, ...cons]) this.node(n);
    this.battery(bat, charge);

    // frases: o que está acontecendo e o que fazer
    const lines: string[] = [];
    if (charge > 0.01) lines.push(p.battery >= p.capacity - 0.5 ? t('power.full') : t('power.charging'));
    else if (charge < -0.01 && p.battery > 0) lines.push(t('power.draining', { time: minutes(p.battery / -charge) }));
    else if (p.satisfaction < 0.99) lines.push(t('power.empty', { pct: Math.round(p.satisfaction * 100) }));
    else lines.push(t('power.balanced'));
    if (!panelsAll.length) lines.push(t('power.hintPanels'));
    else {
      const parts = [t('power.panelsLinked', { n: linked.length })];
      if (shaded) parts.push(t('power.panelsShade', { n: shaded }));
      if (far) parts.push(t('power.panelsFar', { n: far, reach: POWER.cableReach }));
      lines.push(parts.join(' · '));
    }
    g.textAlign = 'left';
    g.font = `500 13px ${FONT_UI}`;
    let y = area.y + area.h - textH + 18;
    for (const line of lines) {
      for (const l of wrapText(g, line, area.w - 28).slice(0, 1)) {
        g.fillStyle = y === area.y + area.h - textH + 18 ? COLORS.ink : COLORS.dim;
        g.fillText(l, area.x + 14, y);
      }
      y += 20;
    }
  }

  private wire(w: Wire): void {
    const g = this.g;
    const on = w.kw > 0.01;
    g.strokeStyle = on ? hexA(w.color, 0.35) : 'rgba(255,255,255,0.07)';
    g.lineWidth = on ? 1.5 + Math.min(5, w.kw * 1.5) : 1;
    g.beginPath();
    const mx = (w.a.x + w.b.x) / 2;
    g.moveTo(w.a.x, w.a.y);
    g.bezierCurveTo(mx, w.a.y, mx, w.b.y, w.b.x, w.b.y);
    g.stroke();
  }

  /** pacotes de energia: um a cada tanto, na proporção dos kW que passam no fio */
  private flow(wires: Wire[], dt: number): void {
    const g = this.g;
    for (const w of wires) {
      if (w.kw <= 0.01) continue;
      const left = (this.emitT.get(w.id) ?? 0) - dt;
      if (left <= 0) {
        this.dots.push({ wire: w.id, t: 0, dur: 1.1 });
        this.emitT.set(w.id, 1 / (4 * w.kw));
      } else this.emitT.set(w.id, left);
    }
    const byId = new Map(wires.map((w) => [w.id, w]));
    this.dots = this.dots.filter((d) => (d.t += dt) < d.dur && (byId.get(d.wire)?.kw ?? 0) > 0.01);
    for (const d of this.dots) {
      const w = byId.get(d.wire);
      if (!w) continue;
      const u = d.t / d.dur, v = 1 - u;
      const mx = (w.a.x + w.b.x) / 2;
      const x = v * v * v * w.a.x + 3 * v * v * u * mx + 3 * v * u * u * mx + u * u * u * w.b.x;
      const y = v * v * v * w.a.y + 3 * v * v * u * w.a.y + 3 * v * u * u * w.b.y + u * u * u * w.b.y;
      g.fillStyle = w.color;
      g.globalAlpha = Math.sin(Math.PI * u);
      g.beginPath();
      g.arc(x, y, 2.6, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
  }

  private node(n: Node): void {
    const g = this.g;
    g.fillStyle = n.on ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.03)';
    roundRect(g, n, 10);
    g.fill();
    g.strokeStyle = n.on ? hexA(n.color, 0.6) : 'rgba(255,255,255,0.1)';
    g.lineWidth = 1;
    g.stroke();
    g.textAlign = 'left';
    g.fillStyle = n.on ? COLORS.ink : COLORS.faint;
    const big = n.h >= 34;
    g.font = `500 ${big ? 12.5 : 11}px ${FONT_UI}`;
    g.fillText(fitText(g, n.label, n.w - 16), n.x + 9, n.y + (big ? 17 : n.h / 2 + 4));
    if (big) {
      g.fillStyle = n.on ? COLORS.dim : COLORS.faint;
      g.font = `400 10.5px ${FONT_UI}`;
      g.fillText(fitText(g, n.sub, n.w - 16), n.x + 9, n.y + 31);
    } else if (n.on) {
      g.fillStyle = COLORS.dim;
      g.font = `400 10px ${FONT_UI}`;
      g.textAlign = 'right';
      g.fillText(n.sub, n.x + n.w - 8, n.y + n.h / 2 + 4);
    }
  }

  private battery(r: Rect, charge: number): void {
    const g = this.g;
    const f = this.power.battery / this.power.capacity;
    g.fillStyle = 'rgba(255,255,255,0.08)';
    roundRect(g, r, 12);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.25)';
    roundRect(g, { x: r.x + r.w / 2 - 12, y: r.y - 7, w: 24, h: 8 }, 3);
    g.fill();
    const inner = { x: r.x + 6, y: r.y + 6, w: r.w - 12, h: r.h - 12 };
    const fh = inner.h * f;
    g.fillStyle = f > 0.3 ? COLORS.ok : f > 0.1 ? COLORS.work : COLORS.warn;
    g.globalAlpha = 0.85;
    roundRect(g, { x: inner.x, y: inner.y + inner.h - fh, w: inner.w, h: Math.max(2, fh) }, 7);
    g.fill();
    g.globalAlpha = 1;
    boltIcon(g, r.x + r.w / 2, r.y + r.h / 2, 13, charge > 0.01 ? '#ffffff' : 'rgba(255,255,255,0.6)');
    g.fillStyle = COLORS.ink;
    g.font = `600 12px ${FONT_TITLE}`;
    g.textAlign = 'center';
    g.fillText(t('power.battery'), r.x + r.w / 2, r.y + r.h + 18);
    g.fillStyle = COLORS.dim;
    g.font = `400 11px ${FONT_UI}`;
    g.fillText(charge > 0.01 ? t('power.batCharging') : charge < -0.01 ? t('power.batDraining') : '', r.x + r.w / 2, r.y + r.h + 33);
  }
}

/** segundos em palavras curtas de minuto */
function minutes(s: number): string {
  if (!Number.isFinite(s)) return '—';
  const m = Math.round(s / 60);
  return m < 1 ? t('power.lessMinute') : t('power.minutes', { n: m });
}
