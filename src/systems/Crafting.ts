// Fabricação nas estações da base (docs/design/CRAFTING.md). Cada estação tem vagas (o forno, 3 cadinhos; o
// eletrolisador, 2 células; a bancada, 1): várias receitas trabalham ao mesmo tempo e **dividem a energia** da
// estação, então cada uma anda mais devagar, e quando uma termina as outras aceleram. A energia vem de algum lugar
// (docs/design/ENERGIA.md): `speed` diz quanto a estação recebe agora. Uma receita pode ser feita em lote (todos os
// minérios de uma vez, mais tempo). Os materiais saem na hora; o resultado espera na estação até o jogador pegar.
// Não desenha nada: a tela fica em ui/CraftPanel.ts e a experiência em app/BaseDirector.ts.
import type { GameBus } from '../app/events';
import { isItemId, type ItemId } from '../data/items';
import { batchable, MAX_BATCH, RECIPES, recipeById, recipeSeconds, rollSeconds, type Recipe, type RecipeOutput } from '../data/recipes';
import { isStationId, STATION_ORDER, STATIONS, type StationId } from '../data/stations';
import type { Equipment } from './Equipment';
import type { Inventory } from './Inventory';

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
  /** trabalho total (segundos com energia cheia e a estação só com ele) e quanto já foi feito */
  work: number;
  done: number;
  /** itens que ainda não couberam no inventário (só depois de pronto) */
  left?: Partial<Record<ItemId, number>>;
  /** equipamento ou estação ainda não entregue */
  rest?: boolean;
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
  work: number;
  done: number;
  left: Partial<Record<ItemId, number>>;
  rest: boolean;
}

export interface JobView {
  station: StationId;
  slot: number;
  recipe: Recipe;
  batch: number;
  /** 0..1 */
  progress: number;
  /** segundos que faltam na velocidade de agora (Infinity sem energia nenhuma) */
  remaining: number;
  ready: boolean;
  /** índice da etapa atual (receita.process.steps) */
  step: number;
  /** 0..1 da energia da estação que vai para este trabalho agora */
  share: number;
  /** itens que ainda vão sair (ou que esperam para ser pegos) */
  outputs: Partial<Record<ItemId, number>>;
}

