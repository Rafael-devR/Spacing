import { describe, expect, it, vi } from 'vitest';
import { createBus } from '../src/app/events';
import { ITEMS, ITEM_ORDER, type ItemId } from '../src/data/items';
import { PROPS } from '../src/data/props';
import { BLOCK_DATA } from '../src/data/blocks';
import { JITTER, RECIPES, recipeById, recipeSeconds, rollSeconds } from '../src/data/recipes';
import { STATION_ORDER, STATIONS, type StationId } from '../src/data/stations';
import { HAB_MODULE, STATION_FURNITURE } from '../src/data/base';
import { Crafting } from '../src/systems/Crafting';
import { Equipment } from '../src/systems/Equipment';
import { Inventory } from '../src/systems/Inventory';

const MARS: ItemId[] = ['marsdust', 'marsrock', 'darksand', 'sediment', 'volcanic', 'hematite', 'olivine', 'gypsum'];

function setup(items: Partial<Record<ItemId, number>> = {}, rand = () => 0.5) {
  const events = createBus();
  const inventory = new Inventory(events);
  for (const [k, n] of Object.entries(items) as [ItemId, number][]) inventory.add(k, n, false);
  const equipment = new Equipment(events);
  const crafting = new Crafting({ inventory, equipment, events, rand });
  return { events, inventory, equipment, crafting };
}

const r = (id: string) => recipeById(id)!;

describe('receitas como dados', () => {
  it('toda receita usa itens que existem, em estações que existem, com etapas e explicação', () => {
    for (const rec of RECIPES) {
      expect(STATIONS[rec.station], rec.id).toBeDefined();
      for (const k of Object.keys(rec.inputs)) expect(ITEMS[k as ItemId], `${rec.id}: ${k}`).toBeDefined();
      for (const o of rec.outputs) if (o.kind === 'item') expect(ITEMS[o.item], rec.id).toBeDefined();
      expect(rec.outputs.length).toBeGreaterThan(0);
      expect(rec.process.steps.length).toBeGreaterThanOrEqual(3);
      expect(rec.process.note.length).toBeGreaterThan(20);
    }
    expect(new Set(RECIPES.map((x) => x.id)).size).toBe(RECIPES.length);
  });

  it('cada estação tem receitas, um lugar na base e (se não vem pronta) uma receita na bancada', () => {
    for (const id of STATION_ORDER) {
      expect(RECIPES.some((x) => x.station === id), id).toBe(true);
      expect(HAB_MODULE.furniture.some((f) => STATION_FURNITURE[f.kind] === id), id).toBe(true);
      if (!STATIONS[id].builtIn) {
        const build = RECIPES.find((x) => x.outputs.some((o) => o.kind === 'station' && o.station === id));
        expect(build?.station, id).toBe('workbench');
      }
    }
  });

  it('todo item da Lua tem propósito: entra em alguma receita, é colocado no mundo ou é a reserva do traje (O₂)', () => {
    const used = new Set<string>(RECIPES.flatMap((x) => Object.keys(x.inputs)));
    for (const id of ITEM_ORDER) {
      if (MARS.includes(id) || id === 'o2' || ITEMS[id].place) continue;
      expect(used.has(id), id).toBe(true);
    }
    for (const id of ITEM_ORDER) expect(ITEMS[id].about.length, id).toBeGreaterThan(10);
  });

  it('tudo é alcançável a partir do que se minera na Lua', () => {
    const have = new Set<string>(['circuit']); // a placa inicial do módulo de pouso
    for (const b of Object.values(BLOCK_DATA)) if (b.drop && !MARS.includes(b.drop)) have.add(b.drop);
    for (const p of Object.values(PROPS)) {
      if (!MARS.includes(p.drop)) have.add(p.drop);
      for (const k of Object.keys(p.bonus ?? {})) have.add(k);
    }
    const built = new Set<StationId>(STATION_ORDER.filter((s) => STATIONS[s].builtIn));
    const made = new Set<string>();
    for (let changed = true; changed; ) {
      changed = false;
      for (const rec of RECIPES) {
        if (made.has(rec.id) || !built.has(rec.station)) continue;
        if (!Object.keys(rec.inputs).every((k) => have.has(k))) continue;
        made.add(rec.id);
        changed = true;
        for (const o of rec.outputs) {
          if (o.kind === 'item') have.add(o.item);
          if (o.kind === 'station') built.add(o.station);
        }
      }
    }
    expect([...made].sort()).toEqual(RECIPES.map((x) => x.id).sort());
  });

  it('o tempo vem dos ingredientes: forno e eletrolisador em segundos, bancada perto de minuto e meio', () => {
    for (const rec of RECIPES) {
      const s = recipeSeconds(rec);
      if (rec.station === 'furnace') expect(s, rec.id).toBeGreaterThanOrEqual(20);
      if (rec.station === 'furnace') expect(s, rec.id).toBeLessThanOrEqual(70);
      if (rec.station === 'electrolyzer') expect(s, rec.id).toBeGreaterThanOrEqual(30);
      if (rec.station === 'electrolyzer') expect(s, rec.id).toBeLessThanOrEqual(90);
      if (rec.station === 'workbench') expect(s, rec.id).toBeGreaterThanOrEqual(50);
      if (rec.station === 'workbench') expect(s, rec.id).toBeLessThanOrEqual(150);
    }
    // material comum e frio é mais rápido que material raro e quente
    expect(recipeSeconds(r('glass'))).toBeLessThan(recipeSeconds(r('ilmenite')));
    expect(recipeSeconds(r('drill_iron'))).toBeLessThan(recipeSeconds(r('drill_crystal')));
  });

  it('a variação muda o tempo em até ±12%, nunca igual em todo trabalho', () => {
    const rec = r('iron_bar');
    const s = recipeSeconds(rec);
    expect(rollSeconds(rec, 0)).toBeCloseTo(s * (1 - JITTER));
    expect(rollSeconds(rec, 1)).toBeCloseTo(s * (1 + JITTER));
    expect(rollSeconds(rec, 0.5)).toBeCloseTo(s);
  });

  it('a química fecha a conta: 2 H₂O → 2 H₂ + O₂, e a ilmenita devolve a água', () => {
    expect(r('water').inputs).toEqual({ ice: 2 });
    expect(r('water').outputs).toEqual([{ kind: 'item', item: 'h2', n: 2 }, { kind: 'item', item: 'o2', n: 1 }]);
    const ilm = r('ilmenite').outputs.map((o) => (o.kind === 'item' ? o.item : ''));
    expect(ilm).toEqual(['tio2', 'iron_bar', 'ice']);
  });
});

