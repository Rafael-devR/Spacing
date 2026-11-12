import { describe, expect, it } from 'vitest';
import { Scene, Vector3 } from 'three';
import { createBus } from '../src/app/events';
import { SURVIVAL, SUITS } from '../src/data/survival';
import { ItemDrops } from '../src/entities/ItemDrops';
import { LootPiles } from '../src/entities/LootPiles';
import { Player } from '../src/entities/Player';
import { createMaterials } from '../src/render/materials';
import { ItemModels } from '../src/render/itemModels';
import { PropFactory } from '../src/render/models';
import { STACK_SIZE } from '../src/data/items';
import { Inventory, SLOT_COUNT } from '../src/systems/Inventory';
import { Survival } from '../src/systems/Survival';
import { World } from '../src/world/World';

const STEP = 1 / 60;

function setup(opts: { inside?: boolean; moving?: boolean; mining?: boolean } = {}) {
  const events = createBus();
  const log: string[] = [];
  events.on('suit:warning', (w) => log.push(`warn:${w.meter}:${w.level}`));
  events.on('suit:asphyxia', (a) => log.push(`asphyxia:${a.on}`));
  events.on('player:died', (d) => log.push(`died:${d.cause}`));
  events.on('player:damaged', (d) => log.push(`damaged:${d.cause}:${Math.round(d.amount)}`));
  const state = { inside: opts.inside ?? false, moving: opts.moving ?? true, mining: opts.mining ?? false };
  const s = new Survival({
    events,
    position: () => (state.inside ? { x: 0, y: 18, z: 0 } : { x: 50, y: 18, z: 50 }),
    pressureCenter: () => ({ x: 0, y: 18, z: 0 }),
    moving: () => state.moving,
    mining: () => state.mining,
  });
  const run = (seconds: number): void => {
    for (let i = 0; i < Math.round(seconds / STEP); i++) s.step(STEP);
  };
  return { s, events, log, state, run };
}

describe('Survival no teste de desempenho', () => {
  it('imortal: nenhum dano mata, nem a asfixia', () => {
    const { s, log, run } = setup();
    s.immortal = true;
    s.damage(500, 'meteor');
    s.o2 = 0;
    run(60);
    expect(s.dead).toBe(false);
    expect(s.integrity).toBe(100);
    expect(log.some((l) => l.startsWith('died'))).toBe(false);
  });
});

describe('Survival', () => {
  it('o tanque do traje básico dura 8 minutos andando', () => {
    const { s, run } = setup();
    run(SUITS.emergency.o2Seconds / 2);
    expect(s.o2).toBeCloseTo(50, 0);
  });

  it('parado gasta menos e minerando gasta mais, e a furadeira gasta bateria', () => {
    const idle = setup({ moving: false });
    const mining = setup({ mining: true });
    idle.run(60);
    mining.run(60);
    expect(idle.s.o2).toBeGreaterThan(mining.s.o2);
    expect(mining.s.battery).toBeCloseTo(100 - SUITS.emergency.drillDrain * 60, 0);
    expect(idle.s.battery).toBe(100);
  });

  it('sem bateria a furadeira fica lenta', () => {
    const { s } = setup();
    expect(s.drillRate()).toBe(1);
    s.battery = 0;
    expect(s.drillRate()).toBeCloseTo(SURVIVAL.noBatteryDrillRate);
  });

  it('a área pressurizada recarrega tudo', () => {
    const { s, run } = setup({ inside: true });
    s.o2 = 10;
    s.battery = 0;
    s.integrity = 50;
    run(5);
    expect(s.o2).toBe(100);
    expect(s.battery).toBeGreaterThan(70);
    expect(s.integrity).toBeCloseTo(75, 5);
  });

  it('avisa uma vez em 30% e uma vez em 15% de oxigênio', () => {
    const { s, log, run } = setup();
    s.o2 = 31;
    run(90); // 31% → abaixo de 15% andando
    expect(log.filter((l) => l === 'warn:o2:1')).toHaveLength(1);
    expect(log.filter((l) => l === 'warn:o2:2')).toHaveLength(1);
  });

  it('sem oxigênio a integridade cai e o astronauta morre uma vez só', () => {
    const { s, log, run } = setup();
    s.o2 = 0.01;
    run(100 / SURVIVAL.asphyxiaDps + 2);
    expect(s.dead).toBe(true);
    expect(log).toContain('asphyxia:true');
    expect(log.filter((l) => l.startsWith('died'))).toEqual(['died:asphyxia']);
    // asfixia é dano contínuo: não gera um "player:damaged" por passo
    expect(log.some((l) => l.startsWith('damaged'))).toBe(false);
  });

  it('meteoro perto machuca conforme a distância, longe não', () => {
    const { s, events } = setup();
    events.emit('meteor:impact', { id: 0, x: 0, y: 0, z: 0, distance: 20, meteorite: false, radius: 2 });
    expect(s.integrity).toBe(100);
    events.emit('meteor:impact', { id: 0, x: 0, y: 0, z: 0, distance: 3.5, meteorite: false, radius: 2 });
    expect(s.integrity).toBeCloseTo(100 - SURVIVAL.meteorMaxDamage * 0.5);
  });

  it('queda forte machuca, queda normal não', () => {
    const { s, events } = setup();
    events.emit('player:land', { x: 0, y: 0, z: 0, speed: 10 });
    expect(s.integrity).toBe(100);
    events.emit('player:land', { x: 0, y: 0, z: 0, speed: 18 });
    expect(s.integrity).toBe(100 - 4 * SURVIVAL.fallDamagePerSpeed);
  });

  it('renascer enche o traje e dá alguns segundos sem dano', () => {
    const { s, events, run } = setup();
    s.damage(500, 'meteor');
    expect(s.dead).toBe(true);
    s.respawn();
    expect([s.o2, s.battery, s.integrity, s.dead]).toEqual([100, 100, 100, false]);
    events.emit('meteor:impact', { id: 0, x: 0, y: 0, z: 0, distance: 0, meteorite: false, radius: 2 });
    expect(s.integrity).toBe(100);
    run(SURVIVAL.respawnInvulnerable + 0.1);
    events.emit('meteor:impact', { id: 0, x: 0, y: 0, z: 0, distance: 0, meteorite: false, radius: 2 });
    expect(s.integrity).toBeLessThan(100);
  });
});

