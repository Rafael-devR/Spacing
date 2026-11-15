// Exportador das regras do jogo para o porte em Rust (docs/design/PORTE_RUST.md, M4).
//
// 1. Os dados (itens, receitas, estações, brocas, energia, sobrevivência, estufa, missões) vão para native/assets/rules.json:
//    o Rust lê os mesmos números em vez de copiá-los à mão. Enquanto a versão web viver, o TS é a fonte.
// 2. Roteiros sorteados (com semente) rodam as regras do TS e gravam em native/golden/rules.json cada operação, o que ela
//    devolveu, o estado depois dela e os eventos publicados. O Rust repete os roteiros e tem de chegar no mesmo lugar
//    (native/spacing-core/tests/rules.rs).
//
//   npm run golden
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import { createBus, type GameBus } from '../../src/app/events';
import { mulberry32 } from '../../src/core/noise';
import { DRILLS, DRILL_ORDER } from '../../src/data/drills';
import { EQUIPMENT, EQUIP_SLOTS, type EquipId } from '../../src/data/equipment';
import { CHEST_LOTS, CHEST_LOT_IDS, FARM, GH, PARTS } from '../../src/data/greenhouse';
import {
  BAG_SIZE,
  HOTBAR_SIZE,
  ITEMS,
  ITEM_ORDER,
  STACK_SIZE,
  stackSize,
  type ItemId,
} from '../../src/data/items';
import { MISSION_01, MISSION_MARS, type MissionStep } from '../../src/data/missions';
import { BASE, BASE_MODULES } from '../../src/data/base';
import { POWER, SUN_DIRECTION } from '../../src/data/power';
import { PROPS, PROP_DEBRIS, PROP_TYPES } from '../../src/data/props';
import { JITTER, MAX_BATCH, RECIPES } from '../../src/data/recipes';
import { STATIONS, STATION_ORDER, type StationId } from '../../src/data/stations';
import { NEEDS, SUITS, SURVIVAL } from '../../src/data/survival';
import { LAVA } from '../../src/data/blocks';
import { Crafting } from '../../src/systems/Crafting';
import { Equipment } from '../../src/systems/Equipment';
import { Greenhouse, anchorAt } from '../../src/systems/Greenhouse';
import { Inventory, SLOT_COUNT } from '../../src/systems/Inventory';
import { Power } from '../../src/systems/Power';
import { Survival } from '../../src/systems/Survival';
import { Missions } from '../../src/systems/Missions';
import { Exploration } from '../../src/systems/Exploration';
import { migrate, renewWorld } from '../../src/core/save';
import { LANDER } from '../../src/world/terrain';
import * as THREE from 'three';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

function write(path: string, data: unknown, compact = false): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, (compact ? JSON.stringify(data) : JSON.stringify(data, null, 1)) + '\n');
}

/** cópia sem referências (o estado muda depois) e sem Infinity (JSON não tem: vira -1) */
function snap<T>(v: T): T {
  return JSON.parse(JSON.stringify(v, (_k, x) => (x === Infinity ? -1 : x)));
}

/** todos os eventos publicados, na ordem */
function recorder(bus: GameBus): [string, unknown][] {
  const log: [string, unknown][] = [];
  const emit = bus.emit.bind(bus);
  bus.emit = ((t: never, p: never) => {
    log.push([t, snap(p)]);
    emit(t, p);
  }) as typeof bus.emit;
  return log;
}

const entries = (c: Partial<Record<string, number>>): [string, number][] =>
  Object.entries(c) as [string, number][];