export interface TakeResult {
  /** o que entrou no inventário */
  items: Partial<Record<ItemId, number>>;
  /** o que foi entregue além dos itens */
  delivered: RecipeOutput[];
  /** sobrou algo na estação (inventário cheio) */
  partial: boolean;
  /** receitas que saíram */
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
    for (const j of saved.jobs) {
      const recipe = recipeById(j.recipe);
      if (!recipe || recipe.station !== j.station) continue;
      const slots = STATIONS[j.station].slots;
      if (!Number.isInteger(j.slot) || j.slot < 0 || j.slot >= slots || this.jobAt(j.station, j.slot)) continue;
      const batch = batchable(recipe) ? Math.max(1, Math.min(MAX_BATCH, Math.floor(j.batch) || 1)) : 1;
      const work = j.work > 0 ? j.work : recipeSeconds(recipe, batch);
      const job: Job = {
        station: j.station, slot: j.slot, recipe, batch, work, done: Math.max(0, Math.min(j.done, work)),
        left: itemOutputs(recipe, batch), rest: hasRest(recipe),
      };
      if (j.left) {
        job.left = {};
        for (const [k, n] of Object.entries(j.left)) if (isItemId(k) && typeof n === 'number' && n > 0) job.left[k] = Math.floor(n);
      }
      if (j.rest === false) job.rest = false;
      this.jobs.push(job);
    }
  }

  recipes(station: StationId): Recipe[] {
    return RECIPES.filter((r) => r.station === station);
  }

  isBuilt(station: StationId): boolean {
    return this.built.has(station);
  }

  /** quantos o jogador tem de um item (para a tela da estação) */
  has(item: ItemId): number {
    return this.d.inventory.count(item);
  }

  private jobAt(station: StationId, slot: number): Job | undefined {
    return this.jobs.find((j) => j.station === station && j.slot === slot);
  }

  /** a estação tem algum trabalho (andando ou esperando) */
  busy(station: StationId): boolean {
    return this.jobs.some((j) => j.station === station);
  }

  /** a estação está trabalhando agora (gasta energia) */
  working(station: StationId): boolean {
    return this.jobs.some((j) => j.station === station && j.done < j.work);
  }

  /** primeira vaga livre, ou -1 */
  freeSlot(station: StationId): number {
    for (let s = 0; s < STATIONS[station].slots; s++) if (!this.jobAt(station, s)) return s;
    return -1;
  }

  /** energia da estação agora, dividida igualmente entre os trabalhos que andam */
  private shareOf(station: StationId): number {
    const n = this.jobs.filter((j) => j.station === station && j.done < j.work).length;
    return n ? 1 / n : 1;
  }

  private view(j: Job): JobView {
    const progress = Math.min(1, j.done / j.work);
    const steps = j.recipe.process.steps.length;
    const ready = j.done >= j.work;
    const share = ready ? 0 : this.shareOf(j.station);
    const rate = share * (this.d.speed?.(j.station) ?? 1);
    return {
      station: j.station, slot: j.slot, recipe: j.recipe, batch: j.batch, progress,
      remaining: ready ? 0 : rate > 0 ? (j.work - j.done) / rate : Infinity,
      ready, step: Math.min(steps - 1, Math.floor(progress * steps)), share,
      outputs: { ...j.left },
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

  /** algum trabalho pronto na estação */
  hasReady(station: StationId): boolean {
    return this.jobs.some((j) => j.station === station && j.done >= j.work);
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
    const pending = !batchable(r) && this.jobs.some((j) => j.recipe.id === r.id);
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
    const needs: Partial<Record<ItemId, number>> = {};
    for (const [item, n] of Object.entries(r.inputs) as [ItemId, number][]) needs[item] = n * batch;
    if (!this.d.inventory.removeAll(needs)) return false;
    const slot = this.freeSlot(r.station);
    const work = rollSeconds(r, this.rand(), batch);
    this.jobs.push({ station: r.station, slot, recipe: r, batch, work, done: 0, left: itemOutputs(r, batch), rest: hasRest(r) });
    this.d.events?.emit('craft:started', { station: r.station, recipe: r.id, seconds: work, slot, batch });
    return true;
  }

  /** Avança todas as estações com a energia que cada uma recebe, dividida entre os trabalhos dela. */
  update(dt: number): void {
    for (const station of STATION_ORDER) {
      const active = this.jobs.filter((j) => j.station === station && j.done < j.work);
      if (!active.length) continue;
      const step = (dt * (this.d.speed?.(station) ?? 1)) / active.length;
      for (const j of active) {
        j.done = Math.min(j.work, j.done + step);
        if (j.done >= j.work) this.d.events?.emit('craft:ready', { station, recipe: j.recipe.id, slot: j.slot });
      }
    }
  }

  /**
   * Pega tudo o que está pronto na estação: itens vão para o inventário (o que não couber fica esperando),
   * equipamento é equipado e estação é construída. null = nada pronto.
   */
  take(station: StationId): TakeResult | null {
    const ready = this.jobs.filter((j) => j.station === station && j.done >= j.work);
    if (!ready.length) return null;
    const items: Partial<Record<ItemId, number>> = {};
    const delivered: RecipeOutput[] = [];
    for (const j of ready) {
      for (const [item, n] of Object.entries(j.left) as [ItemId, number][]) {
        const left = this.d.inventory.add(item, n, true);
        if (n - left > 0) items[item] = (items[item] ?? 0) + n - left;
        if (left > 0) j.left[item] = left;
        else delete j.left[item];
      }
      if (j.rest) {
        for (const o of j.recipe.outputs) {
          if (o.kind === 'equip') this.d.equipment.equip(o.equip);
          else if (o.kind === 'station') this.built.add(o.station);
          else continue;
          delivered.push(o);
        }
        j.rest = false;
      }
    }
    // o que não coube fica na estação (o inventário já avisou que está cheio)
    const kept = ready.filter((j) => Object.keys(j.left).length > 0);
    for (const j of ready) if (!kept.includes(j)) this.jobs.splice(this.jobs.indexOf(j), 1);
    const partial = kept.length > 0;
    this.d.events?.emit('craft:taken', { station, recipe: ready[0].recipe.id, partial });
    return { items, delivered, partial, recipes: ready.map((j) => j.recipe) };
  }

  serialize(): CraftingSave {
    const built = [...this.built].filter((id) => !STATIONS[id].builtIn);
    const jobs: JobSave[] = this.jobs.map((j) => {
      const s: JobSave = {
        station: j.station, slot: j.slot, recipe: j.recipe.id, batch: j.batch,
        work: Math.round(j.work * 10) / 10, done: Math.min(j.work, Math.round(j.done * 10) / 10),
      };
      if (j.done >= j.work) {
        s.done = s.work;
        s.left = { ...j.left };
        s.rest = j.rest;
      }
      return s;
    });
    return { built, jobs };
  }
}

function itemOutputs(r: Recipe, batch: number): Partial<Record<ItemId, number>> {
  const out: Partial<Record<ItemId, number>> = {};
  for (const o of r.outputs) if (o.kind === 'item') out[o.item] = (out[o.item] ?? 0) + o.n * batch;
  return out;
}

function hasRest(r: Recipe): boolean {
  return r.outputs.some((o) => o.kind !== 'item');
}
