// Gera a malha de um chunk: só faces visíveis, oclusão ambiente por vértice,
// variação de cor por bloco e "pepitas" de minério saindo das faces.
import { hash3 } from '../core/noise';
import type { RGB } from '../core/color';
import type { BlockId } from '../data/blocks';
import { BLOCKS } from './registry';

type V3 = [number, number, number];

interface Face {
  dir: V3;
  c: V3[];
  /** eixo da normal (0 = x, 1 = y, 2 = z) e os dois eixos do plano da face */
  axis: number;
  u: number;
  v: number;
}

export interface MeshArrays {
  position: Float32Array;
  normal: Float32Array;
  color: Float32Array;
  /** coordenada da face (0..1) para o brilho de borda; 0.5 = sem borda */
  edge: Float32Array;
  /** luz do céu (0 = escuro, 1 = céu aberto), suavizada por vértice */
  sky: Float32Array;
}

// Cantos de cada face: 0,1 embaixo; 2,3 em cima (mesma ordem em todas as faces).
const FACE_DEFS: { dir: V3; c: V3[] }[] = [
  { dir: [-1, 0, 0], c: [[0, 1, 0], [0, 0, 0], [0, 1, 1], [0, 0, 1]] },
  { dir: [1, 0, 0], c: [[1, 1, 1], [1, 0, 1], [1, 1, 0], [1, 0, 0]] },
  { dir: [0, -1, 0], c: [[1, 0, 1], [0, 0, 1], [1, 0, 0], [0, 0, 0]] },
  { dir: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [0, 1, 0], [1, 1, 0]] },
  { dir: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [1, 1, 0], [0, 1, 0]] },
  { dir: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]] },
];
const FACES: Face[] = FACE_DEFS.map((f) => {
  const axis = f.dir[0] ? 0 : f.dir[1] ? 1 : 2;
  return { ...f, axis, u: axis === 0 ? 1 : 0, v: axis === 2 ? 1 : 2 };
});

const AO = [0.48, 0.66, 0.83, 1];
/** níveis da luz do céu (igual a SKY_MAX em World.ts) */
export const SKY_LEVELS = 12;
/** nível (em quartos) → fator de luz: cai devagar perto da abertura e depressa no fundo */
const SKY_CURVE = Float32Array.from({ length: SKY_LEVELS * 4 + 1 }, (_, i) => Math.pow(i / (SKY_LEVELS * 4), 1.5));

/**
 * pad: blocos com 1 de margem em x e z: índice (x+1) + (z+1)*(w+2) + y*(w+2)*(d+2)
 * ox, oz: origem do chunk no mundo (para variação de cor determinística)
 */
export function meshPadded(
  pad: Uint8Array,
  w: number,
  d: number,
  h: number,
  maxY: number,
  ox: number,
  oz: number,
  belowSolid = true,
  /** luz do céu por bloco (0..SKY_LEVELS), no mesmo formato de `pad`; sem ela, tudo é céu aberto */
  light: Uint8Array | null = null,
): MeshArrays {
  const PW = w + 2, PL = (w + 2) * (d + 2);
  const at = (x: number, y: number, z: number): number => {
    if (y < 0) return belowSolid ? 1 : 0;
    if (y >= h) return 0;
    return pad[x + 1 + (z + 1) * PW + y * PL];
  };
  const lightAt = (x: number, y: number, z: number): number => (!light || y >= h ? SKY_LEVELS : y < 0 ? 0 : light[x + 1 + (z + 1) * PW + y * PL]);
  const pos: number[] = [], nor: number[] = [], col: number[] = [], edg: number[] = [], sky: number[] = [];
  const sk = [1, 1, 1, 1];
  const p: V3 = [0, 0, 0], q: V3 = [0, 0, 0];
  const top = Math.min(maxY, h - 1);

  for (let y = 0; y <= top; y++) {
    for (let z = 0; z < d; z++) {
      for (let x = 0; x < w; x++) {
        const id = at(x, y, z);
        if (!id) continue;
        const def = BLOCKS[id];
        const wx = ox + x, wz = oz + z;
        const vary = 0.93 + 0.12 * hash3(wx, y, wz, 9);
        for (let fi = 0; fi < 6; fi++) {
          const f = FACES[fi];
          const [nx, ny, nz] = f.dir;
          if (at(x + nx, y + ny, z + nz)) continue;
          const base = ny === 1 ? def.topL : ny === -1 ? def.botL : def.sideL;
          // oclusão por canto
          const ao = [0, 0, 0, 0];
          for (let k = 0; k < 4; k++) {
            const c = f.c[k];
            const du = c[f.u] ? 1 : -1, dv = c[f.v] ? 1 : -1;
            p[0] = x + nx; p[1] = y + ny; p[2] = z + nz;
            q[0] = p[0]; q[1] = p[1]; q[2] = p[2];
            // luz do céu do vértice: média dos blocos vazios que o tocam (os mesmos da oclusão)
            let ls = lightAt(p[0], p[1], p[2]), ln = 1;
            q[f.u] += du;
            const s1 = at(q[0], q[1], q[2]) ? 1 : 0;
            if (!s1) { ls += lightAt(q[0], q[1], q[2]); ln++; }
            q[f.u] -= du; q[f.v] += dv;
            const s2 = at(q[0], q[1], q[2]) ? 1 : 0;
            if (!s2) { ls += lightAt(q[0], q[1], q[2]); ln++; }
            q[f.u] += du;
            const cr = at(q[0], q[1], q[2]) ? 1 : 0;
            if (!cr && !(s1 && s2)) { ls += lightAt(q[0], q[1], q[2]); ln++; }
            ao[k] = s1 && s2 ? 0 : 3 - (s1 + s2 + cr);
            sk[k] = SKY_CURVE[Math.round((ls / ln) * 4)];
          }
          const order = ao[1] + ao[2] < ao[0] + ao[3] ? [0, 1, 3, 0, 3, 2] : [0, 1, 2, 2, 1, 3];
          const fv = vary * (0.97 + 0.06 * hash3(wx, y, wz, 20 + fi));
          for (const k of order) {
            const c = f.c[k];
            pos.push(x + c[0], y + c[1], z + c[2]);
            nor.push(nx, ny, nz);
            const b = AO[ao[k]] * fv;
            col.push(base[0] * b, base[1] * b, base[2] * b);
            edg.push(c[f.u], c[f.v]);
            sky.push(sk[k]);
          }
          if (def.oreL && ny !== -1) {
            const n0 = pos.length;
            addNuggets(pos, nor, col, edg, def.oreL, f, x, y, z, wx, wz, fi);
            const s = (sk[0] + sk[1] + sk[2] + sk[3]) / 4;
            for (let i = n0; i < pos.length; i += 3) sky.push(s);
          }
        }
      }
    }
  }
  return {
    position: new Float32Array(pos),
    normal: new Float32Array(nor),
    color: new Float32Array(col),
    edge: new Float32Array(edg),
    sky: new Float32Array(sky),
  };
}

