// Poeira dos pés do astronauta (docs/design/PERSONAGEM.md, "Poeira"). Antes eram uns cubinhos cinza iguais em qualquer chão,
// até dentro da base. Agora:
//   - a cor vem do bloco pisado (regolito claro, poeira de Marte avermelhada, areia escura...);
//   - só levanta poeira de chão solto: metal, gelo, rocha vítrea e o piso da base não soltam nada;
//   - cada passo chuta uma nuvem macia para trás (baforadas de render/puffs.ts) e umas pedrinhas que voam em arco e caem
//     devagar na gravidade baixa (cubinhos de render/particles.ts);
//   - correndo, a nuvem é maior e vai mais longe; o pouso abre um anel no chão; o pulo solta um sopro para baixo.
// Quem chama decide se está ao ar livre (dentro da base e da estufa não há poeira).
import { hexToLinear, type RGB } from '../core/color';
import {
  ANORTHOSITE, BASALT, BRECCIA, DARK_SAND, MARS_DUST, MARS_ROCK, REGOLITH, ROCK, SEDIMENT, VOLCANIC, BLOCK_DATA, type BlockId,
} from '../data/blocks';
import type { Particles } from './particles';
import type { Puffs } from './puffs';

/** quanta poeira cada chão solta (0 a 1); o que não está aqui não solta nada */
export const DUSTY: ReadonlyMap<BlockId, number> = new Map([
  [REGOLITH, 1], [MARS_DUST, 1], [DARK_SAND, 0.9], [SEDIMENT, 0.6], [BRECCIA, 0.55],
  [ROCK, 0.4], [ANORTHOSITE, 0.4], [MARS_ROCK, 0.45], [BASALT, 0.3], [VOLCANIC, 0.35],
]);

export interface Dust {
  amount: number;
  /** cor da nuvem (linear) */
  cloud: RGB;
  /** cor das pedrinhas (linear, mais escura) */
  grit: RGB;
}

const cache = new Map<BlockId, Dust | null>();

/** A poeira de um chão, ou null se ele não solta poeira. */
export function dustOf(block: BlockId): Dust | null {
  if (cache.has(block)) return cache.get(block) ?? null;
  const amount = DUSTY.get(block) ?? 0;
  let d: Dust | null = null;
  if (amount > 0) {
    const b = BLOCK_DATA[block];
    // a nuvem tem a cor da lateral do bloco, um pouco mais escura que o topo iluminado: assim aparece contra o chão claro da Lua
    // (com a cor do topo ela some); as pedrinhas são ainda mais escuras
    d = { amount, cloud: hexToLinear(b.color, 0.95), grit: hexToLinear(b.bottom ?? b.color, 0.8) };
  }
  cache.set(block, d);
  return d;
}

const rnd = (a: number, b: number): number => a + Math.random() * (b - a);

export class DustFx {
  constructor(
    private readonly puffs: Puffs,
    private readonly particles: Particles,
    /** gravidade do planeta (blocos/s²): as pedrinhas caem nela */
    private readonly gravity: number,
  ) {}

  /**
   * Um passo: (x, y, z) é o pé no chão; (vx, vz) a velocidade do astronauta. `run` de 0 (andando) a 1 (correndo).
   */
  step(x: number, y: number, z: number, vx: number, vz: number, d: Dust, run: number): void {
    const sp = Math.hypot(vx, vz) || 1;
    const bx = -vx / sp, bz = -vz / sp; // para trás
    const n = Math.round((1 + run * 2) * (0.6 + d.amount * 0.6));
    for (let i = 0; i < n; i++) {
      const kick = rnd(0.5, 1.1) * (0.7 + run * 0.9);
      const side = rnd(-0.45, 0.45);
      this.puffs.spawn('smoke', {
        x: x + bx * 0.12 + rnd(-0.08, 0.08), y: y + rnd(0.04, 0.12), z: z + bz * 0.12 + rnd(-0.08, 0.08),
        vx: (bx - bz * side) * kick, vy: rnd(0.25, 0.55) * (0.8 + run * 0.6), vz: (bz + bx * side) * kick,
        size: rnd(0.18, 0.3) * (0.85 + run * 0.4), growTo: rnd(2.2, 3.2), life: rnd(0.9, 1.5) + run * 0.5,
        from: d.cloud, alpha: (0.42 + run * 0.2) * d.amount, drag: 2.4, gravity: 0.12,
      });
    }
    // pedrinhas: voam em arco para trás e caem devagar
    const g = Math.round((run > 0.4 ? 3 : 1) * d.amount + Math.random() * 0.8);
    for (let i = 0; i < g; i++) {
      const kick = rnd(0.8, 1.6) * (0.6 + run);
      const side = rnd(-0.6, 0.6);
      this.particles.spawn(x + rnd(-0.05, 0.05), y + 0.05, z + rnd(-0.05, 0.05),
        (bx - bz * side) * kick, rnd(0.8, 1.8) * (0.7 + run * 0.5), (bz + bx * side) * kick,
        rnd(0.035, 0.06), d.grit, rnd(0.6, 1.0), this.gravity * 0.7);
    }
  }

  /** Pouso: um anel de poeira que corre pelo chão. `impact` de 0 a 1. */
  land(x: number, y: number, z: number, d: Dust, impact: number): void {
    const n = Math.round(6 + impact * 8);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd(-0.2, 0.2);
      const v = rnd(1.0, 1.8) * (0.7 + impact);
      this.puffs.spawn('smoke', {
        x: x + Math.cos(a) * 0.2, y: y + 0.06, z: z + Math.sin(a) * 0.2,
        vx: Math.cos(a) * v, vy: rnd(0.1, 0.35), vz: Math.sin(a) * v,
        size: rnd(0.22, 0.34), growTo: rnd(2.4, 3.4), life: rnd(1.1, 1.8),
        from: d.cloud, alpha: (0.35 + impact * 0.2) * d.amount, drag: 2.2, gravity: 0.1,
      });
    }
    for (let i = 0; i < 3 + impact * 5; i++) {
      const a = Math.random() * Math.PI * 2, v = rnd(0.8, 2);
      this.particles.spawn(x, y + 0.05, z, Math.cos(a) * v, rnd(1, 2.4), Math.sin(a) * v, rnd(0.035, 0.065), d.grit,
        rnd(0.7, 1.1), this.gravity * 0.7);
    }
  }

  /** Pulo: um sopro que sai dos pés para os lados. */
  jump(x: number, y: number, z: number, d: Dust): void {
    for (let i = 0; i < 5; i++) {
      const a = Math.random() * Math.PI * 2, v = rnd(0.5, 1.0);
      this.puffs.spawn('smoke', {
        x, y: y + 0.05, z, vx: Math.cos(a) * v, vy: rnd(0.05, 0.25), vz: Math.sin(a) * v,
        size: rnd(0.2, 0.3), growTo: rnd(2, 2.8), life: rnd(0.8, 1.2),
        from: d.cloud, alpha: 0.3 * d.amount, drag: 2.5, gravity: 0.1,
      });
    }
  }
}
