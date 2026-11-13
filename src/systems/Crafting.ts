// Fabricação nas estações da base (docs/design/CRAFTING.md). Cada estação tem vagas (o forno, 3 cadinhos; o
// eletrolisador, 2 células; a bancada, 1): várias receitas trabalham ao mesmo tempo e **dividem a energia** da
// estação. A energia vem de algum lugar (docs/design/ENERGIA.md): `speed` diz quanto a estação recebe agora.
// Uma receita pode ser feita em lote: depois do preparo, sai **uma unidade de cada vez**, e cada unidade pronta já pode
// ser pega, sem esperar o lote inteiro. Um trabalho pode ser **pausado** (não gasta energia, os outros aceleram) ou
// **cancelado** (devolve os materiais do que ainda não ficou pronto). Não desenha nada: a tela fica em ui/station/StationScreen.ts
// e a experiência em app/BaseDirector.ts.
import type { GameBus } from '../app/events';
import { isItemId, type ItemId } from '../data/items';
import { batchable, MAX_BATCH, RECIPES, recipeById, rollTimes, unitSeconds, type Recipe, type RecipeOutput } from '../data/recipes';
import { isStationId, STATION_ORDER, STATIONS, type StationId } from '../data/stations';
import type { Equipment } from './Equipment';
import type { Inventory } from './Inventory';

type Counts = Partial<Record<ItemId, number>>;

export interface RecipeCheck {
  ok: boolean;
  /** já tem esse equipamento ou essa estação */
  owned: boolean;
  /** todas as vagas da estação estão ocupadas */
  full: boolean;
  /** a estação da receita ainda não foi construída */
  locked: boolean;
  /** já há um trabalho igual (equipamento e estação: um de cada vez) */
  pending: boolean;
  missing: { item: ItemId; missing: number }[];
  /** quantas vezes dá para fazer com o que tem (lote máximo) */
  max: number;
}

export interface JobSave {
  station: StationId;
  slot: number;
  recipe: string;
  batch: number;
  /** segundos de preparo e por unidade (com a variação), e quanto trabalho já foi feito */
  prep: number;
  unit: number;
  done: number;
  /** itens já entregues ao jogador */
  taken?: Counts;
  /** equipamento ou estação já entregue */
  delivered?: boolean;
  paused?: boolean;
  /** só sobra para pegar (trabalho cancelado com o inventário cheio) */
  leftover?: Counts;
}

export interface CraftingSave {
  built: StationId[];
  jobs: JobSave[];
}

interface Job {
  station: StationId;
  slot: number;
  recipe: Recipe;
  batch: number;
  prep: number;
  unit: number;
  done: number;
  taken: Counts;
  delivered: boolean;
  paused: boolean;
  /** trabalho cancelado: só o que sobrou para pegar */
  leftover: Counts | null;
}

export interface JobView {
  station: StationId;
  slot: number;
  recipe: Recipe;
  batch: number;
  /** 0..1 do trabalho todo */
  progress: number;
  /** unidades prontas (pegas ou não) */
  units: number;
  /** 0..1 da unidade que está sendo feita agora */
  unitProgress: number;
  /** segundos que faltam na velocidade de agora (Infinity sem energia ou pausado) */
  remaining: number;
  /** tudo feito */
  ready: boolean;
  paused: boolean;
  /** índice da etapa atual (receita.process.steps) */
  step: number;
  /** 0..1 da energia da estação que vai para este trabalho agora */
  share: number;
  /** itens prontos esperando para ser pegos */
  waiting: Counts;
  /** quantos itens prontos esperam (soma de `waiting`, + 1 se há equipamento/estação para entregar) */
  waitingCount: number;
  /** trabalho cancelado que só guarda sobras */
  leftover: boolean;
}

export interface TakeResult {
  /** o que entrou no inventário */
  items: Counts;
  /** o que foi entregue além dos itens */
  delivered: RecipeOutput[];
  /** sobrou algo na estação (inventário cheio) */
  partial: boolean;
  /** receitas que entregaram algo */
  recipes: Recipe[];
}

export interface CraftingDeps {
  inventory: Inventory;
  equipment: Equipment;
  events?: GameBus;
  /** sorteio de 0 a 1 para a variação do tempo (testes passam um fixo) */
  rand?: () => number;
  /** 0..1: energia que a estação recebe agora (padrão: cheia) */
  speed?: (station: StationId) => number;
}

