// Objetos soltos no chão (pedras, minérios, meteoritos).
import type { RGB } from '../core/color';
import type { ItemId } from './items';

/** `marsBoulder` e `blueberries` (esferas de hematita) só existem em Marte; `solarPanel` é colocado pelo jogador */
export type PropType = 'boulder' | 'ilmenite' | 'gold' | 'crystal' | 'meteorite' | 'marsBoulder' | 'blueberries' | 'solarPanel';

export const PROP_TYPES: PropType[] = ['boulder', 'ilmenite', 'gold', 'crystal', 'meteorite', 'marsBoulder', 'blueberries', 'solarPanel'];

export interface PropData {
  name: string;
  /** segundos para minerar com a broca inicial */
  hardness: number;
  /** nível mínimo da broca (data/drills.ts); ausente = 0, qualquer broca */
  tier?: number;
  drop: ItemId;
  amount: number;
  /** itens extras além do principal */
  bonus?: Partial<Record<ItemId, number>>;
}

export const PROPS: Record<PropType, PropData> = {
  boulder: { name: 'Pedregulho', hardness: 0.9, drop: 'rock', amount: 2 },
  ilmenite: { name: 'Ilmenita', hardness: 1.3, tier: 1, drop: 'ilmenite', amount: 2 },
  gold: { name: 'Ouro', hardness: 1.6, tier: 2, drop: 'gold', amount: 1 },
  crystal: { name: 'Cristal lunar', hardness: 1.2, tier: 1, drop: 'crystal', amount: 2 },
  meteorite: { name: 'Meteorito', hardness: 2.2, drop: 'crystal', amount: 3, bonus: { gold: 2, iron: 2 } },
  marsBoulder: { name: 'Pedra marciana', hardness: 0.9, drop: 'marsrock', amount: 2 },
  blueberries: { name: 'Esferas de hematita', hardness: 0.5, drop: 'hematite', amount: 2 },
  /** minerar o painel desmonta e devolve o item */
  solarPanel: { name: 'Painel solar', hardness: 0.6, drop: 'solar_panel', amount: 1 },
};

/** cores (lineares) dos destroços de cada objeto */
export const PROP_DEBRIS: Record<PropType, RGB[]> = {
  boulder: [[0.29, 0.26, 0.23]],
  ilmenite: [[0.045, 0.03, 0.022]],
  gold: [
    [0.19, 0.14, 0.07],
    [0.95, 0.5, 0.06],
  ],
  crystal: [
    [0.14, 0.12, 0.18],
    [0.4, 1.2, 1.4],
  ],
  meteorite: [
    [0.03, 0.025, 0.035],
    [2.2, 0.7, 0.15],
    [0.4, 1.2, 1.4],
  ],
  marsBoulder: [[0.27, 0.08, 0.04]],
  blueberries: [
    [0.06, 0.07, 0.1],
    [0.36, 0.1, 0.05],
  ],
  solarPanel: [
    [0.04, 0.08, 0.3],
    [0.5, 0.52, 0.6],
  ],
};
