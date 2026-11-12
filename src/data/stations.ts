// Estações de fabricação da base (docs/design/CRAFTING.md). Cada estação é um móvel (data/base.ts) que
// trabalha sozinha: o jogador começa a receita, sai, e volta para pegar. Várias receitas podem trabalhar ao mesmo
// tempo (vagas), dividindo a energia; a energia vem de algum lugar (docs/design/ENERGIA.md). Nova estação = uma entrada aqui,
// um móvel em base.ts, um modelo em render/stationModels.ts e receitas em recipes.ts.

export type StationId = 'workbench' | 'furnace' | 'electrolyzer';

export interface StationData {
  id: StationId;
  name: string;
  /** o que ela faz, em uma linha (cabeçalho da tela) */
  tagline: string;
  /** cor de destaque da tela e das luzes */
  accent: string;
  /** como a câmara aparece no diagrama da tela */
  chamber: 'laser' | 'heat' | 'cell';
  /** segundos fixos de cada trabalho (preparar e terminar), com energia cheia */
  base: number;
  /** segundos por ponto de trabalho dos ingredientes (ver `recipeSeconds`) */
  perWork: number;
  /** quantos trabalhos cabem ao mesmo tempo (cadinhos, células); a energia é dividida entre os que estão trabalhando */
  slots: number;
  /** de onde vem a energia: `grid` = eletricidade da base (painéis e bateria); `sun` = sol concentrado pelos espelhos */
  energy: 'grid' | 'sun';
  /** consumo de eletricidade trabalhando (kW), qualquer que seja o número de trabalhos */
  kw: number;
  /** o nome da energia na tela */
  energyName: string;
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
    slots: 1,
    energy: 'grid',
    kw: 1.2,
    energyName: 'Eletricidade',
    builtIn: true,
  },
  furnace: {
    id: 'furnace',
    name: 'Forno solar',
    tagline: 'Espelhos no telhado concentram o sol: funde, sinteriza e reduz minérios. Três cadinhos dividem o calor.',
    accent: '#ff8a3d',
    chamber: 'heat',
    base: 14,
    perWork: 3.2,
    slots: 3,
    energy: 'sun',
    kw: 0.15,
    energyName: 'Sol concentrado',
  },
  electrolyzer: {
    id: 'electrolyzer',
    name: 'Eletrolisador',
    tagline: 'Eletricidade quebra moléculas: água em H₂ e O₂, óxidos em metal e oxigênio. Duas células dividem a corrente.',
    accent: '#5fd0ff',
    chamber: 'cell',
    base: 18,
    perWork: 4,
    slots: 2,
    energy: 'grid',
    kw: 2.4,
    energyName: 'Eletricidade',
  },
};

export const STATION_ORDER: StationId[] = ['workbench', 'furnace', 'electrolyzer'];

export function isStationId(v: unknown): v is StationId {
  return typeof v === 'string' && v in STATIONS;
}
