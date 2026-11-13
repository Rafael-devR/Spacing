// Tela das estações (docs/design/ESTACOES.md, ADR 0019): a máquina à esquerda (receitas, entrada → câmara → saída, quantidade,
// vagas) e o inventário à direita, na mesma tela da mochila (inventory/screen.ts). Arrastar um item para a entrada escolhe a receita
// que usa aquele item; tocar ou arrastar a saída para o inventário pega o que está pronto. As regras continuam em
// systems/Crafting.ts: aqui só se lê e se pede (onCraft, onTake, onPause, onCancel), com a mesma interface da tela antiga.
import { EQUIPMENT, type EquipId } from '../../data/equipment';
import { ITEMS, type ItemId } from '../../data/items';
import { batchable, MAX_BATCH, recipeById, recipeSeconds, unitSeconds, type Recipe, type RecipeOutput } from '../../data/recipes';
import { STATIONS, type StationId } from '../../data/stations';
import { t } from '../../i18n';
import type { Crafting, JobView } from '../../systems/Crafting';
import type { InvScreen, Pane } from '../inventory/screen';
import { StationCore } from './core';

/** de onde vem a energia de cada estação (0..1) */
export interface EnergyView {
  /** 0..1: energia que a estação recebe agora */
  speed(station: StationId): number;
  /** 0..1: carga da bateria da base */
  battery(): number;
}

type Icons = { items: Record<ItemId, string>; equip: Record<EquipId, string>; stations: Partial<Record<StationId, string>> };

export interface Hit {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

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

const BACK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>';
const SUN_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/></svg>';
const BOLT_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></svg>';

/** atalho para criar elementos */
function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

/** troca texto só quando muda (evita refazer o layout a cada quadro) */
function setText(e: HTMLElement, s: string): void {
  if (e.textContent !== s) e.textContent = s;
}

export class StationScreen implements Pane {
  onToggle: ((open: boolean) => void) | null = null;
  onCraft: ((r: Recipe, batch: number) => void) | null = null;
  onTake: ((station: StationId, slot?: number) => void) | null = null;
  onPause: ((station: StationId, slot: number) => void) | null = null;
  onCancel: ((station: StationId, slot: number) => void) | null = null;

  readonly el: HTMLElement;
  private icons: Icons = { items: {} as Record<ItemId, string>, equip: {} as Record<EquipId, string>, stations: {} };
  private station: StationId = 'workbench';
  private selected: string | null = null;
  private slotSel: number | null = null;
  private batch = 1;
  private info = false;
  private confirmCancel = -10;
  private time = 0;
  private textTimer = 0;
  private listSig = '';
  private ioSig = '';
  private jobsSig = '';
  /** mensagem curta na linha da receita (ex.: "esta estação não usa gelo") */
  private flash: { text: string; until: number } | null = null;
  private readonly core: StationCore;
  // partes da tela
  private readonly q: Record<string, HTMLElement> = {};