const work = (j: Job): number => j.prep + j.unit * j.batch;
const finished = (j: Job): boolean => !!j.leftover || j.done >= work(j) - 1e-9;
/** unidades prontas */
const unitsDone = (j: Job): number => {
  if (j.leftover) return j.batch;
  if (j.done < j.prep) return 0;
  return Math.min(j.batch, Math.floor((j.done - j.prep) / Math.max(1e-9, j.unit) + 1e-9));
};
const add = (c: Counts, item: ItemId, n: number): void => {
  if (n > 0) c[item] = (c[item] ?? 0) + n;
};

export class Crafting {
  private readonly jobs: Job[] = [];
  private readonly built = new Set<StationId>();
  private readonly rand: () => number;

  constructor(
    private readonly d: CraftingDeps,
    saved: CraftingSave | null = null,
  ) {
    this.rand = d.rand ?? Math.random;
    for (const id of STATION_ORDER) if (STATIONS[id].builtIn) this.built.add(id);
    if (saved) this.restore(saved);
  }

  private restore(saved: CraftingSave): void {
    for (const id of saved.built) if (isStationId(id)) this.built.add(id);
    const counts = (v: unknown): Counts => {
      const out: Counts = {};
      if (v && typeof v === 'object') for (const [k, n] of Object.entries(v)) if (isItemId(k) && typeof n === 'number' && n > 0) out[k] = Math.floor(n);
      return out;
    };
    for (const j of saved.jobs) {
      const recipe = recipeById(j.recipe);
      if (!recipe || recipe.station !== j.station) continue;
      if (!Number.isInteger(j.slot) || j.slot < 0 || j.slot >= STATIONS[j.station].slots || this.jobAt(j.station, j.slot)) continue;
      const batch = batchable(recipe) ? Math.max(1, Math.min(MAX_BATCH, Math.floor(j.batch) || 1)) : 1;
      const prep = Math.max(0, j.prep || 0);
      const unit = j.unit > 0 ? j.unit : unitSeconds(recipe);
      const job: Job = {
        station: j.station, slot: j.slot, recipe, batch, prep, unit, done: 0, taken: counts(j.taken),
        delivered: j.delivered === true, paused: j.paused === true, leftover: j.leftover ? counts(j.leftover) : null,
      };
      job.done = Math.max(0, Math.min(j.done || 0, work(job)));
      this.jobs.push(job);
    }
  }

  recipes(station: StationId): Recipe[] {
    return RECIPES.filter((r) => r.station === station);
  }

  isBuilt(station: StationId): boolean {
    return this.built.has(station);
  }

  /** Só no modo de teste: instala a estação sem fabricá-la (docs/design/TESTE.md). */
  unlock(station: StationId): void {
    this.built.add(station);
  }

  /** quantos o jogador tem de um item (para a tela da estação) */
  has(item: ItemId): number {
    return this.d.inventory.count(item);
  }

  private jobAt(station: StationId, slot: number): Job | undefined {
    return this.jobs.find((j) => j.station === station && j.slot === slot);
  }

  /** a estação tem algum trabalho (andando, pausado ou esperando) */
  busy(station: StationId): boolean {
    return this.jobs.some((j) => j.station === station);
  }

  private runningIn(station: StationId): Job[] {
    return this.jobs.filter((j) => j.station === station && !j.paused && !finished(j));
  }

  /** a estação está trabalhando agora (gasta energia) */
  working(station: StationId): boolean {
    return this.runningIn(station).length > 0;
  }

  /** primeira vaga livre, ou -1 */
  freeSlot(station: StationId): number {
    for (let s = 0; s < STATIONS[station].slots; s++) if (!this.jobAt(station, s)) return s;
    return -1;
  }

  /** itens prontos ainda não pegos de um trabalho */
  private waiting(j: Job): Counts {
    if (j.leftover) return { ...j.leftover };
    const made: Counts = {};
    const u = unitsDone(j);
    for (const o of j.recipe.outputs) if (o.kind === 'item') add(made, o.item, o.n * u);
    const out: Counts = {};
    for (const [k, n] of Object.entries(made) as [ItemId, number][]) add(out, k, n - (j.taken[k] ?? 0));
    return out;
  }

  private restPending(j: Job): boolean {
    return !j.leftover && !j.delivered && finished(j) && j.recipe.outputs.some((o) => o.kind !== 'item');
  }