function exportData(): void {
  const stepOut = (s: MissionStep): unknown => (s.kind === 'deliver' ? { ...s, needs: entries(s.needs) } : s);
  write(join(ROOT, 'native/assets/rules.json'), {
    hotbar: HOTBAR_SIZE,
    bag: BAG_SIZE,
    stack: STACK_SIZE,
    items: ITEM_ORDER.map((id) => {
      const d = ITEMS[id];
      return {
        id,
        name: d.name,
        about: d.about,
        traits: d.traits,
        block: d.block ?? null,
        iconBlock: d.icon?.block ?? null,
        iconProp: d.icon?.prop ?? null,
        model: d.icon?.model ?? null,
        color: d.icon?.color ?? null,
        stack: stackSize(id),
        place: d.place ?? null,
        site: d.site ?? null,
        farm: d.farm ?? null,
        food: d.food?.energy ?? null,
        tint: d.tint,
      };
    }),
    stations: STATION_ORDER.map((id) => ({ ...STATIONS[id], builtIn: STATIONS[id].builtIn ?? false })),
    recipes: RECIPES.map((r) => ({
      id: r.id,
      station: r.station,
      inputs: entries(r.inputs),
      outputs: r.outputs,
      process: r.process,
      effort: r.effort ?? 1,
    })),
    jitter: JITTER,
    maxBatch: MAX_BATCH,
    drills: DRILL_ORDER.map((id) => ({ ...DRILLS[id], glow: DRILLS[id].glow ?? null })),
    equipment: (Object.keys(EQUIPMENT) as EquipId[]).map((id) => ({
      id,
      ...EQUIPMENT[id],
      drill: EQUIPMENT[id].drill ?? null,
    })),
    equipSlots: EQUIP_SLOTS,
    power: POWER,
    sunDirection: SUN_DIRECTION,
    suits: Object.values(SUITS),
    // fallSafeSpeed vem do planeta (planet.rs)
    survival: { ...SURVIVAL, fallSafeSpeed: undefined },
    needs: NEEDS,
    greenhouse: {
      ...GH,
      parts: PARTS.map((p) => ({ ...p, cost: entries(p.cost) })),
      chest: CHEST_LOT_IDS.map((id) => ({ id, items: CHEST_LOTS[id] })),
      farm: FARM,
    },
    missions: { lua: MISSION_01.map(stepOut), marte: MISSION_MARS.map(stepOut) },
    base: { ...BASE, modules: BASE_MODULES },
    props: PROP_TYPES.map((t) => ({
      id: t,
      ...PROPS[t],
      tier: PROPS[t].tier ?? 0,
      bonus: entries(PROPS[t].bonus ?? {}),
      debris: PROP_DEBRIS[t],
    })),
  });
}

type Op = Record<string, unknown> & { op: string };
interface Frame {
  op: Op;
  ret: unknown;
  state: unknown;
  events: [string, unknown][];
}

/** roda as operações e grava cada passo */
function run(ops: Op[], apply: (o: Op) => unknown, state: () => unknown, log: [string, unknown][]): Frame[] {
  return ops.map((op) => {
    log.length = 0;
    const ret = snap(apply(op) ?? null);
    return { op, ret, state: snap(state()), events: [...log] };
  });
}

function inventoryScript(): unknown {
  const r = mulberry32(41);
  const pick = <T>(a: readonly T[]): T => a[Math.floor(r() * a.length)];
  const few: ItemId[] = [
    'regolith',
    'ice',
    'iron',
    'h2',
    'o2',
    'circuit',
    'potato',
    'solar_panel',
    'greenhouse_plan',
    'glass',
  ];
  const ops: Op[] = [];
  for (let i = 0; i < 400; i++) {
    const k = r();
    const slot = (): number => Math.floor(r() * (SLOT_COUNT + 2)) - 1;
    if (k < 0.3)
      ops.push({
        op: 'add',
        item: pick(few),
        n: 1 + Math.floor(r() * (r() < 0.2 ? 200 : 20)),
        collected: r() < 0.7,
      });
    else if (k < 0.42) ops.push({ op: 'remove', item: pick(few), n: 1 + Math.floor(r() * 30) });
    else if (k < 0.47) ops.push({ op: 'removeSelected', n: 1 + Math.floor(r() * 5) });
    else if (k < 0.52)
      ops.push({
        op: 'removeAll',
        needs: [
          [pick(few), 1 + Math.floor(r() * 10)],
          [pick(few), 1 + Math.floor(r() * 5)],
        ],
      });
    else if (k < 0.72) ops.push({ op: 'moveN', from: slot(), to: slot(), n: Math.floor(r() * 70) });
    else if (k < 0.82) ops.push({ op: 'quickMove', from: slot() });
    else if (k < 0.87) ops.push({ op: 'sortBag' });
    else if (k < 0.97) ops.push({ op: 'select', index: Math.floor(r() * 10) - 1 });
    else if (k < 0.99) ops.push({ op: 'move', from: slot(), to: slot() });
    else ops.push({ op: 'takeEverything' });
  }
  const bus = createBus();
  const log = recorder(bus);
  const inv = new Inventory(bus);
  const frames = run(
    ops,
    (o) => {
      switch (o.op) {
        case 'add':
          return inv.add(o.item as ItemId, o.n as number, o.collected as boolean);
        case 'remove':
          return inv.remove(o.item as ItemId, o.n as number);
        case 'removeSelected':
          return inv.removeSelected(o.n as number);
        case 'removeAll': {
          const needs: Partial<Record<ItemId, number>> = {};
          for (const [k, n] of o.needs as [ItemId, number][]) needs[k] = n;
          return inv.removeAll(needs);
        }
        case 'moveN':
          return inv.moveN(o.from as number, o.to as number, o.n as number);
        case 'move':
          return inv.move(o.from as number, o.to as number);
        case 'quickMove':
          return inv.quickMove(o.from as number);
        case 'sortBag':
          return inv.sortBag();
        case 'select':
          return inv.select(o.index as number);
        case 'takeEverything':
          return entries(inv.takeEverything());
      }
    },
    () => inv.serialize(),
    log,
  );
  return { frames };
}