  constructor(
    private readonly screen: InvScreen,
    private readonly crafting: Crafting,
    private readonly energy: EnergyView,
  ) {
    const e = h('section', 'pane st');
    e.id = 'craft';
    e.setAttribute('aria-label', t('craft.screen'));
    e.innerHTML = `
      <header class="ui-head">
        <button class="ui-back" type="button" data-hit="back" aria-label="${t('ui.back')}">${BACK_SVG}</button>
        <div class="ui-title"><span class="ui-k st-sub"></span><h2 class="st-name"></h2></div>
        <div class="st-energy"><span class="st-e-ico"></span><span class="st-e-k"></span><b class="st-e-v"></b><i class="st-e-bar"><i></i></i></div>
      </header>
      <div class="st-recipes" role="list"></div>
      <div class="st-locked" hidden></div>
      <div class="st-machine">
        <div class="st-io st-in" data-drop="input"><span class="ui-k">${t('craft.k.in')}</span><div class="st-in-slots"></div></div>
        <div class="st-core">
          <canvas></canvas>
          <span class="st-read"></span>
          <span class="st-state"></span>
          <div class="st-info" hidden><b class="st-info-r"></b><span class="st-info-s"></span><p class="st-info-n"></p></div>
        </div>
        <div class="st-io st-out"><span class="ui-k">${t('craft.k.out')}</span><div class="slot st-out-slot" data-out><img alt="" hidden draggable="false"><span class="count"></span></div></div>
      </div>
      <div class="st-line">
        <div class="st-line-txt"><b class="st-rname"></b><span class="st-rsub"></span></div>
        <button class="ui-btn sq" type="button" data-hit="info" aria-label="${t('craft.k.science')}">i</button>
      </div>
      <div class="st-ctrl">
        <button class="ui-btn sq" type="button" data-hit="minus" aria-label="−">−</button>
        <span class="st-batch"></span>
        <button class="ui-btn sq" type="button" data-hit="plus" aria-label="+">+</button>
        <button class="ui-btn" type="button" data-hit="max"></button>
        <button class="ui-btn go st-make" type="button" data-hit="make"></button>
      </div>
      <div class="st-jobctrl" hidden>
        <button class="ui-btn danger" type="button" data-hit="cancel"></button>
        <button class="ui-btn gold" type="button" data-hit="pause"></button>
        <button class="ui-btn go" type="button" data-hit="take-slot"></button>
        <button class="ui-btn sq" type="button" data-hit="close-job" aria-label="${t('ui.back')}">×</button>
      </div>
      <div class="st-jobs"></div>`;
    this.el = e;
    const pick = (k: string, sel: string): void => {
      this.q[k] = e.querySelector(sel) as HTMLElement;
    };
    pick('sub', '.st-sub');
    pick('name', '.st-name');
    pick('eIco', '.st-e-ico');
    pick('eK', '.st-e-k');
    pick('eV', '.st-e-v');
    pick('eBar', '.st-e-bar > i');
    pick('recipes', '.st-recipes');
    pick('locked', '.st-locked');
    pick('machine', '.st-machine');
    pick('inSlots', '.st-in-slots');
    pick('in', '.st-in');
    pick('read', '.st-read');
    pick('state', '.st-state');
    pick('info', '.st-info');
    pick('infoR', '.st-info-r');
    pick('infoS', '.st-info-s');
    pick('infoN', '.st-info-n');
    pick('out', '.st-out-slot');
    pick('line', '.st-line');
    pick('rname', '.st-rname');
    pick('rsub', '.st-rsub');
    pick('ctrl', '.st-ctrl');
    pick('batch', '.st-batch');
    pick('jobctrl', '.st-jobctrl');
    pick('jobs', '.st-jobs');
    for (const b of e.querySelectorAll<HTMLElement>('[data-hit]')) b.dataset.static = '1';
    this.core = new StationCore(e.querySelector('.st-core canvas') as HTMLCanvasElement);
    e.addEventListener('click', (ev) => this.click(ev));
  }

  // ---------- a mesma interface da tela antiga ----------

  get open(): boolean {
    return this.screen.current === this;
  }

  get current(): StationId {
    return this.station;
  }

  setIcons(items: Record<ItemId, string>, equip: Record<EquipId, string>, stations: Partial<Record<StationId, string>> = {}): void {
    this.icons = { items, equip, stations };
    this.screen.icons = items;
    this.listSig = this.ioSig = this.jobsSig = '';
  }

  show(station: StationId = 'workbench'): void {
    if (this.open && this.station === station) return;
    if (this.open) this.screen.close();
    this.station = station;
    this.selected = null;
    this.slotSel = null;
    this.batch = 1;
    this.info = false;
    this.confirmCancel = -10;
    this.flash = null;
    this.listSig = this.ioSig = this.jobsSig = '';
    const st = STATIONS[station];
    this.el.style.setProperty('--accent', st.accent);
    this.el.dataset.station = station;
    setText(this.q.name, st.name);
    setText(this.q.sub, t(`craft.sub.${station}`));
    this.q.eIco.innerHTML = st.energy === 'sun' ? SUN_SVG : BOLT_SVG;
    setText(this.q.eK, st.energy === 'sun' ? t('craft.k.sun') : t('craft.k.grid'));
    this.core.setStation(st);
    this.screen.show(this);
    this.q.recipes.scrollLeft = 0;
  }

