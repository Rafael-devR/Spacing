// Regras da estufa (docs/design/ESTUFA.md): o baú da base, onde a obra pode ser assentada, a entrega do material peça por peça
// e a finalização. Só estado e regras: o desenho (holograma, baixa e alta qualidade) é de render/greenhouseModel.ts, a colisão de
// world/greenhouseLayout.ts e a ligação com o jogo de app/GreenhouseDirector.ts.
import { LAVA, type BlockId } from '../data/blocks';
import {
  CHEST_LOTS, CHEST_LOT_IDS, FARM, GH, PARTS, PART_IDS, growthStage, partDef,
  type BedSave, type ChestLot, type GreenhouseSave, type PartDef, type PartId, type SiteSave,
} from '../data/greenhouse';
import { ITEMS, type ItemId } from '../data/items';
import type { Box } from '../world/Structure';
import { CH, LANDER } from '../world/terrain';
import type { Inventory, ItemCounts } from './Inventory';

/** o que a regra precisa saber do chão (o `World` serve) */
export interface GroundView {
  topY(x: number, z: number): number;
  getBlock(x: number, y: number, z: number): BlockId;
}

export type SpotReason = 'exists' | 'uneven' | 'base' | 'lander' | 'lava' | 'door' | 'high' | 'player';

export interface SpotCheck {
  ok: boolean;
  reason?: SpotReason;
  /** altura do piso (a célula do piso): a do ponto mais alto sob a estufa */
  floorY: number;
  x: number;
  z: number;
}

/** o canto mínimo da estufa quando o jogador mira o bloco (tx, tz): ela fica centrada nele */
export function anchorAt(tx: number, tz: number): { x: number; z: number } {
  const h = Math.floor(GH.size / 2);
  return { x: tx - h, z: tz - h };
}

/** as 3 colunas de fora da porta (a faixa que fica rente ao piso) */
export function doorApron(x: number, z: number): [number, number][] {
  const out: [number, number][] = [];
  for (let dz = 0; dz < 2; dz++) for (let dx = -1; dx <= 1; dx++) out.push([x + GH.doorAt + dx, z + GH.size + dz]);
  return out;
}

const missingOf = (inv: Inventory, cost: ItemCounts): ItemCounts => {
  const out: ItemCounts = {};
  for (const [k, n] of Object.entries(cost) as [ItemId, number][]) {
    const lack = n - inv.count(k);
    if (lack > 0) out[k] = lack;
  }
  return out;
};

/** "faltam 3 tijolos de regolito e 1 vidro" */
export function missingText(m: ItemCounts): string {
  return (Object.entries(m) as [ItemId, number][]).map(([k, n]) => `${n} ${ITEMS[k].name}`).join(', ');
}

/** "4 Barra de ferro, 2 Tijolo de regolito" */
export function costText(c: ItemCounts): string {
  return (Object.entries(c) as [ItemId, number][]).map(([k, n]) => `${n} ${ITEMS[k].name}`).join(', ');
}

/** o que o botão de ação faz num canteiro */
export type BedAction = 'soil' | 'plant' | 'water' | 'harvest' | 'needSoil' | 'needSeed' | 'needWater' | 'growing';

const copySite = (s: SiteSave): SiteSave => ({
  ...s, parts: [...s.parts], beds: s.beds.map((b) => ({ ...b, crop: b.crop ? { ...b.crop } : null })),
});

export class Greenhouse {
  /** lotes do baú já pegos */
  chest: ChestLot[];
  site: SiteSave | null;

  constructor(saved: GreenhouseSave | null = null) {
    this.chest = saved ? [...saved.chest] : [];
    this.site = saved?.site ? copySite(saved.site) : null;
  }

  // ---------- baú da base ----------

  /** o baú ainda tem algo (um lote que não foi pego) */
  get chestFull(): boolean {
    return CHEST_LOT_IDS.some((l) => !this.chest.includes(l));
  }

  /** compatível com o teste antigo: o baú já foi aberto ao menos uma vez */
  get chestOpened(): boolean {
    return this.chest.length > 0;
  }