function craftingScript(): unknown {
  const r = mulberry32(7);
  const pick = <T>(a: readonly T[]): T => a[Math.floor(r() * a.length)];
  const ops: Op[] = [{ op: 'unlock', station: 'furnace' }];
  for (let i = 0; i < 380; i++) {
    const k = r();
    const station = pick(STATION_ORDER);
    if (k < 0.3)
      ops.push({ op: 'start', recipe: pick(RECIPES).id, batch: r() < 0.6 ? 1 : 1 + Math.floor(r() * 40) });
    else if (k < 0.55)
      ops.push({ op: 'update', dt: r() * (r() < 0.7 ? 1.5 : 8), speed: [r() < 0.2 ? 0 : r(), 1, r()] });
    else if (k < 0.7) ops.push({ op: 'take', station, slot: r() < 0.5 ? null : Math.floor(r() * 3) });
    else if (k < 0.8) ops.push({ op: 'cancel', station, slot: Math.floor(r() * 3) });
    else if (k < 0.87) ops.push({ op: 'togglePause', station, slot: Math.floor(r() * 3) });
    else if (k < 0.95)
      ops.push({ op: 'give', item: pick(ITEM_ORDER), n: 1 + Math.floor(r() * (r() < 0.1 ? 900 : 40)) });
    else if (k < 0.97) ops.push({ op: 'unlock', station });
    else ops.push({ op: 'reload' });
  }
  const bus = createBus();
  const log = recorder(bus);
  const start: [ItemId, number][] = [
    ['regolith', 120],
    ['rock', 40],
    ['iron', 60],
    ['ice', 50],
    ['basalt', 20],
    ['ilmenite', 8],
    ['gold', 10],
    ['crystal', 8],
    ['anorthosite', 10],
  ];
  const inv = new Inventory(bus);
  for (const [k, n] of start) inv.add(k, n, false);
  const equipment = new Equipment(bus);
  const rand = mulberry32(99);
  let speed = [1, 1, 1];
  const deps = {
    inventory: inv,
    equipment,
    events: bus,
    rand,
    speed: (s: StationId) => speed[STATION_ORDER.indexOf(s)],
  };
  let c = new Crafting(deps);
  const views = (): unknown =>
    STATION_ORDER.map((s) =>
      c.slots(s).map((v) => (v ? { ...v, recipe: v.recipe.id, waiting: entries(v.waiting) } : null)),
    );
  const frames = run(
    ops,
    (o) => {
      switch (o.op) {
        case 'start': {
          const rec = RECIPES.find((x) => x.id === o.recipe);
          return rec
            ? {
                check: {
                  ...c.check(rec, o.batch as number),
                  missing: c.check(rec, o.batch as number).missing,
                },
                ok: c.start(rec, o.batch as number),
              }
            : null;
        }
        case 'update':
          speed = o.speed as number[];
          return c.update(o.dt as number);
        case 'take': {
          const t = c.take(o.station as StationId, (o.slot as number | null) ?? undefined);
          return t
            ? {
                items: entries(t.items),
                delivered: t.delivered,
                partial: t.partial,
                recipes: t.recipes.map((x) => x.id),
              }
            : null;
        }
        case 'cancel': {
          const b = c.cancel(o.station as StationId, o.slot as number);
          return b ? entries(b) : null;
        }
        case 'togglePause':
          return c.togglePause(o.station as StationId, o.slot as number);
        case 'give':
          return inv.add(o.item as ItemId, o.n as number, false);
        case 'unlock':
          return c.unlock(o.station as StationId);
        case 'reload':
          // salvar e carregar no meio do trabalho
          c = new Crafting(deps, snap(c.serialize()));
          return null;
      }
    },
    () => ({
      crafting: c.serialize(),
      inventory: inv.serialize(),
      equipment: equipment.serialize(),
      views: views(),
      busy: STATION_ORDER.map((s) => [c.busy(s), c.working(s), c.hasReady(s)]),
    }),
    log,
  );
  return { start, frames };
}