  private view(j: Job): JobView {
    const w = work(j);
    const ready = finished(j);
    const running = this.runningIn(j.station);
    const share = !ready && !j.paused ? 1 / Math.max(1, running.length) : 0;
    const rate = share * (this.d.speed?.(j.station) ?? 1);
    const steps = j.recipe.process.steps.length;
    const progress = ready ? 1 : Math.min(1, j.done / w);
    const units = unitsDone(j);
    const unitProgress = ready || units >= j.batch ? 1 : j.done < j.prep ? 0 : ((j.done - j.prep) % j.unit) / j.unit;
    const waiting = this.waiting(j);
    const waitingCount = Object.values(waiting).reduce((s, n) => s + (n ?? 0), 0) + (this.restPending(j) ? 1 : 0);
    return {
      station: j.station, slot: j.slot, recipe: j.recipe, batch: j.batch, progress, units, unitProgress,
      remaining: ready ? 0 : rate > 0 ? (w - j.done) / rate : Infinity,
      ready, paused: j.paused, step: Math.min(steps - 1, Math.floor(progress * steps)), share, waiting, waitingCount,
      leftover: !!j.leftover,
    };
  }

  /** trabalhos da estação, na ordem das vagas */
  slots(station: StationId): (JobView | null)[] {
    const out: (JobView | null)[] = [];
    for (let s = 0; s < STATIONS[station].slots; s++) {
      const j = this.jobAt(station, s);
      out.push(j ? this.view(j) : null);
    }
    return out;
  }

  /** algo pronto para pegar na estação */
  hasReady(station: StationId): boolean {
    return this.jobs.some((j) => j.station === station && (Object.keys(this.waiting(j)).length > 0 || this.restPending(j)));
  }

  /** todos os trabalhos (para o HUD) */
  activeJobs(): JobView[] {
    const order = (s: StationId): number => STATION_ORDER.indexOf(s);
    return [...this.jobs].sort((a, b) => order(a.station) - order(b.station) || a.slot - b.slot).map((j) => this.view(j));
  }

  /** o jogador já tem o que a receita entrega (equipamento igual ou melhor, estação construída) */
  owned(r: Recipe): boolean {
    return r.outputs.some(
      (o) => (o.kind === 'equip' && this.d.equipment.covers(o.equip)) || (o.kind === 'station' && this.built.has(o.station)),
    );
  }

  /** quantas vezes dá para fazer a receita com o inventário de agora */
  maxBatch(r: Recipe): number {
    let max = batchable(r) ? MAX_BATCH : 1;
    for (const [item, n] of Object.entries(r.inputs) as [ItemId, number][]) max = Math.min(max, Math.floor(this.d.inventory.count(item) / n));
    return Math.max(0, max);
  }

  check(r: Recipe, batch = 1): RecipeCheck {
    const inv = this.d.inventory;
    const owned = this.owned(r);
    const full = this.freeSlot(r.station) < 0;
    const locked = !this.built.has(r.station);
    const pending = !batchable(r) && this.jobs.some((j) => j.recipe.id === r.id && !j.leftover);
    const missing = (Object.entries(r.inputs) as [ItemId, number][])
      .filter(([item, n]) => !inv.has(item, n * batch))
      .map(([item, n]) => ({ item, missing: n * batch - inv.count(item) }));
    const max = this.maxBatch(r);
    const okBatch = batch >= 1 && batch <= (batchable(r) ? MAX_BATCH : 1);
    return { ok: okBatch && !owned && !full && !locked && !pending && missing.length === 0, owned, full, locked, pending, missing, max };
  }

  /** Começa a fabricar `batch` vezes numa vaga livre: os materiais saem na hora. Retorna false se não der. */
  start(r: Recipe, batch = 1): boolean {
    if (!this.check(r, batch).ok) return false;
    const needs: Counts = {};
    for (const [item, n] of Object.entries(r.inputs) as [ItemId, number][]) needs[item] = n * batch;
    if (!this.d.inventory.removeAll(needs)) return false;
    const slot = this.freeSlot(r.station);
    const { prep, unit } = rollTimes(r, this.rand());
    this.jobs.push({ station: r.station, slot, recipe: r, batch, prep, unit, done: 0, taken: {}, delivered: false, paused: false, leftover: null });
    this.d.events?.emit('craft:started', { station: r.station, recipe: r.id, seconds: prep + unit * batch, slot, batch });
    return true;
  }

  /** Avança todas as estações com a energia que cada uma recebe, dividida entre os trabalhos que andam. */
  update(dt: number): void {
    for (const station of STATION_ORDER) {
      const active = this.runningIn(station);
      if (!active.length) continue;
      const step = (dt * (this.d.speed?.(station) ?? 1)) / active.length;
      for (const j of active) {
        j.done = Math.min(work(j), j.done + step);
        if (finished(j)) this.d.events?.emit('craft:ready', { station, recipe: j.recipe.id, slot: j.slot });
      }
    }
  }

