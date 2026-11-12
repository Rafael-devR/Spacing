// Tela técnica das estações (docs/design/CRAFTING.md e INTERFACE.md): lista de receitas à esquerda e, à direita,
// o processo ao vivo: os materiais entrando pela tubulação, a câmara trabalhando (calor, bolhas ou laser), o
// produto se formando, medidores, reação química, etapas e o porquê do tempo. Só lê o sistema Crafting.
import { EQUIPMENT, type EquipId } from '../data/equipment';
import { ITEMS, type ItemId } from '../data/items';
import { itemWork, recipeById, RECIPES, recipeSeconds, JITTER, type Recipe, type RecipeOutput } from '../data/recipes';
import { STATIONS, type StationId } from '../data/stations';
import { t } from '../i18n';
import type { Crafting } from '../systems/Crafting';
import { el, mmss } from './dom';

type Icons = { items: Record<ItemId, string>; equip: Record<EquipId, string>; stations: Partial<Record<StationId, string>> };

const outName = (o: RecipeOutput): string =>
  o.kind === 'item' ? ITEMS[o.item].name : o.kind === 'equip' ? EQUIPMENT[o.equip].name : STATIONS[o.station].name;

interface Node {
  img: HTMLImageElement | null;
  tint: string;
  n: number;
  label: string;
}

interface Mote {
  /** índice do cano */
  pipe: number;
  /** 0..1 ao longo do cano */
  f: number;
  speed: number;
  out: boolean;
}

export class CraftPanel {
  onCraft: ((r: Recipe) => void) | null = null;
  onTake: ((station: StationId) => void) | null = null;
  onToggle: ((open: boolean) => void) | null = null;
  private readonly root = el('#craft');
  private readonly card = el('#craft .st-card');
  private readonly list = el('#craft-list');
  private readonly canvas = el<HTMLCanvasElement>('#st-canvas');
  private readonly ctx = this.canvas.getContext('2d');
  private readonly action = el<HTMLButtonElement>('#st-action');
  private icons: Icons = { items: {} as Record<ItemId, string>, equip: {} as Record<EquipId, string>, stations: {} };
  private readonly imgs = new Map<string, HTMLImageElement>();
  private station: StationId = 'workbench';
  private selected: string | null = null;
  private raf = 0;
  private last = 0;
  private time = 0;
  private domT = 0;
  /** 0..1: quanto a câmara está "quente" (sobe trabalhando, desce parada) */
  private heat = 0;
  private motes: Mote[] = [];
  private moteT = 0;