function survivalScript(): unknown {
  const r = mulberry32(3);
  const ops: Op[] = [];
  for (let i = 0; i < 600; i++) {
    const k = r();
    if (k < 0.85) {
      ops.push({
        op: 'step',
        dt: r() * (r() < 0.1 ? 30 : 1.5),
        pos: [r() * 12 - 6, 20 + r() * 6, r() * 12 - 6],
        moving: r() < 0.5,
        mining: r() < 0.3,
        sheltered: r() < 0.1,
        drillDrain: r() < 0.5 ? 1 : 1.35,
        baseCharge: r(),
      });
    } else if (k < 0.89) ops.push({ op: 'meteor', distance: r() * 10, sheltered: r() < 0.2 });
    else if (k < 0.93) ops.push({ op: 'land', speed: r() * 25 });
    else if (k < 0.95) ops.push({ op: 'eat', item: r() < 0.5 ? 'potato' : 'rock' });
    else if (k < 0.97) ops.push({ op: 'rest' });
    else if (k < 0.99) ops.push({ op: 'respawn' });
    else ops.push({ op: 'damage', amount: r() * 50, continuous: r() < 0.5 });
  }
  const bus = createBus();
  const log = recorder(bus);
  let cur = ops[0] as Op & { pos: number[] };
  let sheltered = false;
  const s = new Survival(
    {
      events: bus,
      position: () => ({ x: cur.pos?.[0] ?? 0, y: cur.pos?.[1] ?? 22, z: cur.pos?.[2] ?? 0 }),
      moving: () => cur.moving as boolean,
      mining: () => cur.mining as boolean,
      pressureCenter: () => ({ x: -2.5, y: 22, z: -1.5 }),
      sheltered: () => sheltered,
      drillDrain: () => cur.drillDrain as number,
      baseCharge: () => cur.baseCharge as number,
    },
    { suit: 'emergency', o2: 90, battery: 30, integrity: 100, energy: 50 },
  );
  const frames = run(
    ops,
    (o) => {
      switch (o.op) {
        case 'step':
          cur = o as Op & { pos: number[] };
          sheltered = o.sheltered as boolean;
          return s.step(o.dt as number);
        case 'meteor':
          sheltered = o.sheltered as boolean;
          return bus.emit('meteor:impact', {
            x: 0,
            y: 0,
            z: 0,
            id: 1,
            distance: o.distance as number,
            meteorite: false,
            radius: 2,
          });
        case 'land':
          return bus.emit('player:land', { x: 0, y: 0, z: 0, speed: o.speed as number });
        case 'eat':
          return s.eat(o.item as ItemId);
        case 'rest':
          return s.rest();
        case 'respawn':
          return s.respawn();
        case 'damage':
          return s.damage(o.amount as number, 'meteor', o.continuous as boolean);
      }
    },
    () => ({
      ...s.serialize(),
      dead: s.dead,
      invulnerable: s.invulnerable,
      inPressure: s.inPressure,
      starving: s.starving,
      drillRate: s.drillRate(),
    }),
    log,
  );
  return { start: { o2: 90, battery: 30, integrity: 100, energy: 50 }, pressure: [-2.5, 22, -1.5], frames };
}

function powerScript(): unknown {
  const r = mulberry32(5);
  const ops: Op[] = [];
  for (let i = 0; i < 300; i++) {
    const n = Math.floor(r() * 4);
    const panels = Array.from({ length: n }, (_, j) => ({
      key: `p${j}`,
      x: Math.floor(r() * 60 - 30),
      z: Math.floor(r() * 60 - 30),
    }));
    ops.push({
      op: 'update',
      dt: r() * 20,
      panels,
      exposure: panels.map(() => (r() < 0.2 ? null : r())),
      loads:
        r() < 0.5
          ? []
          : [
              { id: 'furnace', kw: 0.15 },
              { id: 'electrolyzer', kw: r() * 3 },
            ],
      dust: r() < 0.7 ? 0 : r(),
    });
  }
  const out: unknown[] = [];
  for (const [planet, solar, shade] of [
    ['lua', 1, POWER.shadeLua],
    ['marte', 0.43, POWER.shadeMarte],
  ] as const) {
    let cur = ops[0];
    const p = new Power(
      {
        base: { x: 2.5, z: -6.5 },
        solar,
        shade,
        panels: () => cur.panels as { key: string; x: number; z: number }[],
        exposure: (x, z) => {
          const i = (cur.panels as { x: number; z: number }[]).findIndex((q) => q.x === x && q.z === z);
          return (cur.exposure as (number | null)[])[i] ?? null;
        },
        loads: () => cur.loads as { id: string; kw: number }[],
        dust: () => cur.dust as number,
      },
      { battery: 300 },
    );
    const log: [string, unknown][] = [];
    const frames = run(
      ops,
      (o) => {
        cur = o;
        return p.update(o.dt as number);
      },
      () => ({
        battery: p.battery,
        generation: p.generation,
        demand: p.demand,
        satisfaction: p.satisfaction,
        sun: p.sun,
        panels: p.panels,
        save: p.serialize(),
      }),
      log,
    );
    out.push({ planet, solar, shade, base: [2.5, -6.5], battery: 300, frames });
  }
  return out;
}