  close(): void {
    if (this.open) this.screen.close();
  }

  render(): void {
    if (!this.open) return;
    this.refresh(true);
  }

  onOpen(): void {
    this.onToggle?.(true);
  }

  onClose(): void {
    this.onToggle?.(false);
  }

  /** onde estão os botões agora (coordenadas da tela), para os testes no navegador */
  get hits(): Hit[] {
    if (!this.open) return [];
    const out: Hit[] = [];
    for (const b of this.el.querySelectorAll<HTMLElement>('[data-hit]')) {
      if (b.closest('[hidden]') || (b as HTMLButtonElement).disabled) continue;
      const r = b.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      out.push({ id: b.dataset.hit as string, x: r.left, y: r.top, w: r.width, h: r.height });
    }
    return out;
  }

  /** estado interno para os testes */
  get debug(): { temp: number; selected: string | null; slotSel: number | null; batch: number; particles: number } {
    return { temp: this.core.thermal.temp, selected: this.shown()?.id ?? null, slotSel: this.slotSel, batch: this.batch, particles: this.core.particleCount };
  }

  // ---------- gestos (vindos da mão) ----------

  accepts(target: HTMLElement, item: ItemId): boolean {
    return target.dataset.drop === 'input' && this.crafting.isBuilt(this.station) && this.recipesUsing(item).length > 0;
  }

  dropOn(target: HTMLElement, from: number, n: number): boolean {
    const s = this.screen.inv.slot(from);
    if (!s || target.dataset.drop !== 'input') return false;
    return this.feed(s.item, n);
  }

  quick(from: number): boolean {
    const s = this.screen.inv.slot(from);
    if (!s) return true;
    if (!this.feed(s.item, s.n)) this.screen.onFeedback?.('deny');
    return true;
  }

  takeOut(): void {
    if (this.crafting.hasReady(this.station)) this.onTake?.(this.station);
  }

  focus(): void {}

  /** um item chegou na entrada: escolhe a receita desta estação que usa esse item e o lote que ele paga */
  private feed(item: ItemId, n: number): boolean {
    if (!this.crafting.isBuilt(this.station)) return false;
    const using = this.recipesUsing(item);
    if (!using.length) {
      this.flash = { text: t('craft.notUsed', { item: ITEMS[item].name }), until: this.time + 2.5 };
      this.refresh(true);
      return false;
    }
    const cur = this.shown();
    const r = cur && using.includes(cur) ? cur
      : using.find((x) => this.crafting.check(x).ok) ?? using.find((x) => !this.crafting.check(x).owned) ?? using[0];
    if (this.selected !== r.id) this.batch = 1;
    this.selected = r.id;
    this.slotSel = null;
    this.info = false;
    if (batchable(r)) {
      const need = r.inputs[item] ?? 1;
      this.batch = Math.max(1, Math.min(Math.floor(n / need) || 1, this.topBatch()));
    }
    this.flash = null;
    this.refresh(true);
    return true;
  }

  private recipesUsing(item: ItemId): Recipe[] {
    return this.crafting.recipes(this.station).filter((r) => (r.inputs[item] ?? 0) > 0);
  }

