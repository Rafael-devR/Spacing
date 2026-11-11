// Receitas da bancada de fabricação (docs/design/BASE.md).
// Acrescentar uma receita = uma entrada aqui; a bancada lista todas.
import type { EquipId } from './equipment';
import type { ItemId } from './items';

/** onde a receita é feita (mais tarde: fornalha, eletrolisador...) */
export type Station = 'workbench';

export type RecipeOutput = { kind: 'item'; item: ItemId; n: number } | { kind: 'equip'; equip: EquipId };

export interface Recipe {
  id: string;
  station: Station;
  inputs: Partial<Record<ItemId, number>>;
  output: RecipeOutput;
  /** segundos de fabricação (a animação do laser dura isso) */
  seconds: number;
}

export const RECIPES: Recipe[] = [
  {
    id: 'map',
    station: 'workbench',
    inputs: { regolith: 6, iron: 2 },
    output: { kind: 'equip', equip: 'map' },
    seconds: 3.6,
  },
];