/** chão de mentira para a estufa (o Rust tem a mesma conta em tests/rules.rs) */
const ground = {
  topY: (x: number, z: number): number =>
    20 + ((((x * 3 + z * 5) % 4) + 4) % 4 === 0 ? 1 : 0) + (x > 40 ? 3 : 0),
  getBlock: (x: number, _y: number, z: number): number => (x === 30 && z > 0 ? LAVA : 1),
};

function greenhouseScript(): unknown {
  const r = mulberry32(11);
  const ops: Op[] = [];
  const cell = (): [number, number] => [Math.floor(r() * 80 - 30), Math.floor(r() * 60 - 30)];
  // 1. procurar lugar, abrir o baú, tentar entregar antes da hora
  for (let i = 0; i < 120; i++) {
    const k = r();
    if (k < 0.08) ops.push({ op: 'openChest' });
    else if (k < 0.6)
      ops.push({
        op: 'check',
        at: cell(),
        player: r() < 0.5 ? [r() * 80 - 30, r() * 60 - 30] : null,
        base: r() < 0.5,
      });
    else if (k < 0.75) ops.push({ op: 'place', at: cell() });
    else if (k < 0.9) ops.push({ op: 'deliver' });
    else ops.push({ op: r() < 0.5 ? 'finish' : 'useBed', at: [3, 3] });
  }
  // 2. a obra: material, todas as peças, finalizar, canteiros por dentro (e alguns fora)
  ops.push(
    { op: 'drop', item: 'regolith', n: 9999 },
    { op: 'give', item: 'iron_bar', n: 40 },
    { op: 'give', item: 'brick', n: 30 },
    { op: 'give', item: 'glass', n: 10 },
    { op: 'give', item: 'basalt_fiber', n: 5 },
  );
  for (let i = 0; i < 8; i++) ops.push({ op: 'deliver' });
  ops.push({ op: 'finish' }, { op: 'finish' });
  for (let dz = -1; dz <= 7; dz++)
    for (let dx = -1; dx <= 7; dx += 2) ops.push({ op: 'placeBed', at: [dx, dz] });
  // 3. cultivar
  for (let i = 0; i < 260; i++) {
    const k = r();
    if (k < 0.45) ops.push({ op: 'useBed', at: [r() * 9 - 1, r() * 9 - 1] });
    else if (k < 0.8) ops.push({ op: 'step', dt: r() * 40, light: r() < 0.5 ? 1 : 0.43 });
    else
      ops.push({
        op: 'give',
        item: ['soil', 'potato', 'ice'][Math.floor(r() * 3)],
        n: 1 + Math.floor(r() * 4),
      });
  }
  const inv = new Inventory();
  inv.add('regolith', 64 * 25, false); // quase cheia: o baú pode recusar
  const g = new Greenhouse();
  const base = { x0: -12, y0: 18, z0: -14, x1: -4, y1: 24, z1: -6 };
  const frames = run(
    ops,
    (o) => {
      switch (o.op) {
        case 'openChest': {
          const res = g.openChest(inv);
          if (!res.ok && res.reason === 'full') inv.remove('regolith', 64 * 4);
          return res;
        }
        case 'check': {
          const [tx, tz] = o.at as [number, number];
          const a = anchorAt(tx, tz);
          const pl = o.player as [number, number] | null;
          return g.check(ground, o.base ? base : null, a.x, a.z, pl ? { x: pl[0], z: pl[1] } : undefined);
        }
        case 'place': {
          const [tx, tz] = o.at as [number, number];
          const a = anchorAt(tx, tz);
          const c = g.check(ground, base, a.x, a.z);
          if (c.ok) g.placeSite(c.x, c.z, c.floorY);
          return c;
        }
        case 'deliver': {
          const d = g.deliver(inv);
          return d.ok ? { ok: true, part: d.part.id } : { ok: false, missing: entries(d.missing) };
        }
        case 'finish':
          return g.finish();
        case 'placeBed': {
          const [dx, dz] = o.at as [number, number];
          const s = g.site;
          return s ? { spot: g.bedSpot(s.x + dx, s.z + dz), ok: g.placeBed(s.x + dx, s.z + dz) } : null;
        }
        case 'useBed': {
          const [dx, dz] = o.at as [number, number];
          const s = g.site;
          const b = s ? g.bedNear(s.x + dx, s.z + dz) : null;
          return b ? { bed: [b.x, b.z], action: g.bedAction(b, inv), used: g.useBed(b, inv) } : null;
        }
        case 'step':
          return g.step(o.dt as number, o.light as number).map((b) => [b.x, b.z]);
        case 'give':
          return inv.add(o.item as ItemId, o.n as number, false);
        case 'drop':
          return inv.remove(o.item as ItemId, o.n as number);
      }
    },
    () => ({
      save: g.serialize(),
      inventory: inv.serialize(),
      next: g.nextPart()?.id ?? null,
      spent: entries(g.spent()),
      missing: entries(g.missing(inv)),
    }),
    [],
  );
  return { base, frames };
}

