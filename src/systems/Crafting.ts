// Fabricação nas estações da base (docs/design/CRAFTING.md). Cada estação faz uma receita por vez e trabalha
// sozinha: os materiais saem na hora, o relógio corre com o jogo aberto (em qualquer lugar do mundo) e o resultado
// espera na estação até o jogador pegar. Não desenha nada: a animação fica em render/ e a experiência em
// app/BaseDirector.ts.
import type { GameBus } from '../app/events';
import { isItemId, type ItemId } from '../data/items';
import { RECIPES, recipeById, recipeSeconds, rollSeconds, type Recipe, type RecipeOutput } from '../data/recipes';
import { isStationId, STATION_ORDER, STATIONS, type StationId } from '../data/stations';
import type { Equipment } from './Equipment';
import type { Inventory } from './Inventory';

export interface RecipeCheck {
  ok: boolean;
  /** já tem esse equipamento ou essa estação */
  owned: boolean;
  /** a estação está ocupada (trabalhando ou com algo para pegar) */
  busy: boolean;
  /** a estação da receita ainda não foi construída */
  locked: boolean;
  missing: { item: ItemId; missing: number }[];
}

export interface JobSave {
  station: StationId;
  recipe: string;
  t: number;
  duration: number;
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
  recipe: Recipe;
  t: number;
  duration: number;
  /** itens por entregar (começa com todas as saídas de item) */
  left: Partial<Record<ItemId, number>>;
  /** equipamento ou estação por entregar */
  rest: boolean;
}

export interface JobView {
  recipe: Recipe;
  /** 0..1 */
  progress: number;
  /** segundos que faltam */
  remaining: number;
  duration: number;
  ready: boolean;
  /** índice da etapa atual (receita.process.steps) */
  step: number;
}

export interface TakeResult {
  recipe: Recipe;
  /** o que entrou no inventário */
  items: Partial<Record<ItemId, number>>;
  /** o que foi entregue além dos itens */
  delivered: RecipeOutput[];
  /** sobrou algo na estação (inventário cheio) */
  partial: boolean;
}

export interface CraftingDeps {
  inventory: Inventory;
  equipment: Equipment;
  events?: GameBus;
  /** sorteio de 0 a 1 para a variação do tempo (testes passam um fixo) */
  rand?: () => number;
}

export class Crafting {
  private readonly jobs = new Map<StationId, Job>();
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
      if (!recipe || recipe.station !== j.station || this.jobs.has(j.station)) continue;
      const duration = j.duration > 0 ? j.duration : recipeSeconds(recipe);
      const job: Job = { recipe, t: Math.max(0, Math.min(j.t, duration)), duration, left: itemOutputs(recipe), rest: hasRest(recipe) };
      if (j.left) {
        job.left = {};
        for (const [k, n] of Object.entries(j.left)) if (isItemId(k) && typeof n === 'number' && n > 0) job.left[k] = Math.floor(n);
      }
      if (j.rest === false) job.rest = false;
      this.jobs.set(j.station, job);
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

  /** a estação trabalha ou tem algo esperando */
  busy(station: StationId): boolean {
    return this.jobs.has(station);
  }

  job(station: StationId): JobView | null {
    const j = this.jobs.get(station);
    if (!j) return null;
    const progress = Math.min(1, j.t / j.duration);
    const steps = j.recipe.process.steps.length;
    return {
      recipe: j.recipe,
      progress,
      remaining: Math.max(0, j.duration - j.t),
      duration: j.duration,
      ready: progress >= 1,
      step: Math.min(steps - 1, Math.floor(progress * steps)),
    };
  }

  /** todas as estações com trabalho (para o HUD) */
  activeJobs(): { station: StationId; view: JobView }[] {
    const out: { station: StationId; view: JobView }[] = [];
    for (const id of STATION_ORDER) {
      const v = this.job(id);
      if (v) out.push({ station: id, view: v });
    }
    return out;
  }

  /** o jogador já tem o que a receita entrega (equipamento igual ou melhor, estação construída) */
  owned(r: Recipe): boolean {
    return r.outputs.some(
      (o) => (o.kind === 'equip' && this.d.equipment.covers(o.equip)) || (o.kind === 'station' && this.built.has(o.station)),
    );
  }

  check(r: Recipe): RecipeCheck {
    const inv = this.d.inventory;
    const owned = this.owned(r);
    const busy = this.jobs.has(r.station);
    const locked = !this.built.has(r.station);
    const missing = (Object.entries(r.inputs) as [ItemId, number][])
      .filter(([item, n]) => !inv.has(item, n))
      .map(([item, n]) => ({ item, missing: n - inv.count(item) }));
    return { ok: !owned && !busy && !locked && missing.length === 0, owned, busy, locked, missing };
  }

  /** Começa a fabricar: os materiais saem na hora. Retorna false se não der. */
  start(r: Recipe): boolean {
    if (!this.check(r).ok) return false;
    if (!this.d.inventory.removeAll(r.inputs)) return false;
    const duration = rollSeconds(r, this.rand());
    this.jobs.set(r.station, { recipe: r, t: 0, duration, left: itemOutputs(r), rest: hasRest(r) });
    this.d.events?.emit('craft:started', { station: r.station, recipe: r.id, seconds: duration });
    return true;
  }

  /** Avança todas as estações. */
  update(dt: number): void {
    for (const [station, j] of this.jobs) {
      if (j.t >= j.duration) continue;
      j.t = Math.min(j.duration, j.t + dt);
      if (j.t >= j.duration) this.d.events?.emit('craft:ready', { station, recipe: j.recipe.id });
    }
  }

  /**
   * Pega o que está pronto na estação: itens vão para o inventário (o que não couber fica esperando),
   * equipamento é equipado e estação é construída. null = nada pronto.
   */
  take(station: StationId): TakeResult | null {
    const j = this.jobs.get(station);
    if (!j || j.t < j.duration) return null;
    const items: Partial<Record<ItemId, number>> = {};
    const delivered: RecipeOutput[] = [];
    for (const [item, n] of Object.entries(j.left) as [ItemId, number][]) {
      const left = this.d.inventory.add(item, n, true);
      if (n - left > 0) items[item] = n - left;
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
    // o que não coube fica na estação (o inventário já avisou que está cheio)
    const partial = Object.keys(j.left).length > 0;
    if (!partial) this.jobs.delete(station);
    this.d.events?.emit('craft:taken', { station, recipe: j.recipe.id, partial });
    return { recipe: j.recipe, items, delivered, partial };
  }

  serialize(): CraftingSave {
    const built = [...this.built].filter((id) => !STATIONS[id].builtIn);
    const jobs: JobSave[] = [];
    for (const [station, j] of this.jobs) {
      const s: JobSave = { station, recipe: j.recipe.id, t: Math.round(j.t * 10) / 10, duration: Math.round(j.duration * 10) / 10 };
      if (j.t >= j.duration) {
        s.left = { ...j.left };
        s.rest = j.rest;
      }
      jobs.push(s);
    }
    return { built, jobs };
  }
}

function itemOutputs(r: Recipe): Partial<Record<ItemId, number>> {
  const out: Partial<Record<ItemId, number>> = {};
  for (const o of r.outputs) if (o.kind === 'item') out[o.item] = (out[o.item] ?? 0) + o.n;
  return out;
}

function hasRest(r: Recipe): boolean {
  return r.outputs.some((o) => o.kind !== 'item');
}
