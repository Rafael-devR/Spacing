import { describe, expect, it, vi } from 'vitest';
import { Scene } from 'three';
import { createBus } from '../src/app/events';
import { HULL, AIR } from '../src/data/blocks';
import { HAB_MODULE } from '../src/data/base';
import { RECIPES } from '../src/data/recipes';
import { ITEMS } from '../src/data/items';
import { NEEDS } from '../src/data/survival';
import { createMaterials } from '../src/render/materials';
import { PropFactory } from '../src/render/models';
import { Crafting } from '../src/systems/Crafting';
import { Equipment } from '../src/systems/Equipment';
import { Inventory } from '../src/systems/Inventory';
import { Survival } from '../src/systems/Survival';
import { Player } from '../src/entities/Player';
import { insideModule, layoutModule } from '../src/world/baseLayout';
import { World } from '../src/world/World';

function worldWithBase() {
  const mats = createMaterials();
  const world = new World(new Scene(), 20261111, mats.terrain, new PropFactory(mats.props));
  const layout = layoutModule(HAB_MODULE, world.terrain);
  world.addStructure(layout.structure);
  world.radius = 2;
  world.update(layout.center.x, layout.center.z, 999, 0);
  return { world, layout };
}

describe('base: estrutura no mundo', () => {
  it('piso acima do terreno, paredes e telhado sólidos, interior livre', () => {
    const { world, layout } = worldWithBase();
    const b = layout.structure.box;
    for (let x = b.x0; x <= b.x1; x++)
      for (let z = b.z0; z <= b.z1; z++) expect(world.terrain.column(x, z).h).toBeLessThan(layout.floorY);
    const c = layout.center;
    expect(world.getBlock(Math.floor(c.x), layout.floorY, Math.floor(c.z))).toBe(HULL);
    expect(world.getBlock(Math.floor(c.x), layout.floorY + 1, Math.floor(c.z))).toBe(AIR);
    expect(world.getBlock(b.x0, layout.floorY + 1, b.z0 + 2)).toBe(HULL);
    expect(world.getBlock(Math.floor(c.x), b.y1, Math.floor(c.z))).toBe(HULL);
  });

  it('porta: fechada é parede, aberta deixa passar', () => {
    const { world, layout } = worldWithBase();
    const { x, z } = layout.door;
    expect(world.isSolid(x, layout.floorY + 1, z)).toBe(true);
    layout.structure.doorOpen = true;
    expect(world.isSolid(x, layout.floorY + 1, z)).toBe(false);
    expect(world.isSolid(x, layout.floorY + 2, z)).toBe(false);
  });

  it('corte: telhado e paredes altas deixam a mira passar, mas continuam sólidos', () => {
    const { world, layout } = worldWithBase();
    const c = layout.center,
      top = layout.structure.box.y1;
    layout.structure.cutaway = true;
    expect(world.peekBlock(Math.floor(c.x), top, Math.floor(c.z))).toBe(AIR);
    expect(world.getBlock(Math.floor(c.x), top, Math.floor(c.z))).toBe(HULL);
  });

  it('a base não é editável e não tem pedras soltas dentro', () => {
    const { world, layout } = worldWithBase();
    const c = layout.center;
    expect(world.setBlock(Math.floor(c.x), layout.floorY + 1, Math.floor(c.z), 3)).toBe(false);
    expect(
      world.propMeshes.some((m) => layout.structure.coversColumn(m.userData.prop.wx, m.userData.prop.wz)),
    ).toBe(false);
  });

  it('o astronauta anda por dentro e a parede segura', () => {
    const { world, layout } = worldWithBase();
    const player = new Player(new Scene(), world);
    player.pos.set(layout.center.x, layout.floorY + 1.01, layout.center.z);
    expect(insideModule(layout, player.pos)).toBe(true);
    const rig = { forward: () => ({ x: 0, y: 0, z: -1 }), right: () => ({ x: 1, y: 0, z: 0 }) } as never;
    const input = { moveX: 1, moveY: 0, jump: false };
    for (let i = 0; i < 60 * 4; i++) player.step(1 / 60, input, rig);
    expect(player.pos.x).toBeLessThan(layout.structure.box.x1);
    expect(insideModule(layout, player.pos)).toBe(true);
  });

  it('pontos de uso dos móveis ficam no piso livre, dentro do módulo', () => {
    const { world, layout } = worldWithBase();
    // móveis com ação (o armário e o console são decoração por enquanto)
    for (const f of layout.furniture.filter((m) => m.def.kind === 'workbench' || m.def.kind === 'bed')) {
      expect(insideModule(layout, f.use)).toBe(true);
      expect(world.isSolid(Math.floor(f.use.x), layout.floorY + 1, Math.floor(f.use.z))).toBe(false);
    }
    expect(insideModule(layout, layout.inside)).toBe(true);
    expect(insideModule(layout, layout.outside)).toBe(false);
  });
});