/** missões (Missions.ts) com o mundo, o jogador e os meteoros de mentira: só o que a regra pergunta */
function missionsScript(): unknown {
  const r = mulberry32(17);
  const items: ItemId[] = ['regolith', 'ice', 'iron', 'rock', 'crystal', 'marsdust'];
  const sessions: unknown[] = [];
  for (let s = 0; s < 10; s++) {
    const bus = createBus();
    const log = recorder(bus);
    const inv = new Inventory(bus);
    // as quatro últimas começam na entrega, o passo com mais contas de distância
    const saved = s === 0 ? undefined : { step: s >= 6 ? 5 : Math.floor(r() * 8), count: Math.floor(r() * 5) };
    const player = { pos: new THREE.Vector3() };
    let prop: THREE.Vector3 | null = null;
    let active = 0;
    let launches = 0;
    const meteors = {
      get active(): unknown[] {
        return Array.from({ length: active });
      },
      launch: (): void => void launches++,
      pickTarget: (): THREE.Vector3 => new THREE.Vector3(9, 21, 4),
    };
    const world = { findProp: () => (prop ? { position: prop } : null) };
    const m = new Missions(
      { events: bus, inventory: inv, player: player as never, world: world as never, meteors: meteors as never, landerY: () => 21.5 },
      saved,
    );
    const frames: Frame[] = [];
    for (let i = 0; i < 300; i++) {
      const cur = m.current;
      const k = r();
      let op: Op;
      if (k < 0.45) {
        const near = r() < (cur.kind === 'deliver' ? 0.9 : 0.5);
        // perto do módulo: em volta do raio de entrega (4,2) e do de esquecer o aviso (6)
        const a = r() * Math.PI * 2, d = s >= 6 && r() < 0.7 ? 3.8 + r() : r() * 8;
        const pos = near
          ? [LANDER.x + 0.5 + Math.cos(a) * d, 21, LANDER.z + 0.5 + Math.sin(a) * d]
          : [r() * 60 - 30, 21, r() * 60 - 30];
        const pp = r() < 0.5 ? [pos[0] + r() * 8 - 4, 21, pos[2] + r() * 8 - 4] : null;
        op = { op: 'step', dt: r() < 0.2 ? 2 : r() * 0.5, pos, prop: pp, active: r() < 0.3 ? 1 : 0 };
      } else if (k < 0.8) {
        const want = cur.kind === 'collect' ? [cur.item] : cur.kind === 'deliver' ? (Object.keys(cur.needs) as ItemId[]) : [];
        const item = want.length && r() < 0.6 ? want[Math.floor(r() * want.length)] : items[Math.floor(r() * items.length)];
        op = { op: 'collect', item, n: 1 + Math.floor(r() * 4) };
      } else if (k < 0.88) op = { op: 'broken', type: r() < 0.7 ? 'meteorite' : 'rock' };
      else if (k < 0.97) op = { op: 'drop', item: items[Math.floor(r() * items.length)], n: 1 + Math.floor(r() * 3) };
      else op = { op: 'skip' };
      log.length = 0;
      switch (op.op) {
        case 'step': {
          const p = op.pos as number[];
          player.pos.set(p[0], p[1], p[2]);
          const pp = op.prop as number[] | null;
          prop = pp ? new THREE.Vector3(pp[0], pp[1], pp[2]) : null;
          active = op.active as number;
          m.update(op.dt as number);
          break;
        }
        case 'collect':
          inv.add(op.item as ItemId, op.n as number);
          break;
        case 'broken':
          bus.emit('prop:broken', { x: 0, y: 0, z: 0, type: op.type as never });
          break;
        case 'drop':
          inv.remove(op.item as ItemId, op.n as number);
          break;
        case 'skip':
          m.skip();
          break;
      }
      const v = m.view();
      const t = m.target();
      frames.push({
        op,
        ret: null,
        state: snap({
          save: m.serialize(),
          view: { ...v, step: v.step.id },
          target: t ? [t.x, t.y, t.z] : null,
          launches,
        }),
        events: [...log],
      });
    }
    sessions.push({ saved: saved ?? null, frames });
  }
  return sessions;
}

