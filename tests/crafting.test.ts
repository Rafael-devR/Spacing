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

  it('todo item da Lua tem propósito: entra em alguma receita (o O₂ é a reserva do traje)', () => {
    const used = new Set<string>(RECIPES.flatMap((x) => Object.keys(x.inputs)));
    for (const id of ITEM_ORDER) {
      if (MARS.includes(id) || id === 'o2') continue;
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

  it('cada estação faz uma coisa por vez, e as estações trabalham juntas', () => {
    const { crafting, inventory } = setup({ iron: 4, ice: 4, regolith: 8 });
    const saved = crafting.serialize();
    const all = new Crafting({ inventory, equipment: new Equipment(), rand: () => 0.5 }, { ...saved, built: ['furnace', 'electrolyzer'] });
    expect(all.start(r('iron_bar'))).toBe(true);
    expect(all.check(r('glass'))).toMatchObject({ ok: false, busy: true });
    expect(all.start(r('water'))).toBe(true);
    all.update(recipeSeconds(r('iron_bar')) + 1);
    expect(all.job('furnace')?.ready).toBe(true);
    expect(all.job('electrolyzer')?.ready).toBe(recipeSeconds(r('water')) <= recipeSeconds(r('iron_bar')) + 1);
    expect(all.activeJobs().map((j) => j.station)).toEqual(['furnace', 'electrolyzer']);
  });

  it('mostra a etapa atual e o tempo que falta; avisa uma vez quando fica pronto', () => {
    const { crafting, events } = setup({ silicon: 1, gold: 1 });
    const ready = vi.fn();
    events.on('craft:ready', ready);
    crafting.start(r('circuit'));
    const d = crafting.job('workbench')!.duration;
    crafting.update(d * 0.6);
    const v = crafting.job('workbench')!;
    expect(v.step).toBe(2);
    expect(v.remaining).toBeCloseTo(d * 0.4);
    crafting.update(d);
    crafting.update(5);
    expect(ready).toHaveBeenCalledOnce();
    expect(crafting.take('workbench')?.items).toEqual({ circuit: 1 });
  });

  it('com o inventário cheio, o que não cabe fica esperando na estação', () => {
    const { inventory } = setup({ ice: 2 });
    const c = new Crafting({ inventory, equipment: new Equipment(), rand: () => 0.5 }, { built: ['electrolyzer'], jobs: [] });
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

  it('salva no meio do trabalho e continua de onde parou; pronto com sobra também volta', () => {
    const { crafting, inventory, equipment } = setup({ rock: 6, iron: 3 });
    crafting.start(r('furnace'));
    crafting.update(30);
    const back = new Crafting({ inventory, equipment }, crafting.serialize());
    expect(back.job('workbench')?.recipe.id).toBe('furnace');
    expect(back.job('workbench')!.duration - back.job('workbench')!.remaining).toBeCloseTo(30, 0);
    const lost = new Crafting({ inventory, equipment }, { built: [], jobs: [{ station: 'furnace', recipe: 'map', t: 1, duration: 2 }] });
    expect(lost.busy('furnace')).toBe(false); // receita de outra estação: descartada
    const left = new Crafting(
      { inventory, equipment },
      { built: ['electrolyzer'], jobs: [{ station: 'electrolyzer', recipe: 'water', t: 40, duration: 40, left: { o2: 1 }, rest: false }] },
    );
    expect(left.take('electrolyzer')?.items).toEqual({ o2: 1 });
  });
});