  /** Abre o baú: os lotes que faltam vão para a mochila. Não tira nada se não couber tudo. */
  openChest(inv: Inventory): { ok: boolean; reason?: 'opened' | 'full'; lots?: ChestLot[] } {
    const lots = CHEST_LOT_IDS.filter((l) => !this.chest.includes(l));
    if (!lots.length) return { ok: false, reason: 'opened' };
    const items = lots.flatMap((l) => CHEST_LOTS[l]);
    // espaço: soma por item (dois lotes podem ter o mesmo item)
    const need: Record<string, number> = {};
    for (const c of items) need[c.item] = (need[c.item] ?? 0) + c.n;
    for (const [k, n] of Object.entries(need)) if (!inv.canAdd(k as ItemId, n)) return { ok: false, reason: 'full' };
    for (const c of items) inv.add(c.item, c.n, false);
    this.chest.push(...lots);
    return { ok: true, lots };
  }

  // ---------- onde assentar ----------

  /** A estufa com o canto mínimo em (x, z) cabe aqui? `base` é a caixa da base; `player` é onde o astronauta está. */
  check(ground: GroundView, base: Box | null, x: number, z: number, player?: { x: number; z: number }): SpotCheck {
    const n = GH.size;
    let lo = Infinity, hi = -Infinity;
    let lava = false;
    for (let dz = 0; dz < n; dz++)
      for (let dx = 0; dx < n; dx++) {
        const top = ground.topY(x + dx, z + dz);
        lo = Math.min(lo, top);
        hi = Math.max(hi, top);
        if (ground.getBlock(x + dx, top, z + dz) === LAVA) lava = true;
      }
    const bad = (reason: SpotReason): SpotCheck => ({ ok: false, reason, floorY: hi, x, z });
    if (this.site) return bad('exists');
    if (lava) return bad('lava');
    if (hi - lo > GH.tolerance) return bad('uneven');
    if (hi + GH.wallHeight + 8 >= CH) return bad('high');
    if (base) {
      const g = GH.baseGap;
      if (x + n - 1 >= base.x0 - g && x <= base.x1 + g && z + n - 1 >= base.z0 - g && z <= base.z1 + g) return bad('base');
    }
    // o módulo de pouso (e a área pressurizada em volta dele) fica livre
    const lx = Math.max(x - LANDER.x, 0, LANDER.x - (x + n)), lz = Math.max(z - LANDER.z, 0, LANDER.z - (z + n));
    if (Math.hypot(lx, lz) < GH.landerGap) return bad('lander');
    for (const [ax, az] of doorApron(x, z)) {
      const t = ground.topY(ax, az);
      if (Math.abs(t - hi) > 2 || ground.getBlock(ax, t, az) === LAVA) return bad('door');
    }
    if (player && player.x >= x - 0.4 && player.x <= x + n + 0.4 && player.z >= z - 0.4 && player.z <= z + n + 0.4) return bad('player');
    return { ok: true, floorY: hi, x, z };
  }

  /** Assenta a obra (o jogo já ajustou o terreno). */
  placeSite(x: number, z: number, floorY: number): void {
    this.site = { x, z, floorY, parts: [], done: false, beds: [] };
  }

  // ---------- construir ----------

  /** a próxima peça a entregar; null = todas entregues */
  nextPart(): PartDef | null {
    if (!this.site) return null;
    const id = PART_IDS.find((p) => !this.site?.parts.includes(p));
    return id ? partDef(id) : null;
  }

  has(id: PartId): boolean {
    return !!this.site?.parts.includes(id);
  }

  get delivered(): number {
    return this.site?.parts.length ?? 0;
  }

  get complete(): boolean {
    return !!this.site && this.site.parts.length === PARTS.length;
  }

  get done(): boolean {
    return !!this.site?.done;
  }

  /** o que falta para entregar a próxima peça */
  missing(inv: Inventory): ItemCounts {
    const p = this.nextPart();
    return p ? missingOf(inv, p.cost) : {};
  }

  /** Entrega a próxima peça: o material sai da mochila. */
  deliver(inv: Inventory): { ok: true; part: PartDef } | { ok: false; missing: ItemCounts } {
    const p = this.nextPart();
    if (!p || !this.site) return { ok: false, missing: {} };
    const lack = missingOf(inv, p.cost);
    if (Object.keys(lack).length) return { ok: false, missing: lack };
    inv.removeAll(p.cost);
    this.site.parts.push(p.id);
    return { ok: true, part: p };
  }

  /** Finaliza: com todas as peças entregues, tudo passa para a alta qualidade. */
  finish(): boolean {
    if (!this.site || !this.complete || this.site.done) return false;
    this.site.done = true;
    return true;
  }

  // ---------- canteiros ----------