describe('itens caídos na morte', () => {
  function lootSetup() {
    const scene = new Scene();
    const mats = createMaterials();
    const props = new PropFactory(mats.props);
    const world = new World(scene, 20261111, mats.terrain, props);
    world.radius = 1;
    world.update(0, 0, 99, 0);
    const inventory = new Inventory();
    const models = new ItemModels(mats, props);
    const drops = new ItemDrops(scene, models, inventory);
    const loot = new LootPiles(scene, models, world, drops);
    const player = new Player(scene, world);
    player.spawn(1, 1);
    return { world, inventory, drops, loot, player };
  }

  it('divide em no máximo 4 pedaços por item sem perder nada', () => {
    const { loot, player } = lootSetup();
    loot.drop(player.pos.clone(), { regolith: 57, gold: 2 });
    expect(loot.count).toBe(4 + 2);
    expect(loot.totals()).toEqual({ regolith: 57, gold: 2 });
  });

  it('o salvamento devolve exatamente os mesmos itens', () => {
    const a = lootSetup();
    a.loot.drop(new Vector3(30, 20, 30), { iron: 5, ice: 1 });
    const b = lootSetup();
    b.loot.load(JSON.parse(JSON.stringify(a.loot.serialize())));
    expect(b.loot.totals()).toEqual({ iron: 5, ice: 1 });
  });

  it('passar por cima recolhe tudo de volta para o inventário', () => {
    const { loot, player, drops, inventory } = lootSetup();
    loot.drop(player.pos.clone(), { rock: 9, crystal: 3 });
    for (let i = 0; i < 60 * 8; i++) {
      // anda até o próximo pedaço, como o jogador faria
      const next = loot.serialize()[0];
      if (next) player.pos.set(next.x, player.pos.y, next.z);
      loot.update(STEP, i * STEP, player);
      drops.update(STEP, player);
    }
    expect(loot.count).toBe(0);
    expect(inventory.totals()).toEqual({ rock: 9, crystal: 3 });
  });

  it('mochila cheia: o item fica no chão até ter espaço', () => {
    const { loot, player, drops, inventory } = lootSetup();
    loot.canTake = (item, n) => inventory.canAdd(item, n);
    drops.onOverflow = (item, n, at) => loot.drop(at.clone(), { [item]: n });
    for (let i = 0; i < SLOT_COUNT; i++) inventory.add('rock', STACK_SIZE);
    const walk = (seconds: number): void => {
      for (let i = 0; i < 60 * seconds; i++) {
        const next = loot.serialize()[0];
        if (next) player.pos.set(next.x, player.pos.y, next.z);
        loot.update(STEP, i * STEP, player);
        drops.update(STEP, player);
      }
    };
    // um minério minerado com a mochila cheia: chega voando, não cabe e volta para o chão
    drops.spawn('gold', player.pos.clone(), 1);
    walk(4);
    expect(inventory.count('gold')).toBe(0);
    expect(loot.totals()).toEqual({ gold: 1 });
    // abriu espaço: passar por cima recolhe
    inventory.remove('rock', STACK_SIZE);
    walk(4);
    expect(inventory.count('gold')).toBe(1);
    expect(loot.count).toBe(0);
  });
});
