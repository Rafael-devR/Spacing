// Estações de fabricação da base (docs/design/CRAFTING.md). Cada estação é um móvel (data/base.ts) que
// trabalha sozinha: o jogador começa a receita, sai, e volta para pegar. Nova estação = uma entrada aqui,
// um móvel em base.ts, um modelo em render/stationModels.ts e receitas em recipes.ts.

export type StationId = 'workbench' | 'furnace' | 'electrolyzer';

/** o que a tela da estação mostra nos medidores ao vivo */
export interface Gauge {
  label: string;
  unit: string;
  /** valor parado e trabalhando (o trabalho usa o da receita, se ela disser) */
  idle: number;
  work: number;
  /** quanto o valor oscila trabalhando (fração) */
  wobble: number;
  /** casas decimais */
  digits?: number;
}

export interface StationData {
  id: StationId;
  name: string;
  /** o que ela faz, em uma linha (cabeçalho da tela) */
  tagline: string;
  /** cor de destaque da tela e das luzes */
  accent: string;
  /** como a câmara aparece no diagrama da tela */
  chamber: 'laser' | 'heat' | 'cell';
  /** segundos fixos de cada trabalho (preparar e terminar) */
  base: number;
  /** segundos por ponto de trabalho dos ingredientes (ver `recipeSeconds`) */
  perWork: number;
  gauges: [Gauge, Gauge];
  /** já vem pronta na base; as outras são fabricadas na bancada */
  builtIn?: boolean;
}

export const STATIONS: Record<StationId, StationData> = {
  workbench: {
    id: 'workbench',
    name: 'Bancada de fabricação',
    tagline: 'Monta peças refinadas em equipamentos e máquinas, camada por camada, com dois lasers.',
    accent: '#7fe7ff',
    chamber: 'laser',
    base: 40,
    perWork: 2.4,
    gauges: [
      { label: 'Laser', unit: 'kW', idle: 0, work: 1.2, wobble: 0.08, digits: 2 },
      { label: 'Bico', unit: '°C', idle: 22, work: 1650, wobble: 0.03 },
    ],
    builtIn: true,
  },
  furnace: {
    id: 'furnace',
    name: 'Forno solar',
    tagline: 'Espelhos no telhado concentram o sol do polo sul: funde, sinteriza e reduz minérios.',
    accent: '#ff8a3d',
    chamber: 'heat',
    base: 14,
    perWork: 3.2,
    gauges: [
      { label: 'Temperatura', unit: '°C', idle: 22, work: 1500, wobble: 0.02 },
      { label: 'Sol concentrado', unit: 'kW', idle: 0, work: 6, wobble: 0.06, digits: 1 },
    ],
  },
  electrolyzer: {
    id: 'electrolyzer',
    name: 'Eletrolisador',
    tagline: 'Corrente elétrica quebra moléculas: água em H₂ e O₂, óxidos em metal e oxigênio.',
    accent: '#5fd0ff',
    chamber: 'cell',
    base: 18,
    perWork: 4,
    gauges: [
      { label: 'Corrente', unit: 'A', idle: 0, work: 120, wobble: 0.05 },
      { label: 'Tensão', unit: 'V', idle: 0, work: 1.8, wobble: 0.04, digits: 2 },
    ],
  },
};

export const STATION_ORDER: StationId[] = ['workbench', 'furnace', 'electrolyzer'];

export function isStationId(v: unknown): v is StationId {
  return typeof v === 'string' && v in STATIONS;
}