/** mapa descoberto (Exploration.ts) */
function explorationScript(): unknown {
  const r = mulberry32(23);
  const bus = createBus();
  const log = recorder(bus);
  const saved = { '0,0': 0b1010_0000_0000_0101, '-1,2': 3, '5,5': 0 };
  const e = new Exploration(bus, saved);
  let x = 0, z = 0;
  const ops: Op[] = [];
  for (let i = 0; i < 300; i++) {
    x += r() * 16 - 8;
    z += r() * 16 - 8;
    ops.push(r() < 0.85 ? { op: 'reveal', x, z, radius: r() < 0.7 ? null : 3 + r() * 30 } : { op: 'jump', x: (x = r() * 200 - 100), z: (z = r() * 200 - 100) });
  }
  let px = 0, pz = 0;
  const probe = (): boolean[] => {
    const out: boolean[] = [];
    for (let k = -3; k <= 3; k++) out.push(e.at(px + k * 3, pz - k * 2));
    return out;
  };
  const frames = run(
    ops,
    (o) => {
      px = o.x as number;
      pz = o.z as number;
      if (o.op !== 'reveal') return null;
      return o.radius === null ? e.revealAround(px, pz) : e.revealAround(px, pz, o.radius as number);
    },
    () => ({ save: e.serialize(), revealed: e.revealed, probe: probe() }),
    log,
  );
  return { saved, frames };
}