  private click(ev: MouseEvent): void {
    const b = (ev.target as HTMLElement).closest<HTMLElement>('[data-hit]');
    if (!b || !this.el.contains(b) || (b as HTMLButtonElement).disabled) return;
    const id = b.dataset.hit as string;
    const job = this.slotSel !== null ? this.crafting.slots(this.station)[this.slotSel] : null;
    if (id === 'back') this.close();
    else if (id.startsWith('r:')) {
      const rid = id.slice(2);
      if (this.selected !== rid) this.batch = 1;
      this.selected = rid;
      this.slotSel = null;
      this.info = false;
      this.flash = null;
    } else if (id.startsWith('slot:')) {
      const i = Number(id.slice(5));
      if (this.crafting.slots(this.station)[i]) {
        this.slotSel = this.slotSel === i ? null : i;
        this.confirmCancel = -10;
        this.info = false;
      }
    } else if (id === 'minus') this.batch = Math.max(1, this.batch - 1);
    else if (id === 'plus') this.batch = Math.min(this.topBatch(), this.batch + 1);
    else if (id === 'max') this.batch = this.topBatch();
    else if (id === 'info') this.info = !this.info;
    else if (id === 'make') {
      const r = this.shown();
      if (r && this.crafting.check(r, this.batch).ok) this.onCraft?.(r, this.batch);
    } else if (id === 'close-job') this.slotSel = null;
    else if (id === 'take-slot' && job) this.onTake?.(this.station, job.slot);
    else if (id === 'pause' && job) this.onPause?.(this.station, job.slot);
    else if (id === 'cancel' && job) {
      if (this.time - this.confirmCancel < 3) {
        this.onCancel?.(this.station, job.slot);
        this.slotSel = null;
        this.confirmCancel = -10;
      } else this.confirmCancel = this.time;
    }
    this.refresh(true);
  }

  // ---------- receitas ----------

  private topBatch(): number {
    const r = this.shown();
    return r && batchable(r) ? Math.max(1, Math.min(this.crafting.maxBatch(r), MAX_BATCH)) : 1;
  }

  private shown(): Recipe | null {
    const list = this.crafting.recipes(this.station);
    const sel = this.selected ? recipeById(this.selected) : undefined;
    if (sel && sel.station === this.station) return sel;
    return list.find((r) => this.crafting.check(r).ok) ?? list.find((r) => !this.crafting.check(r).owned) ?? list[0] ?? null;
  }

  private iconFor(o: RecipeOutput): string {
    if (o.kind === 'item') return this.icons.items[o.item] ?? '';
    if (o.kind === 'equip') return this.icons.equip[o.equip] ?? '';
    return this.icons.stations[o.station] ?? '';
  }

  private buildRecipes(): void {
    const list = this.crafting.recipes(this.station);
    const shown = this.shown();
    const sig = list.map((r) => {
      const c = this.crafting.check(r);
      return `${r.id}${c.ok ? 1 : 0}${c.owned ? 1 : 0}${shown?.id === r.id ? 1 : 0}`;
    }).join('|');
    if (sig === this.listSig) return;
    this.listSig = sig;
    const box = this.q.recipes;
    box.replaceChildren();
    for (const r of list) {
      const c = this.crafting.check(r);
      const o = r.outputs[0];
      const b = h('button', 'st-recipe slot' + (shown?.id === r.id ? ' on' : '') + (c.ok ? ' can' : '') + (c.owned ? ' owned' : '') + (!c.ok && !c.owned ? ' short' : ''));
      b.type = 'button';
      b.dataset.hit = `r:${r.id}`;
      b.title = outName(o);
      b.setAttribute('role', 'listitem');
      b.innerHTML = `<img alt="" src="${this.iconFor(o)}" draggable="false"><span class="count">${c.owned ? '✓' : c.ok && c.max > 1 && batchable(r) ? '×' + c.max : ''}</span>`;
      box.appendChild(b);
    }
  }

  // ---------- a cada quadro ----------

  frame(dt: number): void {
    this.time += dt;
    const jobs = this.crafting.slots(this.station);
    const speed = this.energy.speed(this.station);
    this.core.frame(dt, jobs, speed);
    this.textTimer -= dt;
    if (this.textTimer <= 0) {
      this.textTimer = 0.2;
      this.refresh(false);
    }
  }

