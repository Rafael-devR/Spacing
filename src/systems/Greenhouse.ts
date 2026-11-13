// Regras da estufa (docs/design/ESTUFA.md): o baú da base, onde a obra pode ser assentada, a entrega do material peça por peça
// e a finalização. Só estado e regras: o desenho (holograma, baixa e alta qualidade) é de render/greenhouseModel.ts, a colisão de
// world/greenhouseLayout.ts e a ligação com o jogo de app/GreenhouseDirector.ts.
import { LAVA, type BlockId } from '../data/blocks';
import { CHEST, GH, PARTS, PART_IDS, partDef, type GreenhouseSave, type PartDef, type PartId, type SiteSave } from '../data/greenhouse';
import { ITEMS, type ItemId } from '../data/items';
import type { Box } from '../world/Structure';
import { CH } from '../world/terrain';
import type { Inventory, ItemCounts } from './Inventory';

/** o que a regra precisa saber do chão (o `World` serve) */
export interface GroundView {
  topY(x: number, z: number): number;
  getBlock(x: number, y: number, z: number): BlockId;
}

export type SpotReason = 'exists' | 'uneven' | 'base' | 'lava' | 'door' | 'high' | 'player';

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

export class Greenhouse {
  chestOpened: boolean;
  site: SiteSave | null;

  constructor(saved: GreenhouseSave | null = null) {
    this.chestOpened = saved?.chestOpened ?? false;
    this.site = saved?.site ? { ...saved.site, parts: [...saved.site.parts] } : null;
  }

  // ---------- baú da base ----------

  /** Abre o baú: o kit vai para a mochila, uma vez só. Devolve false (sem tirar nada) se não couber tudo. */
  openChest(inv: Inventory): { ok: boolean; reason?: 'opened' | 'full' } {
    if (this.chestOpened) return { ok: false, reason: 'opened' };
    for (const c of CHEST) if (!inv.canAdd(c.item, c.n)) return { ok: false, reason: 'full' };
    for (const c of CHEST) inv.add(c.item, c.n, false);
    this.chestOpened = true;
    return { ok: true };
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
    for (const [ax, az] of doorApron(x, z)) {
      const t = ground.topY(ax, az);
      if (Math.abs(t - hi) > 2 || ground.getBlock(ax, t, az) === LAVA) return bad('door');
    }
    if (player && player.x >= x - 0.4 && player.x <= x + n + 0.4 && player.z >= z - 0.4 && player.z <= z + n + 0.4) return bad('player');
    return { ok: true, floorY: hi, x, z };
  }

  /** Assenta a obra (o jogo já ajustou o terreno). */
  placeSite(x: number, z: number, floorY: number): void {
    this.site = { x, z, floorY, parts: [], done: false };
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

  /** o que o jogador gastou na obra (para devolver se o mundo for refeito) */
  spent(): ItemCounts {
    const out: Record<string, number> = {};
    for (const id of this.site?.parts ?? []) for (const [k, n] of Object.entries(partDef(id).cost)) out[k] = (out[k] ?? 0) + (n ?? 0);
    return out as ItemCounts;
  }

  serialize(): GreenhouseSave {
    return { chestOpened: this.chestOpened, site: this.site ? { ...this.site, parts: [...this.site.parts] } : null };
  }
}