  constructor(private readonly crafting: Crafting) {
    el('#craft-close').addEventListener('click', () => this.close());
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.root) this.close();
    });
    this.action.addEventListener('click', () => this.act());
  }

  setIcons(items: Record<ItemId, string>, equip: Record<EquipId, string>, stations: Partial<Record<StationId, string>> = {}): void {
    this.icons = { items, equip, stations };
    this.imgs.clear();
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  /** a estação aberta agora */
  get current(): StationId {
    return this.station;
  }

  show(station: StationId = 'workbench'): void {
    const reopen = this.open && this.station === station;
    this.station = station;
    if (!reopen) {
      this.selected = null;
      this.heat = this.crafting.job(station) && !this.crafting.job(station)?.ready ? 1 : 0;
      this.motes = [];
    }
    if (!this.open) {
      this.root.hidden = false;
      this.onToggle?.(true);
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.frame);
    }
    this.render();
  }

  close(): void {
    if (!this.open) return;
    this.root.hidden = true;
    cancelAnimationFrame(this.raf);
    this.onToggle?.(false);
  }

  // ---------- dados da tela ----------

  /** receita mostrada à direita: a do trabalho da estação, a escolhida, ou a primeira */
  private shown(): Recipe | null {
    const job = this.crafting.job(this.station);
    if (job && (this.selected === null || this.selected === job.recipe.id)) return job.recipe;
    if (!this.crafting.isBuilt(this.station)) return RECIPES.find((r) => r.outputs.some((o) => o.kind === 'station' && o.station === this.station)) ?? null;
    const list = this.crafting.recipes(this.station);
    const sel = this.selected ? recipeById(this.selected) : undefined;
    if (sel && sel.station === this.station) return sel;
    return list.find((r) => this.crafting.check(r).ok) ?? list.find((r) => !this.crafting.check(r).owned) ?? list[0] ?? null;
  }

  private iconFor(o: RecipeOutput): string {
    if (o.kind === 'item') return this.icons.items[o.item];
    if (o.kind === 'equip') return this.icons.equip[o.equip];
    return this.icons.stations[o.station] ?? '';
  }

  private img(src: string): HTMLImageElement | null {
    if (!src) return null;
    let i = this.imgs.get(src);
    if (!i) {
      i = new Image();
      i.src = src;
      this.imgs.set(src, i);
    }
    return i;
  }

  /** Redesenha a parte de texto (lista, cabeçalho, detalhes). O diagrama anda sozinho a cada quadro. */
  render(): void {
    if (!this.open) return;
    const st = STATIONS[this.station];
    const built = this.crafting.isBuilt(this.station);
    this.card.style.setProperty('--accent', st.accent);
    this.card.dataset.chamber = st.chamber;
    el('#craft-title').textContent = st.name;
    el('#st-tagline').textContent = st.tagline;
    this.renderList(built);
    this.renderDetail();
    this.renderLive();
  }

  private renderList(built: boolean): void {
    this.list.innerHTML = '';
    if (!built) {
      const p = document.createElement('p');
      p.className = 'st-locked';
      p.textContent = t('craft.locked', { name: STATIONS[this.station].name });
      this.list.appendChild(p);
      return;
    }
    const shown = this.shown();
    const job = this.crafting.job(this.station);
    for (const r of this.crafting.recipes(this.station)) {
      const c = this.crafting.check(r);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'st-recipe';
      b.dataset.recipe = r.id;
      const state = job?.recipe.id === r.id ? (job.ready ? 'ready' : 'work') : c.owned ? 'owned' : c.missing.length ? 'miss' : 'ok';
      b.dataset.state = state;
      if (shown?.id === r.id) b.classList.add('on');
      const out = r.outputs[0];
      const n = out.kind === 'item' && out.n > 1 ? `<i class="st-x">×${out.n}</i>` : '';
      const tag = out.kind === 'equip' ? t('craft.equipTag') : out.kind === 'station' ? t('craft.stationTag') : '';
      b.innerHTML =
        `<img alt="" src="${this.iconFor(out)}">${n}` +
        `<span class="st-rname">${outName(out)}${r.outputs.length > 1 ? ' <small>+' + (r.outputs.length - 1) + '</small>' : ''}</span>` +
        `<span class="st-rmeta"><i class="st-dot"></i>${tag ? tag + ' · ' : ''}~${mmss(recipeSeconds(r))}</span>`;
      b.addEventListener('click', () => {
        this.selected = r.id;
        this.motes = [];
        this.render();
      });
      this.list.appendChild(b);
    }
  }

  private renderDetail(): void {
    const r = this.shown();
    const box = el('#st-detail');
    box.hidden = !r;
    if (!r) return;
    el('#st-reaction').textContent = r.process.reaction;
    el('#st-note').textContent = r.process.note;
    // ingredientes: quanto tem (ou que já estão na estação), e por que pesam no tempo (calor, peso, raridade)
    const inJob = this.crafting.job(this.station)?.recipe.id === r.id;
    const needs = (Object.entries(r.inputs) as [ItemId, number][])
      .map(([item, n]) => {
        const have = this.crafting.has(item);
        const tr = ITEMS[item].traits;
        const bars = (v: number, k: 'heat' | 'mass' | 'rarity'): string =>
          `<span class="st-trait" title="${t(`craft.trait.${k}`)}"><b>${t(`craft.traitShort.${k}`)}</b>${'<i class="on"></i>'.repeat(v)}${'<i></i>'.repeat(3 - v)}</span>`;
        return (
          `<div class="st-need ${inJob ? 'used' : have >= n ? 'ok' : 'miss'}" title="${ITEMS[item].about}">` +
          `<img alt="" src="${this.icons.items[item]}"><span class="st-nname">${ITEMS[item].name}</span>` +
          `<span class="st-ncount">${inJob ? t('craft.inStation', { n }) : `${Math.min(have, n)}/${n}`}</span>` +
          `<span class="st-traits">${bars(tr.heat, 'heat')}${bars(tr.mass, 'mass')}${bars(tr.rarity, 'rarity')}</span>` +
          `<span class="st-nwork">+${Math.round(n * itemWork(item) * STATIONS[r.station].perWork * (r.effort ?? 1))} s</span></div>`
        );
      })
      .join('');
    const outs = r.outputs
      .map((o) => `<span class="st-out"><img alt="" src="${this.iconFor(o)}">${o.kind === 'item' ? o.n + '× ' : ''}${outName(o)}</span>`)
      .join('');
    el('#st-needs').innerHTML = needs;
    el('#st-outs').innerHTML = `<span class="st-k">${t('craft.makes')}</span>${outs}`;
    const secs = recipeSeconds(r);
    el('#st-time').innerHTML =
      `<span class="st-k">${t('craft.timeWhy')}</span> ${t('craft.timeBase', { s: STATIONS[r.station].base })}` +
      (r.effort && r.effort !== 1 ? ` · ${t('craft.effort', { k: r.effort.toFixed(1).replace('.', ',') })}` : '') +
      ` · <b>~${mmss(secs)}</b> (±${Math.round(secs * JITTER)} s)`;
    el('#st-steps').innerHTML = r.process.steps.map((s, i) => `<li data-i="${i}"><i></i><span>${s}</span></li>`).join('');
  }

  /** partes que mudam enquanto a tela está aberta: estado, medidores, etapa, botão */
  private renderLive(): void {
    const r = this.shown();
    const st = STATIONS[this.station];
    const job = this.crafting.job(this.station);
    const jobHere = !!job && !!r && job.recipe.id === r.id;
    const status = !this.crafting.isBuilt(this.station) ? 'locked' : job ? (job.ready ? 'ready' : 'work') : 'idle';
    this.card.dataset.status = status;
    el('#st-status').textContent = t(`craft.status.${status}`);
    // medidores: valor parado → trabalhando, com oscilação
    const work = r?.process.gauges;
    const g = st.gauges.map((gg, i) => {
      const target = work?.[i] ?? gg.work;
      const wob = 1 + (Math.sin(this.time * (3.1 + i)) * 0.6 + Math.sin(this.time * 11.7 + i * 2) * 0.4) * gg.wobble * this.heat;
      const v = (gg.idle + (target - gg.idle) * this.heat) * wob;
      return `<div class="st-gauge"><span class="st-k">${gg.label}</span><b>${v.toFixed(gg.digits ?? 0).replace('.', ',')}</b><small>${gg.unit}</small></div>`;
    });
    let timeLabel: string, timeValue: string;
    if (jobHere && job) {
      timeLabel = job.ready ? t('craft.ready.k') : t('craft.remaining');
      timeValue = job.ready ? '✓' : mmss(job.remaining);
    } else {
      timeLabel = t('craft.estimate');
      timeValue = r ? `~${mmss(recipeSeconds(r))}` : '—';
    }
    g.push(`<div class="st-gauge st-clock"><span class="st-k">${timeLabel}</span><b>${timeValue}</b></div>`);
    el('#st-gauges').innerHTML = g.join('');
    // etapas e barra de progresso
    const p = jobHere && job ? job.progress : 0;
    el<HTMLElement>('#st-bar i').style.width = `${(p * 100).toFixed(1)}%`;
    const steps = el('#st-steps').children;
    for (let i = 0; i < steps.length; i++) {
      const li = steps[i] as HTMLElement;
      li.classList.toggle('done', jobHere && !!job && (job.ready || i < job.step));
      li.classList.toggle('now', jobHere && !!job && !job.ready && i === job.step);
    }
    // botão
    const a = this.action;
    let label: string, enabled = false;
    if (status === 'locked') label = t('craft.buildAtBench');
    else if (jobHere && job?.ready) {
      label = t('craft.take');
      enabled = true;
    } else if (jobHere) label = t('craft.working');
    else if (job) label = t('craft.busy');
    else if (!r) label = '—';
    else {
      const c = this.crafting.check(r);
      label = c.owned ? (r.outputs[0].kind === 'station' ? t('craft.installedTag') : t('craft.owned')) : c.ok ? t('craft.make') : t('craft.missing');
      enabled = c.ok;
    }
    if (a.textContent !== label) a.textContent = label;
    a.disabled = !enabled;
    a.dataset.kind = jobHere && job?.ready ? 'take' : 'make';
  }

  private act(): void {
    const job = this.crafting.job(this.station);
    if (job?.ready) {
      this.onTake?.(this.station);
      return;
    }
    const r = this.shown();
    if (!r || !this.crafting.check(r).ok) return;
    this.selected = r.id;
    this.onCraft?.(r);
  }

  // ---------- diagrama ao vivo ----------

  private readonly frame = (now: number): void => {
    if (!this.open) return;
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;
    const r = this.shown();
    const job = this.crafting.job(this.station);
    const jobHere = !!job && !!r && job.recipe.id === r.id;
    const want = jobHere && !job.ready ? 1 : 0;
    this.heat += (want - this.heat) * (1 - Math.exp(-dt * (want ? 1.6 : 0.8)));
    this.domT -= dt;
    if (this.domT <= 0) {
      this.domT = 0.12;
      this.renderLive();
    }
    if (r) this.draw(r, dt, jobHere ? job.progress : 0, jobHere && job.ready, jobHere);
    this.raf = requestAnimationFrame(this.frame);
  };

  private draw(r: Recipe, dt: number, progress: number, ready: boolean, active: boolean): void {
    const c = this.canvas, x = this.ctx;
    if (!x) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = c.clientWidth, H = c.clientHeight;
    if (W === 0 || H === 0) return;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
    }
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.clearRect(0, 0, W, H);
    const st = STATIONS[r.station];
    const accent = st.accent;

    const ins: Node[] = (Object.entries(r.inputs) as [ItemId, number][]).map(([item, n]) => ({
      img: this.img(this.icons.items[item]), tint: ITEMS[item].tint, n, label: ITEMS[item].name,
    }));
    const outs: Node[] = r.outputs.map((o) => ({
      img: this.img(this.iconFor(o)), tint: o.kind === 'item' ? ITEMS[o.item].tint : accent, n: o.kind === 'item' ? o.n : 1, label: outName(o),
    }));

    // grade técnica ao fundo
    x.strokeStyle = 'rgba(127,231,255,0.07)';
    x.lineWidth = 1;
    for (let gx = 0; gx < W; gx += 16) {
      x.beginPath();
      x.moveTo(gx + 0.5, 0);
      x.lineTo(gx + 0.5, H);
      x.stroke();
    }
    for (let gy = 0; gy < H; gy += 16) {
      x.beginPath();
      x.moveTo(0, gy + 0.5);
      x.lineTo(W, gy + 0.5);
      x.stroke();
    }

    // a faixa de cima fica para a fórmula química
    const top = 24;
    const icon = Math.min(32, (H - top - 10) / Math.max(3, ins.length) - 8);
    const colX = 10, outX = W - 10 - icon;
    const ch = { x: W * 0.32, y: top, w: W * 0.36, h: H - top - 8 };
    const midY = top + (H - top) / 2;
    const slotY = (i: number, n: number): number => midY + (i - (n - 1) / 2) * (icon + 12) - icon / 2;
    const pipes: { ax: number; ay: number; bx: number; by: number; tint: string; out: boolean }[] = [];
    ins.forEach((n, i) => {
      const y = slotY(i, ins.length) + icon / 2;
      pipes.push({ ax: colX + icon + 4, ay: y, bx: ch.x, by: ch.y + ch.h * (0.3 + 0.4 * ((i + 0.5) / ins.length)), tint: n.tint, out: false });
    });
    outs.forEach((n, i) => {
      const y = slotY(i, outs.length) + icon / 2;
      pipes.push({ ax: ch.x + ch.w, ay: ch.y + ch.h * (0.3 + 0.4 * ((i + 0.5) / outs.length)), bx: outX - 4, by: y, tint: n.tint, out: true });
    });

    // canos
    for (const p of pipes) {
      x.strokeStyle = 'rgba(160,190,220,0.25)';
      x.lineWidth = 5;
      x.beginPath();
      const mx = (p.ax + p.bx) / 2;
      x.moveTo(p.ax, p.ay);
      x.bezierCurveTo(mx, p.ay, mx, p.by, p.bx, p.by);
      x.stroke();
      x.strokeStyle = 'rgba(10,16,34,0.9)';
      x.lineWidth = 2.5;
      x.stroke();
    }
    // material correndo: entra enquanto trabalha (e devagar na prévia), sai perto do fim
    const flowing = active && !ready;
    this.moteT -= dt;
    if (this.moteT <= 0) {
      this.moteT = flowing ? 0.05 : 0.35;
      const inPipes = pipes.map((p, i) => (p.out ? -1 : i)).filter((i) => i >= 0);
      const outPipes = pipes.map((p, i) => (p.out ? i : -1)).filter((i) => i >= 0);
      if (inPipes.length && (flowing || !active)) {
        const i = inPipes[Math.floor(Math.random() * inPipes.length)];
        this.motes.push({ pipe: i, f: 0, speed: flowing ? 0.9 + Math.random() * 0.5 : 0.25, out: false });
      }
      if (outPipes.length && flowing && progress > 0.15) {
        const i = outPipes[Math.floor(Math.random() * outPipes.length)];
        this.motes.push({ pipe: i, f: 0, speed: 0.6 + Math.random() * 0.4, out: true });
      }
    }
    this.motes = this.motes.filter((m) => m.f < 1 && m.pipe < pipes.length);
    for (const m of this.motes) {
      m.f += dt * m.speed;
      const p = pipes[m.pipe];
      const mx = (p.ax + p.bx) / 2;
      const u = m.f, v = 1 - u;
      const px = v * v * v * p.ax + 3 * v * v * u * mx + 3 * v * u * u * mx + u * u * u * p.bx;
      const py = v * v * v * p.ay + 3 * v * v * u * p.ay + 3 * v * u * u * p.by + u * u * u * p.by;
      x.fillStyle = p.tint;
      x.globalAlpha = (flowing ? 0.95 : 0.4) * Math.sin(Math.PI * u);
      x.fillRect(px - 2, py - 2, 4, 4);
    }
    x.globalAlpha = 1;

    // ícones: ingredientes esvaziam e produtos enchem com o progresso
    const drawNode = (n: Node, nx: number, ny: number, fill: number, glow: boolean): void => {
      x.fillStyle = 'rgba(12,20,44,0.92)';
      x.strokeStyle = glow ? accent : 'rgba(127,231,255,0.35)';
      x.lineWidth = glow ? 2 : 1;
      roundRect(x, nx - 3, ny - 3, icon + 6, icon + 6, 6);
      x.fill();
      x.stroke();
      if (n.img?.complete) {
        x.globalAlpha = 0.3 + 0.7 * fill;
        x.drawImage(n.img, nx, ny, icon, icon);
        x.globalAlpha = 1;
      }
      // barra do nível
      x.fillStyle = 'rgba(255,255,255,0.12)';
      x.fillRect(nx - 3, ny + icon + 5, icon + 6, 3);
      x.fillStyle = n.tint;
      x.fillRect(nx - 3, ny + icon + 5, (icon + 6) * fill, 3);
      x.font = '600 10px Rubik, system-ui, sans-serif';
      x.fillStyle = '#f4f0e8';
      x.textAlign = 'right';
      x.fillText(`×${n.n}`, nx + icon + 2, ny + icon - 1);
    };
    ins.forEach((n, i) => drawNode(n, colX, slotY(i, ins.length), active ? 1 - progress : 1, false));
    outs.forEach((n, i) => drawNode(n, outX, slotY(i, outs.length), active ? progress : 0.25, ready && Math.sin(this.time * 6) > 0));

    // câmara
    x.save();
    roundRect(x, ch.x, ch.y, ch.w, ch.h, 10);
    x.fillStyle = 'rgba(6,10,24,0.95)';
    x.fill();
    x.clip();
    if (st.chamber === 'heat') this.drawHeat(x, ch, progress, active);
    else if (st.chamber === 'cell') this.drawCell(x, ch, r, active);
    else this.drawLaser(x, ch, outs[0], progress, active, ready);
    x.restore();
    x.strokeStyle = accent;
    x.globalAlpha = 0.55 + 0.45 * this.heat;
    x.lineWidth = 1.5;
    roundRect(x, ch.x, ch.y, ch.w, ch.h, 10);
    x.stroke();
    x.globalAlpha = 1;
    if (ready) {
      x.font = '700 12px Rubik, system-ui, sans-serif';
      x.textAlign = 'center';
      x.fillStyle = '#7dffa8';
      x.fillText(t('craft.status.ready'), ch.x + ch.w / 2, ch.y + 18);
    }
  }

  private drawHeat(x: CanvasRenderingContext2D, ch: Box, progress: number, active: boolean): void {
    const h = this.heat;
    // brilho do calor: de vermelho escuro a amarelo quase branco
    const gr = x.createRadialGradient(ch.x + ch.w / 2, ch.y + ch.h * 0.7, 4, ch.x + ch.w / 2, ch.y + ch.h * 0.7, ch.w * 0.75);
    gr.addColorStop(0, `rgba(255,${Math.round(150 + 90 * h)},${Math.round(60 * h)},${0.15 + 0.8 * h})`);
    gr.addColorStop(0.5, `rgba(255,90,20,${0.08 + 0.45 * h})`);
    gr.addColorStop(1, 'rgba(60,10,0,0)');
    x.fillStyle = gr;
    x.fillRect(ch.x, ch.y, ch.w, ch.h);
    // ondas de calor subindo
    x.strokeStyle = `rgba(255,200,120,${0.12 + 0.3 * h})`;
    x.lineWidth = 1.2;
    for (let k = 0; k < 5; k++) {
      x.beginPath();
      const bx = ch.x + ch.w * (0.15 + k * 0.17);
      for (let y = ch.y + ch.h; y > ch.y; y -= 4) {
        const w = Math.sin(y * 0.12 + this.time * 5 + k) * (2 + 3 * h);
        if (y === ch.y + ch.h) x.moveTo(bx + w, y);
        else x.lineTo(bx + w, y);
      }
      x.stroke();
    }
    // banho fundido no fundo, subindo com o progresso
    const pool = ch.h * (0.08 + 0.32 * (active ? progress : 0));
    const pg = x.createLinearGradient(0, ch.y + ch.h - pool, 0, ch.y + ch.h);
    pg.addColorStop(0, `rgba(255,${Math.round(180 + 60 * h)},90,${0.4 + 0.6 * h})`);
    pg.addColorStop(1, `rgba(200,50,10,${0.5 + 0.5 * h})`);
    x.fillStyle = pg;
    x.beginPath();
    x.moveTo(ch.x, ch.y + ch.h);
    for (let px = ch.x; px <= ch.x + ch.w; px += 6) x.lineTo(px, ch.y + ch.h - pool + Math.sin(px * 0.1 + this.time * 3) * 2);
    x.lineTo(ch.x + ch.w, ch.y + ch.h);
    x.fill();
    // brasas
    for (let k = 0; k < 14; k++) {
      const f = (this.time * (0.25 + (k % 5) * 0.06) + k * 0.137) % 1;
      x.fillStyle = `rgba(255,${180 + (k % 3) * 25},80,${(1 - f) * h})`;
      x.fillRect(ch.x + ((k * 53) % 100) / 100 * ch.w + Math.sin(f * 9 + k) * 4, ch.y + ch.h - pool - f * ch.h * 0.8, 2, 2);
    }
    // temperatura grande no meio
    const temp = Math.round(22 + (this.shownTemp() - 22) * h);
    x.font = '700 18px Rubik, system-ui, sans-serif';
    x.textAlign = 'center';
    x.fillStyle = `rgba(255,240,220,${0.5 + 0.5 * h})`;
    x.fillText(`${temp} °C`, ch.x + ch.w / 2, ch.y + ch.h * 0.42);
  }

  private shownTemp(): number {
    const r = this.shown();
    return r?.process.gauges?.[0] ?? STATIONS[this.station].gauges[0].work;
  }

  private drawCell(x: CanvasRenderingContext2D, ch: Box, r: Recipe, active: boolean): void {
    const h = this.heat;
    // líquido
    const top = ch.y + ch.h * 0.28;
    x.fillStyle = `rgba(40,${Math.round(120 + 60 * h)},${Math.round(200 + 40 * h)},0.55)`;
    x.fillRect(ch.x, top, ch.w, ch.h);
    x.strokeStyle = 'rgba(180,240,255,0.5)';
    x.beginPath();
    for (let px = ch.x; px <= ch.x + ch.w; px += 5) x.lineTo(px, top + Math.sin(px * 0.15 + this.time * 2) * 1.5);
    x.stroke();
    // eletrodos: − à esquerda (H₂, metais), + à direita (O₂)
    const ex = [ch.x + ch.w * 0.3, ch.x + ch.w * 0.7];
    x.fillStyle = '#8c90a0';
    for (const e of ex) x.fillRect(e - 3, ch.y + 6, 6, ch.h - 14);
    x.font = '700 11px Rubik, system-ui, sans-serif';
    x.textAlign = 'center';
    x.fillStyle = '#f4f0e8';
    x.fillText('−', ex[0], ch.y + 16);
    x.fillText('+', ex[1], ch.y + 16);
    // faísca de corrente no alto
    if (h > 0.05) {
      x.strokeStyle = `rgba(160,230,255,${h * (0.5 + 0.5 * Math.abs(Math.sin(this.time * 40)))})`;
      x.lineWidth = 1.5;
      x.beginPath();
      x.moveTo(ex[0], ch.y + 22);
      for (let k = 1; k < 8; k++) x.lineTo(ex[0] + ((ex[1] - ex[0]) * k) / 8, ch.y + 22 + (Math.random() - 0.5) * 6);
      x.lineTo(ex[1], ch.y + 22);
      x.stroke();
    }
    // bolhas: as cores dos produtos; a receita da água solta o dobro de H₂
    const gasOut = r.outputs.filter((o) => o.kind === 'item');
    const leftTint = gasOut[0]?.kind === 'item' ? ITEMS[gasOut[0].item].tint : '#ffffff';
    const rightTint = gasOut[1]?.kind === 'item' ? ITEMS[gasOut[1].item].tint : '#8fd6ff';
    const counts = [r.id === 'water' ? 16 : 10, 8];
    for (let side = 0; side < 2; side++) {
      for (let k = 0; k < counts[side]; k++) {
        const f = (this.time * (0.35 + (k % 4) * 0.08) + k * 0.173) % 1;
        const y = ch.y + ch.h - 8 - f * (ch.h - 8 - top);
        const bx = ex[side] + (side ? 8 : -8) + Math.sin(f * 10 + k) * 4;
        x.fillStyle = side ? rightTint : leftTint;
        x.globalAlpha = (active ? 0.9 : 0.25) * h + (active ? 0 : 0.15);
        x.beginPath();
        x.arc(bx, y, 1.6 + (k % 3) * 0.7, 0, Math.PI * 2);
        x.fill();
      }
    }
    x.globalAlpha = 1;
  }

  private drawLaser(x: CanvasRenderingContext2D, ch: Box, out: Node | undefined, progress: number, active: boolean, ready: boolean): void {
    const h = this.heat;
    const s = Math.min(ch.w, ch.h) * 0.62;
    const px = ch.x + (ch.w - s) / 2, py = ch.y + (ch.h - s) / 2 + 4;
    // mesa em grade
    x.strokeStyle = 'rgba(127,231,255,0.35)';
    x.lineWidth = 1;
    for (let k = 0; k <= 6; k++) {
      x.beginPath();
      x.moveTo(px - 10 + (k * (s + 20)) / 6, py + s + 6);
      x.lineTo(px + s / 2 + (k - 3) * 4, py + s - 4);
      x.stroke();
    }
    if (!out?.img?.complete) return;
    // holograma da peça inteira e a parte já impressa (de baixo para cima)
    x.globalAlpha = 0.18 + 0.1 * Math.sin(this.time * 8);
    x.drawImage(out.img, px, py, s, s);
    x.globalAlpha = 1;
    const done = ready ? 1 : active ? progress : 0;
    const layer = py + s * (1 - done);
    if (done > 0) {
      x.save();
      x.beginPath();
      x.rect(px, layer, s, s * done + 1);
      x.clip();
      x.drawImage(out.img, px, py, s, s);
      x.restore();
    }
    if (active && !ready) {
      // linha da camada e os dois lasers
      x.strokeStyle = `rgba(160,240,255,${0.6 + 0.4 * Math.sin(this.time * 30)})`;
      x.lineWidth = 1.5;
      x.beginPath();
      x.moveTo(px - 6, layer);
      x.lineTo(px + s + 6, layer);
      x.stroke();
      for (let k = 0; k < 2; k++) {
        const tx = px + s * (0.5 + 0.42 * Math.sin(this.time * (5 + k * 1.7) + k * 2));
        x.strokeStyle = `rgba(255,255,255,${0.7 * h})`;
        x.lineWidth = 1;
        x.beginPath();
        x.moveTo(ch.x + ch.w * (0.3 + k * 0.4), ch.y);
        x.lineTo(tx, layer);
        x.stroke();
        x.fillStyle = `rgba(255,${200 + k * 30},120,${h})`;
        for (let j = 0; j < 3; j++) x.fillRect(tx + (Math.random() - 0.5) * 8, layer - Math.random() * 6, 2, 2);
      }
      x.font = '600 10px Rubik, system-ui, sans-serif';
      x.textAlign = 'left';
      x.fillStyle = 'rgba(200,240,255,0.85)';
      x.fillText(t('craft.layer', { n: Math.max(1, Math.round(progress * 240)), total: 240 }), ch.x + 8, ch.y + ch.h - 8);
    }
  }
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function roundRect(x: CanvasRenderingContext2D, rx: number, ry: number, w: number, h: number, r: number): void {
  x.beginPath();
  x.moveTo(rx + r, ry);
  x.arcTo(rx + w, ry, rx + w, ry + h, r);
  x.arcTo(rx + w, ry + h, rx, ry + h, r);
  x.arcTo(rx, ry + h, rx, ry, r);
  x.arcTo(rx, ry, rx + w, ry, r);
  x.closePath();
}