  /** atualiza a tela; `all` refaz também o que só muda com o inventário ou um toque */
  private refresh(all: boolean): void {
    if (!this.open) return;
    const st = STATIONS[this.station];
    const built = this.crafting.isBuilt(this.station);
    const jobs = this.crafting.slots(this.station);
    if (this.slotSel !== null && !jobs[this.slotSel]) this.slotSel = null;
    // energia
    const sp = this.energy.speed(this.station);
    setText(this.q.eV, `${Math.round(sp * 100)}%`);
    this.q.eBar.style.width = `${Math.round(sp * 100)}%`;
    this.el.classList.toggle('weak', sp < 0.5);
    // trancada
    this.q.locked.hidden = built;
    this.q.recipes.hidden = !built;
    this.q.machine.hidden = !built;
    this.q.line.hidden = !built;
    if (!built) {
      setText(this.q.locked, t('craft.locked', { name: st.name }));
      this.q.ctrl.hidden = true;
      this.q.jobctrl.hidden = true;
      this.q.jobs.hidden = true;
      return;
    }
    this.q.jobs.hidden = false;
    this.buildRecipes();
    this.renderJobs(jobs);
    this.renderOutput();
    const job = this.slotSel !== null ? jobs[this.slotSel] : null;
    this.q.ctrl.hidden = !!job;
    this.q.jobctrl.hidden = !job;
    (this.el.querySelector('[data-hit="info"]') as HTMLElement).hidden = !!job;
    if (job) this.renderJobCtrl(job, all);
    else this.renderRecipe(all);
    this.renderState(jobs);
  }

  private renderRecipe(all: boolean): void {
    const r = this.shown();
    if (!r) return;
    const check = this.crafting.check(r, this.batch);
    const top = this.topBatch();
    if (this.batch > top) this.batch = top;
    // entrada: um espaço por ingrediente com "tem/precisa"
    this.renderInputs(r, this.batch, false, all);
    // nome e tempo
    const others = this.crafting.freeSlot(this.station) >= 0 ? this.crafting.slots(this.station).filter((j) => j && !j.ready && !j.paused).length : 0;
    const speed = this.energy.speed(this.station);
    const est = (recipeSeconds(r, this.batch) * (others + 1)) / Math.max(0.0001, speed);
    setText(this.q.rname, r.outputs.map(outName).join(' + '));
    let hint = `${t('craft.k.time')} ${humanTime(speed > 0.001 ? est : Infinity)}`;
    if (batchable(r) && this.batch > 1) hint += ` · ${humanTime(unitSeconds(r) / Math.max(0.0001, speed))} ${t('craft.k.each')}`;
    if (others > 0) hint += ` · ${t('craft.sharing', { n: others + 1 })}`;
    const flash = this.flash && this.time < this.flash.until ? this.flash.text : null;
    setText(this.q.rsub, flash ?? hint);
    this.q.rsub.classList.toggle('warn', !!flash);
    // ciência
    this.q.info.hidden = !this.info;
    this.el.querySelector('[data-hit="info"]')?.classList.toggle('on', this.info);
    if (this.info) {
      setText(this.q.infoR, r.process.reaction);
      setText(this.q.infoS, r.process.steps.map((s, i) => `${i + 1}. ${s}`).join('  ·  '));
      setText(this.q.infoN, r.process.note);
    }
    // quantidade
    const canBatch = batchable(r);
    for (const id of ['minus', 'plus', 'max']) (this.el.querySelector(`[data-hit="${id}"]`) as HTMLElement).hidden = !canBatch;
    this.q.batch.hidden = !canBatch;
    setText(this.q.batch, `${this.batch}×`);
    (this.el.querySelector('[data-hit="minus"]') as HTMLButtonElement).disabled = this.batch <= 1;
    (this.el.querySelector('[data-hit="plus"]') as HTMLButtonElement).disabled = this.batch >= top;
    const max = this.el.querySelector('[data-hit="max"]') as HTMLButtonElement;
    setText(max, t('craft.all'));
    max.disabled = top <= 1 || this.batch >= top;
    let lbl: string;
    if (check.owned) lbl = r.outputs[0].kind === 'station' ? t('craft.installedTag') : t('craft.owned');
    else if (check.pending) lbl = t('craft.working');
    else if (check.full) lbl = t('craft.slotsFull');
    else if (check.missing.length) lbl = t('craft.missing');
    else lbl = this.batch > 1 ? t('craft.makeN', { n: this.batch }) : t('craft.make');
    const make = this.el.querySelector('[data-hit="make"]') as HTMLButtonElement;
    setText(make, lbl);
    make.disabled = !check.ok;
    this.q.in.classList.toggle('ready', check.ok);
  }