describe('estações trabalhando sozinhas', () => {
  const builtAll = (inventory: Inventory, speed?: (s: StationId) => number) =>
    new Crafting({ inventory, equipment: new Equipment(), rand: () => 0.5, speed }, { built: ['furnace', 'electrolyzer'], jobs: [] });

  it('só começa numa estação construída; construir pela bancada libera as receitas dela', () => {
    const { crafting, inventory } = setup({ regolith: 3, rock: 6, iron: 3 });
    expect(crafting.check(r('glass'))).toMatchObject({ ok: false, locked: true });
    expect(crafting.start(r('furnace'))).toBe(true);
    crafting.update(999);
    expect(crafting.isBuilt('furnace')).toBe(false); // pronto, mas ainda na bancada
    crafting.take('workbench');
    expect(crafting.isBuilt('furnace')).toBe(true);
    expect(crafting.check(r('furnace')).owned).toBe(true);
    expect(crafting.check(r('glass')).ok).toBe(true);
    expect(inventory.count('rock')).toBe(0);
  });

  it('lote: põe todos os minérios de uma vez, sai tudo junto e o preparo conta uma vez só', () => {
    const { inventory } = setup({ iron: 10 });
    const c = builtAll(inventory);
    expect(c.maxBatch(r('iron_bar'))).toBe(5);
    expect(c.check(r('iron_bar'), 6).ok).toBe(false);
    expect(c.start(r('iron_bar'), 5)).toBe(true);
    expect(inventory.count('iron')).toBe(0);
    const v = c.slots('furnace')[0]!;
    expect(v.batch).toBe(5);
    expect(v.remaining).toBeCloseTo(recipeSeconds(r('iron_bar'), 5));
    // fazer 5 de uma vez é mais rápido que 5 separados
    expect(recipeSeconds(r('iron_bar'), 5)).toBeLessThan(5 * recipeSeconds(r('iron_bar')));
    c.update(999);
    expect(c.take('furnace')?.items).toEqual({ iron_bar: 5 });
    // equipamento e estação: sempre um por vez
    expect(c.maxBatch(r('drill_iron'))).toBeLessThanOrEqual(1);
  });

  it('vagas: o forno faz 3 coisas ao mesmo tempo e divide o calor; quando uma termina, as outras aceleram', () => {
    const { inventory } = setup({ iron: 2, regolith: 7, basalt: 2, ice: 4 });
    const c = builtAll(inventory);
    expect(c.start(r('iron_bar'))).toBe(true);
    expect(c.start(r('glass'))).toBe(true);
    expect(c.start(r('brick'))).toBe(true);
    expect(c.check(r('basalt_fiber'))).toMatchObject({ ok: false, full: true });
    const [a, b] = c.slots('furnace');
    expect(a!.share).toBeCloseTo(1 / 3);
    // com três dividindo, o vidro leva o triplo
    expect(b!.remaining).toBeCloseTo(recipeSeconds(r('glass')) * 3);
    const glass = recipeSeconds(r('glass'));
    c.update(glass * 3);
    expect(c.slots('furnace')[1]!.ready).toBe(true);
    expect(c.slots('furnace')[0]!.share).toBeCloseTo(1 / 2);
    // o eletrolisador é outra estação: não divide nada com o forno
    expect(c.start(r('water'))).toBe(true);
    expect(c.slots('electrolyzer')[0]!.share).toBe(1);
  });

  it('a energia manda no ritmo: metade da energia, metade da velocidade; sem energia, para', () => {
    const { inventory } = setup({ ice: 2 });
    let sp = 0.5;
    const c = builtAll(inventory, () => sp);
    c.start(r('water'));
    const work = c.slots('electrolyzer')[0]!.remaining * sp;
    c.update(work);
    expect(c.slots('electrolyzer')[0]!.progress).toBeCloseTo(0.5);
    sp = 0;
    c.update(1000);
    expect(c.slots('electrolyzer')[0]!.progress).toBeCloseTo(0.5);
    expect(c.slots('electrolyzer')[0]!.remaining).toBe(Infinity);
    expect(c.working('electrolyzer')).toBe(true);
  });

  it('mostra a etapa atual e o tempo que falta; avisa uma vez quando fica pronto', () => {
    const { crafting, events } = setup({ silicon: 1, gold: 1 });
    const ready = vi.fn();
    events.on('craft:ready', ready);
    crafting.start(r('circuit'));
    const d = crafting.slots('workbench')[0]!.remaining;
    crafting.update(d * 0.6);
    const v = crafting.slots('workbench')[0]!;
    expect(v.step).toBe(2);
    expect(v.remaining).toBeCloseTo(d * 0.4);
    crafting.update(d);
    crafting.update(5);
    expect(ready).toHaveBeenCalledOnce();
    expect(crafting.take('workbench')?.items).toEqual({ circuit: 1 });
  });

  it('com o inventário cheio, o que não cabe fica esperando na estação', () => {
    const { inventory } = setup({ ice: 2 });
    const c = builtAll(inventory);
    c.start(r('water'));
    c.update(999);
    // enche todos os espaços menos um com outra coisa: só cabe uma pilha de H₂, o O₂ espera
    const free = inventory.room('rock');
    inventory.add('rock', free - 64, false);
    const first = c.take('electrolyzer')!;
    expect(first.partial).toBe(true);
    expect(first.items).toEqual({ h2: 2 });
    expect(c.busy('electrolyzer')).toBe(true);
    inventory.remove('rock', 64);
    const second = c.take('electrolyzer')!;
    expect(second).toMatchObject({ partial: false, items: { o2: 1 } });
    expect(c.busy('electrolyzer')).toBe(false);
  });

  it('salva no meio do trabalho e continua de onde parou; vaga ou receita inválida é descartada', () => {
    const { inventory, equipment } = setup({ iron: 6 });
    const c = new Crafting({ inventory, equipment, rand: () => 0.5 }, { built: ['furnace'], jobs: [] });
    c.start(r('iron_bar'), 3);
    c.update(30);
    const back = new Crafting({ inventory, equipment }, c.serialize());
    const v = back.slots('furnace')[0]!;
    expect(v.recipe.id).toBe('iron_bar');
    expect(v.batch).toBe(3);
    expect(recipeSeconds(r('iron_bar'), 3) - v.remaining).toBeCloseTo(30, 0);
    const bad = new Crafting(
      { inventory, equipment },
      {
        built: ['furnace'],
        jobs: [
          { station: 'furnace', slot: 0, recipe: 'map', batch: 1, work: 2, done: 1 },
          { station: 'furnace', slot: 7, recipe: 'glass', batch: 1, work: 2, done: 1 },
        ],
      },
    );
    expect(bad.busy('furnace')).toBe(false);
    const left = new Crafting(
      { inventory, equipment },
      { built: ['electrolyzer'], jobs: [{ station: 'electrolyzer', slot: 1, recipe: 'water', batch: 1, work: 40, done: 40, left: { o2: 1 }, rest: false }] },
    );
    expect(left.take('electrolyzer')?.items).toEqual({ o2: 1 });
  });
});
