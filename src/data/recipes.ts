// Receitas das estações (docs/design/CRAFTING.md). A química é a de verdade (ISRU: viver do que a Lua tem);
// a ficção fica no cristal lunar. Acrescentar uma receita = uma entrada aqui; a estação lista todas.
// O tempo não é fixo: sai do que entra (calor, peso e raridade de cada item, data/items.ts) e varia um
// pouco a cada vez (`JITTER`).
import type { EquipId } from './equipment';
import { ITEMS, type ItemId } from './items';
import { STATIONS, type StationId } from './stations';

/** onde a receita é feita */
export type Station = StationId;

export type RecipeOutput =
  | { kind: 'item'; item: ItemId; n: number }
  | { kind: 'equip'; equip: EquipId }
  /** uma estação nova para a base (a bancada imprime as peças e a máquina aparece no lugar dela) */
  | { kind: 'station'; station: StationId };

export interface RecipeProcess {
  /** fórmula química ou resumo do processo, em uma linha */
  reaction: string;
  /** etapas mostradas na tela, na ordem (cada uma ocupa uma parte igual do tempo) */
  steps: string[];
  /** por que isso funciona (fato real), em uma ou duas frases */
  note: string;
  /** temperatura do processo (°C), para a tela mostrar a cor do calor */
  temp?: number;
}

export interface Recipe {
  id: string;
  station: Station;
  inputs: Partial<Record<ItemId, number>>;
  outputs: RecipeOutput[];
  process: RecipeProcess;
  /** multiplica o trabalho dos ingredientes (processos químicos lentos); padrão 1 */
  effort?: number;
}

/** variação do tempo a cada fabricação: ±12% */
export const JITTER = 0.12;

/** pontos de trabalho de uma unidade do item: 1 + calor, peso e raridade */
export function itemWork(item: ItemId): number {
  const t = ITEMS[item].traits;
  return 1 + 0.6 * t.heat + 0.4 * t.mass + 0.8 * t.rarity;
}

/** segundos de uma unidade (uma vez a receita), com energia cheia e a estação só com ela, sem o preparo */
export function unitSeconds(r: Recipe): number {
  const st = STATIONS[r.station];
  let work = 0;
  for (const [item, n] of Object.entries(r.inputs) as [ItemId, number][]) work += n * itemWork(item);
  return st.perWork * work * (r.effort ?? 1);
}

/**
 * Segundos esperados da receita feita `batch` vezes de uma vez (sem a variação): o preparo conta uma vez só e
 * depois sai uma unidade a cada `unitSeconds`. Fazer em lote rende mais que fazer um por um.
 */
export function recipeSeconds(r: Recipe, batch = 1): number {
  return Math.round((STATIONS[r.station].base + unitSeconds(r) * batch) * 10) / 10;
}

/** preparo e tempo por unidade de uma fabricação, com a variação; `u` de 0 a 1 (sorteado pelo sistema) */
export function rollTimes(r: Recipe, u: number): { prep: number; unit: number } {
  const k = 1 + (u * 2 - 1) * JITTER;
  return { prep: STATIONS[r.station].base * k, unit: unitSeconds(r) * k };
}

/** lote máximo de uma vez (receitas de equipamento e de estação: sempre 1) */
export const MAX_BATCH = 32;

/** a receita pode ser feita em lote (só as que dão itens) */
export function batchable(r: Recipe): boolean {
  return r.outputs.every((o) => o.kind === 'item');
}

const item = (i: ItemId, n = 1): RecipeOutput => ({ kind: 'item', item: i, n });