  /** a célula (x, z) fica por dentro das paredes e fora do caminho da porta? */
  insideCell(x: number, z: number): boolean {
    const s = this.site;
    if (!s) return false;
    const lx = x - s.x, lz = z - s.z;
    if (lx < 1 || lx > GH.size - 2 || lz < 1 || lz > GH.size - 2) return false;
    // o corredor da porta (as duas células logo depois dela) fica livre
    return !(lx === GH.doorAt && lz >= GH.size - 3);
  }

  bedAt(x: number, z: number): BedSave | null {
    return this.site?.beds.find((b) => b.x === x && b.z === z) ?? null;
  }

  /** Pode pôr um canteiro na célula? null = pode; senão, o motivo. */
  bedSpot(x: number, z: number): null | 'notDone' | 'outside' | 'taken' {
    if (!this.site?.done) return 'notDone';
    if (!this.insideCell(x, z)) return 'outside';
    if (this.bedAt(x, z)) return 'taken';
    return null;
  }

  placeBed(x: number, z: number): boolean {
    if (this.bedSpot(x, z) || !this.site) return false;
    this.site.beds.push({ x, z, soil: false, water: 0, crop: null });
    return true;
  }

  /** o canteiro mais perto do ponto, dentro do alcance */
  bedNear(px: number, pz: number): BedSave | null {
    let best: BedSave | null = null, bd: number = FARM.reach;
    for (const b of this.site?.beds ?? []) {
      // distância até a borda da célula
      const dx = Math.max(Math.abs(px - (b.x + 0.5)) - 0.5, 0), dz = Math.max(Math.abs(pz - (b.z + 0.5)) - 0.5, 0);
      const d = Math.hypot(dx, dz);
      if (d <= bd) {
        bd = d;
        best = b;
      }
    }
    return best;
  }

  /** O que o botão faz neste canteiro, com o que há na mochila. */
  bedAction(b: BedSave, inv: Inventory): BedAction {
    if (!b.soil) return inv.has('soil') ? 'soil' : 'needSoil';
    if (!b.crop) return inv.has('potato') ? 'plant' : 'needSeed';
    if (b.crop.growth >= 1) return 'harvest';
    if (b.water < FARM.thirsty) return inv.has('ice') ? 'water' : 'needWater';
    return b.water < 0.98 && inv.has('ice') ? 'water' : 'growing';
  }

  /** Faz a ação do canteiro. Devolve o que aconteceu (ou null se nada mudou). Colher devolve quantas batatas. */
  useBed(b: BedSave, inv: Inventory): { action: BedAction; harvested?: number } | null {
    const a = this.bedAction(b, inv);
    switch (a) {
      case 'soil':
        inv.remove('soil', 1);
        b.soil = true;
        b.water = Math.max(b.water, 0.5); // o solo vem úmido
        return { action: a };
      case 'plant':
        inv.remove('potato', 1);
        b.crop = { growth: 0 };
        return { action: a };
      case 'water':
        inv.remove('ice', 1);
        b.water = 1;
        return { action: a };
      case 'harvest': {
        const left = inv.add('potato', FARM.harvest);
        b.crop = null;
        return { action: a, harvested: FARM.harvest - left };
      }
      default:
        return null;
    }
  }

  /**
   * O tempo passa nos canteiros: com água a planta cresce e a água baixa. `light` = luz do planeta (1 na Lua).
   * Devolve os canteiros que mudaram de estágio (para o desenho).
   */
  step(dt: number, light = 1): BedSave[] {
    const changed: BedSave[] = [];
    if (!this.site?.done) return changed;
    for (const b of this.site.beds) {
      if (!b.crop || b.crop.growth >= 1) continue;
      if (b.water <= 0) continue;
      const before = growthStage(b.crop.growth);
      b.crop.growth = Math.min(1, b.crop.growth + (dt / FARM.growSeconds) * light);
      b.water = Math.max(0, b.water - dt / FARM.waterSeconds);
      if (growthStage(b.crop.growth) !== before) changed.push(b);
    }
    return changed;
  }

  /** o que o jogador gastou na obra (para devolver se o mundo for refeito) */
  spent(): ItemCounts {
    const out: Record<string, number> = {};
    for (const id of this.site?.parts ?? []) for (const [k, n] of Object.entries(partDef(id).cost)) out[k] = (out[k] ?? 0) + (n ?? 0);
    return out as ItemCounts;
  }

  serialize(): GreenhouseSave {
    return { chest: [...this.chest], site: this.site ? copySite(this.site) : null };
  }
}