function addNuggets(
  pos: number[],
  nor: number[],
  col: number[],
  edg: number[],
  ore: RGB,
  f: Face,
  x: number,
  y: number,
  z: number,
  wx: number,
  wz: number,
  fi: number,
): void {
  const n = f.dir;
  const count = 1 + (hash3(wx, y, wz, 40 + fi) > 0.35 ? 1 : 0) + (hash3(wx, y, wz, 50 + fi) > 0.8 ? 1 : 0);
  for (let k = 0; k < count; k++) {
    const r = (s: number): number => hash3(wx * 3 + k, y * 7 + fi, wz * 5, s);
    const hu = 0.22 + 0.56 * r(11);
    const hv = 0.22 + 0.56 * r(12);
    const size = 0.1 + 0.09 * r(13);
    const ang = r(14) * Math.PI;
    // ponto na face
    const P: V3 = [x, y, z];
    if (n[f.axis] > 0) P[f.axis] += 1;
    P[f.u] += hu;
    P[f.v] += hv;
    const base: V3[] = [];
    for (let i = 0; i < 4; i++) {
      const a = ang + (i * Math.PI) / 2;
      const b: V3 = [P[0], P[1], P[2]];
      b[f.u] += Math.cos(a) * size;
      b[f.v] += Math.sin(a) * size;
      b[f.axis] -= n[f.axis] * 0.04;
      base.push(b);
    }
    const apex: V3 = [P[0], P[1], P[2]];
    apex[f.axis] += n[f.axis] * size * 1.15;
    apex[f.u] += (r(15) - 0.5) * size * 0.6;
    apex[f.v] += (r(16) - 0.5) * size * 0.6;
    const center = [P[0] + n[0] * size * 0.3, P[1] + n[1] * size * 0.3, P[2] + n[2] * size * 0.3];
    const shade = 0.88 + 0.24 * r(17);
    for (let i = 0; i < 4; i++) {
      let a = base[i], b = base[(i + 1) % 4];
      let nn = triNormal(a, b, apex);
      const cx = (a[0] + b[0] + apex[0]) / 3 - center[0];
      const cy = (a[1] + b[1] + apex[1]) / 3 - center[1];
      const cz = (a[2] + b[2] + apex[2]) / 3 - center[2];
      if (nn[0] * cx + nn[1] * cy + nn[2] * cz < 0) {
        const t = a; a = b; b = t;
        nn = [-nn[0], -nn[1], -nn[2]];
      }
      const facet = shade * (0.92 + 0.16 * r(30 + i));
      for (const v of [a, b, apex]) {
        pos.push(v[0], v[1], v[2]);
        nor.push(nn[0], nn[1], nn[2]);
        col.push(ore[0] * facet, ore[1] * facet, ore[2] * facet);
        edg.push(0.5, 0.5);
      }
    }
  }
}

function triNormal(a: V3, b: V3, c: V3): V3 {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

// Malha de um único bloco (ícones e itens soltos)
export function meshSingle(id: BlockId): MeshArrays {
  const pad = new Uint8Array(9);
  pad[4] = id;
  return meshPadded(pad, 1, 1, 1, 0, 0, 0, false);
}