export const RECIPES: Recipe[] = [
  // ---------- bancada ----------
  {
    id: 'furnace',
    station: 'workbench',
    inputs: { rock: 6, iron: 3 },
    outputs: [{ kind: 'station', station: 'furnace' }],
    process: {
      reaction: 'rocha (câmara) + ferro (espelhos e suporte)',
      steps: ['Cortar blocos', 'Montar câmara', 'Alinhar espelhos', 'Testar foco'],
      note: 'Fornos solares de regolito são testados de verdade pela ESA: espelhos concentram a luz até passar de 1000 °C.',
    },
  },
  {
    id: 'electrolyzer',
    station: 'workbench',
    inputs: { iron_bar: 4, glass: 2, brick: 2 },
    outputs: [{ kind: 'station', station: 'electrolyzer' }],
    process: {
      reaction: 'eletrodos de ferro + cuba de vidro + base de tijolo',
      steps: ['Imprimir eletrodos', 'Selar cuba', 'Ligar tanques', 'Teste de pressão'],
      note: 'O eletrolisador separa o gás de cada eletrodo em um tanque: o de hidrogênio é o dobro do de oxigênio (2 H₂ para 1 O₂).',
    },
  },
  {
    id: 'map',
    station: 'workbench',
    inputs: { circuit: 1, glass: 1, iron_bar: 1 },
    outputs: [{ kind: 'equip', equip: 'map' }],
    process: {
      reaction: 'placa de circuito + tela de vidro + carcaça de ferro',
      steps: ['Carcaça', 'Soldar placa', 'Colar tela', 'Calibrar sonda'],
      note: 'O tablet lê a sonda do módulo de pouso e desenha o terreno que você já percorreu.',
    },
  },
  {
    id: 'circuit',
    station: 'workbench',
    inputs: { silicon: 1, gold: 1 },
    outputs: [item('circuit')],
    process: {
      reaction: 'pastilha de Si + trilhas e contatos de Au',
      steps: ['Gravar trilhas', 'Depositar ouro', 'Encapsular', 'Testar'],
      note: 'O ouro não oxida: por isso os contatos de conectores espaciais são dourados.',
    },
  },
  {
    id: 'solar_panel',
    station: 'workbench',
    inputs: { silicon: 2, glass: 1, iron_bar: 1 },
    outputs: [item('solar_panel')],
    process: {
      reaction: 'células de Si + vidro + moldura de ferro',
      steps: ['Cortar células', 'Ligar células', 'Cobrir com vidro', 'Moldura'],
      note: 'A luz arranca elétrons do silício e cria corrente. No polo sul da Lua há picos quase sempre iluminados: os melhores lugares para painéis.',
    },
  },
  {
    id: 'planter',
    station: 'workbench',
    inputs: { brick: 3, iron_bar: 1 },
    outputs: [item('planter')],
    process: {
      reaction: 'tijolo (caixa) + ferro (moldura e dreno)',
      steps: ['Moldar caixa', 'Furar dreno', 'Moldura', 'Vedar'],
      note: 'Na ISS as plantas crescem em travesseiros de substrato com água controlada (experimento Veggie, da NASA).',
    },
  },
  {
    id: 'soil',
    station: 'workbench',
    inputs: { regolith: 3, ice: 1 },
    outputs: [item('soil')],
    process: {
      reaction: 'regolito moído + água + nutrientes do kit',
      steps: ['Moer', 'Peneirar', 'Molhar', 'Misturar'],
      note: 'Em 2022 cientistas plantaram em regolito trazido pela Apollo: as plantas cresceram, mas fracas. Precisa de nutrientes e de solo solto.',
    },
  },
  {
    id: 'soil_mars',
    station: 'workbench',
    inputs: { marsdust: 3, ice: 1 },
    outputs: [item('soil')],
    process: {
      reaction: 'poeira marciana lavada (sem perclorato) + água + nutrientes',
      steps: ['Lavar', 'Secar', 'Peneirar', 'Misturar'],
      note: 'O solo de Marte tem percloratos tóxicos; lavar com água tira boa parte deles antes de plantar.',
    },
  },
  {
    id: 'drill_iron',
    station: 'workbench',
    inputs: { iron_bar: 4, brick: 2 },
    outputs: [{ kind: 'equip', equip: 'drill_iron' }],
    process: {
      reaction: 'ponta de ferro temperado + corpo de tijolo',
      steps: ['Forjar ponta', 'Temperar', 'Montar corpo', 'Balancear'],
      note: 'Temperar (esquentar e esfriar rápido) deixa o ferro mais duro na ponta.',
    },
  },
  {
    id: 'drill_crystal',
    station: 'workbench',
    inputs: { crystal: 4, titanium: 2, basalt_fiber: 2 },
    outputs: [{ kind: 'equip', equip: 'drill_crystal' }],
    process: {
      reaction: 'ponta de cristal + eixo de titânio + reforço de fibra',
      steps: ['Usinar eixo', 'Engastar cristais', 'Enrolar fibra', 'Sintonizar'],
      note: 'O titânio aguenta a vibração sem quebrar; a fibra de basalto segura o calor do corte.',
    },
  },

  // ---------- forno solar ----------
  {
    id: 'iron_bar',
    station: 'furnace',
    inputs: { iron: 2 },
    outputs: [item('iron_bar')],
    process: {
      reaction: 'minério → Fe (líquido) + escória',
      steps: ['Aquecer', 'Fundir a 1540 °C', 'Separar escória', 'Moldar barra'],
      note: 'O ferro funde a 1538 °C. A escória (silicatos) é mais leve: boia e é tirada por cima.',
      temp: 1560,
    },
  },
  {
    id: 'brick',
    station: 'furnace',
    inputs: { regolith: 4 },
    outputs: [item('brick', 2)],
    process: {
      reaction: 'regolito → grãos soldados (sinterização)',
      steps: ['Compactar', 'Aquecer a 1100 °C', 'Sinterizar', 'Resfriar'],
      note: 'Na sinterização os grãos se soldam sem derreter. A ESA já imprimiu tijolos assim com regolito simulado.',
      temp: 1120,
    },
  },
  {
    id: 'glass',
    station: 'furnace',
    inputs: { regolith: 3 },
    outputs: [item('glass')],
    process: {
      reaction: 'SiO₂ + óxidos → vidro',
      steps: ['Aquecer', 'Fundir a 1400 °C', 'Laminar', 'Resfriar rápido'],
      note: 'Resfriado rápido, o regolito fundido não cristaliza e vira vidro. A Apollo 17 achou contas de vidro vulcânico laranja na Lua.',
      temp: 1420,
    },
  },
  {
    id: 'glass_anorthosite',
    station: 'furnace',
    inputs: { anorthosite: 2 },
    outputs: [item('glass')],
    process: {
      reaction: 'CaAl₂Si₂O₈ → vidro',
      steps: ['Aquecer', 'Fundir a 1550 °C', 'Laminar', 'Resfriar rápido'],
      note: 'O anortosito das terras altas é quase só plagioclásio: funde num vidro claro, com pouco ferro. É o material estudado para fibra e janelas na Lua.',
      temp: 1550,
    },
  },
  {
    id: 'basalt_fiber',
    station: 'furnace',
    inputs: { basalt: 2 },
    outputs: [item('basalt_fiber')],
    process: {
      reaction: 'basalto fundido → fios de 10 µm',
      steps: ['Fundir a 1450 °C', 'Passar no bico', 'Estirar', 'Enrolar'],
      note: 'Fibra de basalto é fabricada na Terra igual: rocha fundida passa por bicos e é puxada em fios.',
      temp: 1460,
    },
  },
  {
    id: 'ilmenite',
    station: 'furnace',
    inputs: { ilmenite: 1, h2: 1 },
    outputs: [item('tio2'), item('iron_bar'), item('ice')],
    effort: 1.4,
    process: {
      reaction: 'FeTiO₃ + H₂ → Fe + TiO₂ + H₂O',
      steps: ['Aquecer a 1000 °C', 'Injetar H₂', 'Reduzir', 'Condensar água'],
      note: 'É o método mais estudado pela NASA para tirar oxigênio da Lua. A água sai como vapor e congela de novo: o hidrogênio volta.',
      temp: 1000,
    },
  },

  // ---------- eletrolisador ----------
  {
    id: 'water',
    station: 'electrolyzer',
    inputs: { ice: 2 },
    outputs: [item('h2', 2), item('o2')],
    process: {
      reaction: '2 H₂O → 2 H₂ + O₂',
      steps: ['Derreter gelo', 'Aplicar corrente', 'Separar gases', 'Comprimir'],
      note: 'O hidrogênio sai no eletrodo negativo e o oxigênio no positivo, sempre na proporção de 2 para 1.',
      temp: 80,
    },
  },
  {
    id: 'titanium',
    station: 'electrolyzer',
    inputs: { tio2: 1 },
    outputs: [item('titanium'), item('o2')],
    effort: 1.6,
    process: {
      reaction: 'TiO₂ → Ti + O₂ (sal fundido a 900 °C)',
      steps: ['Fundir sal', 'Prensar catodo', 'Eletrolisar', 'Lavar metal'],
      note: 'Processo FFC Cambridge: o óxido vira o polo negativo num banho de sal fundido e perde o oxigênio, deixando titânio puro.',
      temp: 900,
    },
  },
  {
    id: 'silicon',
    station: 'electrolyzer',
    inputs: { regolith: 4 },
    outputs: [item('silicon'), item('o2')],
    effort: 1.3,
    process: {
      reaction: 'SiO₂ → Si + O₂ (regolito fundido a 1600 °C)',
      steps: ['Fundir regolito', 'Aplicar corrente', 'Separar silício', 'Cortar pastilha'],
      note: 'Eletrólise de regolito fundido (MRE): a corrente separa metais e silício e solta oxigênio, sem precisar de nada da Terra.',
      temp: 1600,
    },
  },
];

export function recipeById(id: string): Recipe | undefined {
  return RECIPES.find((r) => r.id === id);
}