/** salvamentos de todas as versões, inteiros e estragados, e o que o migrate e o renewWorld fazem com eles (save.ts) */
function saveScript(): unknown {
  const r = mulberry32(29);
  const full = (): Record<string, unknown> => ({
    version: 12,
    seed: 4242,
    worldGen: 2,
    savedAt: 1731600000000,
    world: {
      edits: { '0,0': [[5, 3], [70, 0]], '-1,2': [[4095, 7]] },
      removedProps: ['3,4', '10,-2', 'x'],
      extraProps: [
        { wx: 4, wz: 9, type: 'solarPanel', variant: 0, rot: 0.5, scale: 1, key: 'p:4,9' },
        { wx: 6, wz: 9, type: 'solarPanel', variant: 0, rot: 0, scale: 1, key: 'p:6,9' },
        { wx: 1, wz: 1, type: 'solarPanel', variant: 0, rot: 0, scale: 1, key: 'x' },
      ],
    },
    inventory: {
      slots: [{ item: 'regolith', n: 40 }, null, { item: 'iron', n: 7 }, { item: 'circuit', n: 1 }, { item: 'nada', n: 3 }, { item: 'ice', n: 0.5 }, { item: 'rock', n: 999 }],
      selected: 2,
    },
    player: { x: 3.5, y: 22.25, z: -4 },
    missions: { step: 3, count: 2.7 },
    suit: { suit: 'emergency', o2: 55.5, battery: 120, integrity: -3, energy: 40 },
    loot: [
      { item: 'iron', amount: 3, x: 1, y: 22, z: 2, pile: 1 },
      { item: 'ice', amount: 0.5, x: 1, y: 22, z: 2, pile: 2.6 },
      { item: 'nada', amount: 3, x: 1, y: 22, z: 2, pile: 1 },
      { item: 'rock', amount: 2, x: 'a', y: 22, z: 2, pile: 1 },
    ],
    equipment: { drill: 'drill_iron', map: 'map', suit: 'map' },
    base: { inside: true, respawn: 'base', visited: 1 },
    explored: { '0,0': 65535, '1,1': 0, '2,x': 5, '-3,4': 70000, '5,5': 2.5, '7,-8': 12 },
    crafting: {
      built: ['furnace', 'workbench', 'nada', 'electrolyzer'],
      jobs: [
        { station: 'furnace', slot: 1, recipe: 'iron_ingot', batch: 3, prep: 4, unit: 10, done: 12, taken: { iron: 2, nada: 1, ice: 0 } },
        { station: 'workbench', slot: 0, recipe: 'x', batch: 1, prep: 0, unit: 5, done: 5, delivered: true, paused: true, leftover: {} },
        { station: 'nada', slot: 0, recipe: 'y' },
        { station: 'electrolyzer', slot: 1.7, recipe: 'oxygen', batch: 0, prep: -2, unit: 3, done: 1, leftover: { ice: 2 } },
      ],
    },
    power: { battery: 12.5 },
    greenhouse: {
      chest: ['estufa', 'x', 'cultivo'],
      chestOpened: true,
      site: {
        x: 10.5, z: -6, floorY: 21.9, parts: ['nada', ...PARTS.map((p) => p.id).reverse()], done: true,
        beds: [
          { x: 12, z: -4, soil: true, water: 2, crop: { growth: 1.4 } },
          { x: 12, z: -4, soil: false, water: 0.5, crop: null },
          { x: 13, z: -3, soil: false, water: -1, crop: { growth: 0.5 } },
          { x: 10, z: -3, soil: true, water: 0.2, crop: null },
          { x: 13.5, z: -3, soil: true, water: 0.2, crop: null },
          { x: 11, z: -2, soil: true, water: 0.2, crop: { growth: 0.3 } },
        ],
      },
    },
  });
  const junk = (): unknown => [-5, 3.7, 0, 'x', null, [], {}, true, 1e6][Math.floor(r() * 9)];
  const cases: unknown[] = [null, 'texto', 7, [], {}, { version: 99 }, { version: null }, { version: 2.5 }, { version: 0 }, full()];
  // a v0.1 (sem versão) e cada versão com o formato inteiro
  cases.push({ world: full().world, inventory: { regolith: 12, iron: 3.6, nada: 2, ice: -1 }, player: { x: 1 }, missions: { step: 2, count: 1 } });
  for (let v = 1; v <= 13; v++) {
    const s = full();
    s.version = v;
    if (v < 4) s.inventory = { regolith: 70, iron: 3, circuit: v === 2 ? 1 : 0, rock: 130 };
    if (v < 7) s.crafting = { built: ['furnace'], jobs: [{ station: 'furnace', recipe: 'iron_ingot', t: 3, duration: 8 }] };
    if (v === 7 || v === 8)
      (s.crafting as { jobs: unknown[] }).jobs = [
        { station: 'furnace', slot: 2, recipe: 'iron_ingot', batch: 2, work: 20, done: 20, left: { iron: 1 }, rest: false },
        { station: 'furnace', recipe: 'iron_ingot', t: 9, duration: 8, left: { ice: 2 }, rest: false },
        { station: 'workbench', recipe: 'map', t: 1, duration: 8 },
        { station: 'electrolyzer', slot: 0, recipe: 'oxygen', batch: 3, work: 0, done: 0 },
      ];
    if (v === 11) s.greenhouse = { chestOpened: true, site: { x: 3, z: 4, floorY: 21, parts: ['frame'], done: false } };
    cases.push(s);
    if (v === 5 || v === 6) {
      const t = full();
      t.version = v;
      t.equipment = {};
      t.inventory = { slots: [{ item: 'circuit', n: 1 }], selected: 0 };
      cases.push(t);
      const u = full();
      u.version = v;
      u.equipment = {};
      cases.push(u);
    }
  }
  // estragados: campos que somem ou viram lixo, em todos os níveis
  for (let i = 0; i < 160; i++) {
    const s = full();
    s.version = 1 + Math.floor(r() * 12);
    if (r() < 0.1) delete s.version;
    const top = Object.keys(s).filter((k) => k !== 'version');
    for (let k = 0; k < 3; k++) {
      const key = top[Math.floor(r() * top.length)];
      if (r() < 0.5) delete s[key];
      else if (key !== 'world') s[key] = junk();
    }
    const nested = (o: unknown): void => {
      if (typeof o !== 'object' || o === null) return;
      const keys = Object.keys(o);
      if (!keys.length) return;
      const key = keys[Math.floor(r() * keys.length)];
      const rec = o as Record<string, unknown>;
      if (r() < 0.5 && typeof rec[key] === 'object' && rec[key] !== null) nested(rec[key]);
      else if (r() < 0.3) delete rec[key];
      else rec[key] = junk();
    };
    for (const key of ['inventory', 'suit', 'loot', 'equipment', 'base', 'explored', 'crafting', 'greenhouse', 'player', 'missions', 'power'])
      if (r() < 0.4) nested(s[key]);
    cases.push(s);
  }
  return cases.map((raw) => {
    const out = migrate(snap(raw), 77);
    return { raw, out, renewed: out ? renewWorld(snap(out), 99, 3) : null };
  });
}

test('exporta as regras e os roteiros de referência', () => {
  exportData();
  write(
    join(ROOT, 'native/golden/rules.json'),
    {
      inventory: inventoryScript(),
      crafting: craftingScript(),
      survival: survivalScript(),
      power: powerScript(),
      greenhouse: greenhouseScript(),
      missions: missionsScript(),
      exploration: explorationScript(),
      save: saveScript(),
    },
    true,
  );
});
