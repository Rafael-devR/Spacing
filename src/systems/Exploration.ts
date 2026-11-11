// Mapa descoberto aos poucos (docs/design/MAPA.md). O mundo é dividido em ladrilhos de TILE × TILE blocos; andar
// revela os ladrilhos num raio em volta do astronauta. O mapa do tablet só desenha o que foi revelado.
// Guardado por chunk de 16 blocos: cada chunk tem 4 × 4 ladrilhos, uma máscara de 16 bits.
import type { GameBus } from '../app/events';

/** blocos por lado de um ladrilho do mapa */
export const TILE = 4;
/** raio (em blocos) que o astronauta descobre em volta de si */
export const REVEAL_RADIUS = 22;
/** blocos por lado de um chunk do mapa (o mesmo do mundo) */
export const MAP_CHUNK = 16;
const PER = MAP_CHUNK / TILE;

/** "cx,cz" → máscara de 16 bits dos ladrilhos revelados */
export type ExplorationSave = Record<string, number>;

export class Exploration {
  private readonly masks = new Map<string, number>();
  /** quantos ladrilhos foram revelados */
  revealed = 0;

  constructor(
    private readonly events?: GameBus,
    saved: ExplorationSave | null = null,
  ) {
    if (saved)
      for (const [k, m] of Object.entries(saved)) {
        const mask = m & 0xffff;
        if (!mask) continue;
        this.masks.set(k, mask);
        this.revealed += bits(mask);
      }
  }

  /** o ladrilho (tx, tz) já foi visto */
  tile(tx: number, tz: number): boolean {
    const cx = Math.floor(tx / PER), cz = Math.floor(tz / PER);
    const m = this.masks.get(cx + ',' + cz) ?? 0;
    return (m & (1 << bit(tx, tz))) !== 0;
  }

  /** o bloco (x, z) fica num ladrilho já visto */
  at(x: number, z: number): boolean {
    return this.tile(Math.floor(x / TILE), Math.floor(z / TILE));
  }

  /** máscara do chunk do mapa (0 = nada visto) */
  chunkMask(cx: number, cz: number): number {
    return this.masks.get(cx + ',' + cz) ?? 0;
  }

  /** chunks com algo visto, como [cx, cz] */
  chunks(): [number, number][] {
    return [...this.masks.keys()].map((k) => k.split(',').map(Number) as [number, number]);
  }

  /**
   * Revela os ladrilhos cujo centro está a até `radius` blocos de (x, z). Devolve quantos eram novos e avisa
   * (`map:revealed`) com os chunks que mudaram.
   */
  revealAround(x: number, z: number, radius = REVEAL_RADIUS): number {
    const t0x = Math.floor((x - radius) / TILE), t1x = Math.floor((x + radius) / TILE);
    const t0z = Math.floor((z - radius) / TILE), t1z = Math.floor((z + radius) / TILE);
    const changed = new Set<string>();
    let n = 0;
    const r2 = radius * radius;
    for (let tz = t0z; tz <= t1z; tz++)
      for (let tx = t0x; tx <= t1x; tx++) {
        const dx = tx * TILE + TILE / 2 - x, dz = tz * TILE + TILE / 2 - z;
        if (dx * dx + dz * dz > r2) continue;
        const cx = Math.floor(tx / PER), cz = Math.floor(tz / PER);
        const k = cx + ',' + cz;
        const m = this.masks.get(k) ?? 0;
        const b = 1 << bit(tx, tz);
        if (m & b) continue;
        this.masks.set(k, m | b);
        changed.add(k);
        n++;
      }
    if (n) {
      this.revealed += n;
      this.events?.emit('map:revealed', { chunks: [...changed] });
    }
    return n;
  }

  serialize(): ExplorationSave {
    return Object.fromEntries(this.masks);
  }
}

function bit(tx: number, tz: number): number {
  const lx = ((tx % PER) + PER) % PER, lz = ((tz % PER) + PER) % PER;
  return lz * PER + lx;
}

function bits(m: number): number {
  let n = 0;
  for (; m; m &= m - 1) n++;
  return n;
}