  /** a entrada: um espaço por ingrediente; `used` = o que um trabalho já consumiu (sem "tem/precisa") */
  private renderInputs(r: Recipe, batch: number, used: boolean, all: boolean): void {
    const sig = `${r.id}:${batch}:${used}:` + Object.keys(r.inputs).map((k) => this.crafting.has(k as ItemId)).join(',');
    if (!all && sig === this.ioSig) return;
    this.ioSig = sig;
    const box = this.q.inSlots;
    box.replaceChildren();
    for (const [item, n] of Object.entries(r.inputs) as [ItemId, number][]) {
      const need = n * batch, have = this.crafting.has(item);
      const short = !used && have < need;
      const s = h('div', 'slot st-in-slot' + (short ? ' short' : '') + (used ? ' used' : ''));
      s.title = ITEMS[item].name;
      s.innerHTML = `<img alt="" src="${this.icons.items[item] ?? ''}" draggable="false"><span class="count">${used ? need : `<i>${have}</i>/${need}`}</span>`;
      box.appendChild(s);
    }
  }

  private renderOutput(): void {
    const out = this.q.out;
    const img = out.querySelector('img') as HTMLImageElement;
    const count = out.querySelector('.count') as HTMLElement;
    const ready = this.crafting.hasReady(this.station);
    out.dataset.ready = ready ? '1' : '0';
    out.classList.toggle('ready', ready);
    if (ready) {
      out.dataset.hit = 'take';
      // o que está esperando: o primeiro item (ou o equipamento/estação) e a soma
      const waiting = new Map<string, { src: string; n: number }>();
      for (const j of this.crafting.slots(this.station)) {
        if (!j) continue;
        for (const [it, n] of Object.entries(j.waiting) as [ItemId, number][]) {
          const w = waiting.get(it) ?? { src: this.icons.items[it] ?? '', n: 0 };
          w.n += n;
          waiting.set(it, w);
        }
        if (j.ready && j.waitingCount > Object.values(j.waiting).reduce((s, n) => s + (n ?? 0), 0)) {
          const o = j.recipe.outputs.find((x) => x.kind !== 'item');
          if (o) waiting.set(`o:${j.slot}`, { src: this.iconFor(o), n: 1 });
        }
      }
      const first = [...waiting.values()][0];
      const total = [...waiting.values()].reduce((s, w) => s + w.n, 0);
      if (first && img.getAttribute('src') !== first.src) img.src = first.src;
      img.hidden = !first;
      setText(count, total > 1 ? String(total) : '');
      out.title = t('craft.takeAll');
      return;
    }
    delete out.dataset.hit;
    const job = this.slotSel !== null ? this.crafting.slots(this.station)[this.slotSel] : null;
    const r = job?.recipe ?? this.shown();
    const mult = job ? job.batch : this.batch;
    const o = r?.outputs[0];
    const src = o ? this.iconFor(o) : '';
    if (img.getAttribute('src') !== src) img.src = src;
    img.hidden = !src;
    setText(count, o && o.kind === 'item' && o.n * mult > 1 ? String(o.n * mult) : '');
    out.title = '';
  }