  /** Pausa ou retoma o trabalho da vaga. Pausado não gasta energia; os outros da estação aceleram. */
  togglePause(station: StationId, slot: number): boolean {
    const j = this.jobAt(station, slot);
    if (!j || finished(j)) return false;
    j.paused = !j.paused;
    this.d.events?.emit('craft:paused', { station, slot, paused: j.paused });
    return true;
  }

  /**
   * Cancela o trabalho da vaga: o que já ficou pronto vai para o inventário e os materiais do que ainda não ficou
   * pronto voltam (a unidade pela metade também). O que não couber fica na vaga para pegar depois.
   */
  cancel(station: StationId, slot: number): Counts | null {
    const j = this.jobAt(station, slot);
    if (!j || j.leftover || finished(j)) return null;
    const back: Counts = this.waiting(j);
    const notDone = j.batch - unitsDone(j);
    for (const [item, n] of Object.entries(j.recipe.inputs) as [ItemId, number][]) add(back, item, n * notDone);
    const left: Counts = {};
    for (const [item, n] of Object.entries(back) as [ItemId, number][]) add(left, item, this.d.inventory.add(item, n, false));
    this.jobs.splice(this.jobs.indexOf(j), 1);
    if (Object.keys(left).length) this.jobs.push({ ...j, done: work(j), paused: false, leftover: left, delivered: true });
    this.d.events?.emit('craft:cancelled', { station, slot, recipe: j.recipe.id });
    return back;
  }

  /**
   * Pega tudo o que está pronto na estação (ou só numa vaga): itens vão para o inventário (o que não couber fica
   * esperando), equipamento é equipado e estação é construída. Unidades prontas de um lote ainda andando também
   * saem. null = nada pronto.
   */
  take(station: StationId, slot?: number): TakeResult | null {
    const jobs = this.jobs.filter((j) => j.station === station && (slot === undefined || j.slot === slot));
    const items: Counts = {};
    const delivered: RecipeOutput[] = [];
    const recipes: Recipe[] = [];
    let any = false, partial = false;
    for (const j of jobs) {
      const wait = this.waiting(j);
      let gave = false;
      for (const [item, n] of Object.entries(wait) as [ItemId, number][]) {
        const left = this.d.inventory.add(item, n, true);
        const got = n - left;
        if (got > 0) {
          add(items, item, got);
          gave = true;
          if (j.leftover) {
            j.leftover[item] = (j.leftover[item] ?? 0) - got;
            if ((j.leftover[item] ?? 0) <= 0) delete j.leftover[item];
          } else add(j.taken, item, got);
        }
        if (left > 0) partial = true;
      }
      if (this.restPending(j)) {
        for (const o of j.recipe.outputs) {
          if (o.kind === 'equip') this.d.equipment.equip(o.equip);
          else if (o.kind === 'station') this.built.add(o.station);
          else continue;
          delivered.push(o);
        }
        j.delivered = true;
        gave = true;
      }
      if (gave) {
        any = true;
        recipes.push(j.recipe);
      }
    }
    // trabalho terminado e todo entregue sai da vaga
    for (const j of jobs) {
      const empty = Object.keys(this.waiting(j)).length === 0 && !this.restPending(j);
      if (finished(j) && empty) this.jobs.splice(this.jobs.indexOf(j), 1);
    }
    if (!any) return null;
    this.d.events?.emit('craft:taken', { station, recipe: recipes[0].id, partial });
    return { items, delivered, partial, recipes };
  }

  serialize(): CraftingSave {
    const built = [...this.built].filter((id) => !STATIONS[id].builtIn);
    const r1 = (v: number): number => Math.round(v * 100) / 100;
    const jobs: JobSave[] = this.jobs.map((j) => {
      const s: JobSave = { station: j.station, slot: j.slot, recipe: j.recipe.id, batch: j.batch, prep: r1(j.prep), unit: r1(j.unit), done: r1(j.done) };
      if (finished(j)) s.done = r1(j.prep) + r1(j.unit) * j.batch;
      if (Object.keys(j.taken).length) s.taken = { ...j.taken };
      if (j.delivered) s.delivered = true;
      if (j.paused) s.paused = true;
      if (j.leftover) s.leftover = { ...j.leftover };
      return s;
    });
    return { built, jobs };
  }
}
