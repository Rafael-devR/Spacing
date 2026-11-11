// Fabricação: confere receitas, gasta os materiais e entrega o resultado (docs/design/BASE.md).
// Não desenha nada: a animação do laser fica em render/Fabricator.ts e a experiência em app/BaseDirector.ts.
import type { GameBus } from '../app/events';
import type { ItemId } from '../data/items';
import { RECIPES, type Recipe, type Station } from '../data/recipes';
import type { Equipment } from './Equipment';
import type { Inventory } from './Inventory';

export interface RecipeCheck {
  ok: boolean;
  /** já tem esse equipamento */
  owned: boolean;
  /** a bancada está ocupada fabricando outra coisa */
  busy: boolean;
  missing: { item: ItemId; missing: number }[];
}

interface Job {
  recipe: Recipe;
  t: number;
}

export class Crafting {
  private job: Job | null = null;
  /** última receita terminada (para a experiência mostrar o resultado) */
  lastFinished: Recipe | null = null;

  constructor(private readonly d: { inventory: Inventory; equipment: Equipment; events?: GameBus }) {}

  recipes(station: Station): Recipe[] {
    return RECIPES.filter((r) => r.station === station);
  }

  /** quantos o jogador tem de um item (para a tela da bancada) */
  has(item: ItemId): number {
    return this.d.inventory.count(item);
  }

  get busy(): boolean {
    return this.job !== null;
  }

  /** 0..1 do trabalho atual (null = parada) */
  get progress(): number | null {
    return this.job ? Math.min(1, this.job.t / this.job.recipe.seconds) : null;
  }

  get current(): Recipe | null {
    return this.job?.recipe ?? null;
  }

  check(r: Recipe): RecipeCheck {
    const inv = this.d.inventory;
    const owned = r.output.kind === 'equip' && this.d.equipment.covers(r.output.equip);
    const missing = (Object.entries(r.inputs) as [ItemId, number][])
      .filter(([item, n]) => !inv.has(item, n))
      .map(([item, n]) => ({ item, missing: n - inv.count(item) }));
    return { ok: !owned && !this.busy && missing.length === 0, owned, busy: this.busy, missing };
  }

  /** Começa a fabricar: os materiais saem na hora. Retorna false se não der. */
  start(r: Recipe): boolean {
    if (!this.check(r).ok) return false;
    if (!this.d.inventory.removeAll(r.inputs)) return false;
    this.job = { recipe: r, t: 0 };
    this.d.events?.emit('craft:started', { recipe: r.id, seconds: r.seconds });
    return true;
  }

  /** Avança o trabalho; ao terminar entrega o resultado. */
  update(dt: number): void {
    const job = this.job;
    if (!job) return;
    job.t += dt;
    if (job.t < job.recipe.seconds) return;
    this.job = null;
    this.lastFinished = job.recipe;
    const out = job.recipe.output;
    if (out.kind === 'equip') this.d.equipment.equip(out.equip);
    else {
      const left = this.d.inventory.add(out.item, out.n, false);
      if (left > 0) this.d.events?.emit('inventory:full', { item: out.item, amount: left });
    }
    this.d.events?.emit('craft:finished', { recipe: job.recipe.id });
  }
}