  private renderJobs(jobs: (JobView | null)[]): void {
    const box = this.q.jobs;
    const sig = jobs.map((j) => (j ? `${j.recipe.id}${j.batch}` : '-')).join('|') + this.slotSel;
    if (sig !== this.jobsSig) {
      this.jobsSig = sig;
      box.replaceChildren();
      jobs.forEach((j, i) => {
        const b = h('button', 'st-job' + (j ? '' : ' free') + (this.slotSel === i ? ' on' : ''));
        b.type = 'button';
        b.dataset.hit = `slot:${i}`;
        b.disabled = !j;
        const cells = j ? `<span class="st-cells">${'<i></i>'.repeat(Math.min(j.batch, 10))}</span>` : '';
        b.innerHTML = `<span class="st-job-k">${t('craft.k.slot')}${i + 1}</span>${j ? `<img alt="" src="${this.iconFor(j.recipe.outputs[0])}" draggable="false">` : ''}${cells}<span class="st-job-t"></span>`;
        box.appendChild(b);
      });
    }
    jobs.forEach((j, i) => {
      const b = box.children[i] as HTMLElement | undefined;
      if (!b) return;
      const tEl = b.querySelector('.st-job-t') as HTMLElement;
      if (!j) {
        setText(tEl, t('craft.k.free'));
        return;
      }
      b.classList.toggle('ready', j.ready || j.waitingCount > 0);
      b.classList.toggle('paused', j.paused);
      setText(tEl, j.leftover ? t('craft.k.leftover') : j.ready ? t('craft.k.done') : j.paused ? t('craft.k.paused') : clock(j.remaining));
      const cells = b.querySelectorAll<HTMLElement>('.st-cells i');
      const per = j.batch / Math.max(1, cells.length);
      cells.forEach((c, k) => {
        const doneUnits = j.units / per;
        const fill = k < Math.floor(doneUnits + 1e-6) ? 1 : k === Math.floor(doneUnits + 1e-6) && !j.ready ? j.unitProgress : 0;
        c.style.setProperty('--f', fill.toFixed(2));
      });
    });
  }

  private renderJobCtrl(j: JobView, all: boolean): void {
    setText(this.q.rname, `${t('craft.k.slot')}${j.slot + 1} · ${j.recipe.outputs.map(outName).join(' + ')}`);
    const state = j.leftover ? t('craft.k.leftover') : j.ready ? t('craft.k.done') : j.paused ? t('craft.k.paused') : `${t('craft.k.left')} ${clock(j.remaining)}`;
    setText(this.q.rsub, `${j.units}/${j.batch} ${t('craft.k.ready')} · ${state.toLowerCase()}`);
    this.q.rsub.classList.remove('warn');
    this.q.info.hidden = true;
    this.renderInputs(j.recipe, j.batch, true, all);
    this.q.in.classList.remove('ready');
    const take = this.el.querySelector('[data-hit="take-slot"]') as HTMLButtonElement;
    setText(take, j.waitingCount ? t('craft.takeN', { n: j.waitingCount }) : t('craft.take'));
    take.disabled = j.waitingCount <= 0;
    const pause = this.el.querySelector('[data-hit="pause"]') as HTMLButtonElement;
    setText(pause, j.paused ? t('craft.resume') : t('craft.pause'));
    pause.hidden = j.ready || j.leftover;
    const cancel = this.el.querySelector('[data-hit="cancel"]') as HTMLButtonElement;
    const sure = this.time - this.confirmCancel < 3;
    setText(cancel, sure ? t('craft.cancelSure') : t('craft.cancel'));
    cancel.classList.toggle('sure', sure);
    cancel.hidden = j.ready || j.leftover;
  }

  /** leitura da câmara e o estado da estação */
  private renderState(jobs: (JobView | null)[]): void {
    const working = jobs.some((j) => j && !j.ready && !j.paused && !j.leftover);
    const ready = jobs.some((j) => j && (j.ready || j.waitingCount > 0));
    setText(this.q.read, this.core.reading(jobs, this.energy.speed(this.station)));
    const s = working ? t('craft.status.work') : ready ? t('craft.status.ready') : this.core.cooling ? t('craft.status.cooling') : t('craft.status.idle');
    setText(this.q.state, s.toUpperCase());
    this.q.state.dataset.s = working ? 'work' : ready ? 'ready' : 'idle';
    this.el.classList.toggle('working', working);
  }
}