describe('fabricação e equipamento', () => {
  function setup() {
    const events = createBus();
    const inventory = new Inventory(events);
    const equipment = new Equipment(events);
    const crafting = new Crafting({ inventory, equipment, events });
    const map = RECIPES.find((r) => r.id === 'map')!;
    return { events, inventory, equipment, crafting, map };
  }

  it('sem materiais não fabrica e diz o que falta', () => {
    const { crafting, map, inventory } = setup();
    inventory.add('glass', 1, false);
    const c = crafting.check(map);
    expect(c.ok).toBe(false);
    expect(c.missing).toEqual([
      { item: 'circuit', missing: 1 },
      { item: 'iron_bar', missing: 1 },
    ]);
    expect(crafting.start(map)).toBe(false);
  });

  it('o mapa gasta os materiais na hora, fica pronto na bancada e só equipa ao pegar', () => {
    const { crafting, map, inventory, equipment, events } = setup();
    const ready = vi.fn();
    events.on('craft:ready', ready);
    inventory.add('circuit', 1, false);
    inventory.add('glass', 2, false);
    inventory.add('iron_bar', 1, false);
    expect(crafting.start(map)).toBe(true);
    expect(inventory.totals()).toEqual({ glass: 1 });
    expect(crafting.check(map).full).toBe(true);
    const time = crafting.slots('workbench')[0]!.remaining;
    crafting.update(time / 2);
    expect(crafting.slots('workbench')[0]!.ready).toBe(false);
    crafting.update(time);
    expect(ready).toHaveBeenCalledOnce();
    expect(equipment.has('map')).toBe(false);
    expect(crafting.take('workbench')).not.toBeNull();
    expect(equipment.has('map')).toBe(true);
    expect(crafting.busy('workbench')).toBe(false);
    expect(inventory.totals()).toEqual({ glass: 1 });
  });

  it('equipamento que já tem não fabrica de novo', () => {
    const { crafting, map, inventory, equipment } = setup();
    equipment.equip('map');
    inventory.add('circuit', 1, false);
    inventory.add('glass', 1, false);
    inventory.add('iron_bar', 1, false);
    expect(crafting.check(map)).toMatchObject({ ok: false, owned: true });
  });

  it('o salvamento do equipamento volta igual e ignora lixo', () => {
    const a = new Equipment();
    a.equip('map');
    expect(new Equipment(undefined, a.serialize()).has('map')).toBe(true);
    expect(new Equipment(undefined, { map: 'nada' as never }).has('map')).toBe(false);
  });
});

describe('sobrevivência na base', () => {
  function survival(sheltered: boolean) {
    const events = createBus();
    const s = new Survival({
      events,
      position: () => ({ x: 50, y: 18, z: 50 }),
      pressureCenter: () => ({ x: 0, y: 18, z: 0 }),
      moving: () => true,
      mining: () => false,
      sheltered: () => sheltered,
    });
    return { s, events };
  }

  it('dentro da base recarrega e meteoro não machuca', () => {
    const { s, events } = survival(true);
    s.o2 = 20;
    for (let i = 0; i < 60; i++) s.step(1 / 60);
    expect(s.o2).toBeGreaterThan(40);
    events.emit('meteor:impact', { id: 0, x: 0, y: 0, z: 0, distance: 0, meteorite: false, radius: 2 });
    expect(s.integrity).toBe(100);
  });

  it('descansar enche o traje', () => {
    const { s } = survival(false);
    s.o2 = 10;
    s.battery = 5;
    s.integrity = 30;
    s.rest();
    expect([s.o2, s.battery, s.integrity]).toEqual([100, 100, 100]);
  });

  it('energia e fome ainda desligadas: nada gasta e nada é comida', () => {
    expect(NEEDS.energy.enabled).toBe(false);
    const { s } = survival(false);
    for (let i = 0; i < 600; i++) s.step(1 / 60);
    expect(s.energy).toBe(NEEDS.energy.max);
    expect(Object.values(ITEMS).some((d) => d.food)).toBe(false);
    expect(s.eat('regolith')).toBe(false);
    expect(s.serialize().energy).toBeUndefined();
  });
});
