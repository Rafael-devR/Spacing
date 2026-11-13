// Plataforma plana da base (docs/design/BASE.md). O terreno em volta da base varia com a semente (de 0 a 4 blocos de desnível),
// e o degrau da porta era uma caixa fixa, sem colisão, que ficava flutuando. Agora o gerador (Lua e Marte) nivela uma
// plataforma sob a base, com uma faixa plana em frente à porta, e constrói o degrau com blocos de verdade: uma sacada de
// 3×2 blocos, um bloco acima da plataforma, rente ao piso. Tudo é calculado só com a semente e os dados da base, então o
// worker dos chunks e o resto do jogo chegam às mesmas alturas.
import { HAB_MODULE } from '../data/base';

export const PAD = {
  /** blocos de folga em volta da base que ficam exatamente na altura da plataforma */
  margin: 2,
  /** de lá para fora, o terreno volta ao natural em tantos blocos (suave) */
  blend: 8,
  /** a faixa plana em frente à porta, além da folga, para o astronauta chegar andando */
  apron: 6,
} as const;

const o = HAB_MODULE.origin, s = HAB_MODULE.size, door = HAB_MODULE.door;
const x0 = o.x, z0 = o.z, x1 = o.x + s.x - 1, z1 = o.z + s.z - 1;

/** a célula da porta, na parede, e para onde ela dá (sentido para fora) */
const NORMAL = { north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] } as const;
const [nx, nz] = NORMAL[door.side];
const along = door.side === 'north' || door.side === 'south' ? 'x' : 'z';
const doorX = along === 'x' ? o.x + door.at : door.side === 'west' ? x0 : x1;
const doorZ = along === 'z' ? o.z + door.at : door.side === 'north' ? z0 : z1;

/** o retângulo plano: a base mais a folga e, do lado da porta, a faixa de chegada */
const flat = {
  x0: x0 - PAD.margin - (nx < 0 ? PAD.apron : 0),
  x1: x1 + PAD.margin + (nx > 0 ? PAD.apron : 0),
  z0: z0 - PAD.margin - (nz < 0 ? PAD.apron : 0),
  z1: z1 + PAD.margin + (nz > 0 ? PAD.apron : 0),
};

const smooth = (t: number): number => {
  const k = Math.max(0, Math.min(1, t));
  return k * k * (3 - 2 * k);
};

/** quanto o terreno é puxado para a plataforma: 1 na área plana, 0 além da transição */
export function padWeight(x: number, z: number): number {
  const dx = Math.max(flat.x0 - x, 0, x - flat.x1);
  const dz = Math.max(flat.z0 - z, 0, z - flat.z1);
  return 1 - smooth(Math.hypot(dx, dz) / PAD.blend);
}

/** a coluna (x, z) é a sacada do degrau? (3 de largura, 2 de fundo, logo depois da porta) */
export function isLanding(x: number, z: number): boolean {
  const lateral = along === 'x' ? Math.abs(x - doorX) : Math.abs(z - doorZ);
  const out = (x - doorX) * nx + (z - doorZ) * nz; // 1 = a primeira fileira depois da parede
  return lateral <= 1 && out >= 1 && out <= 2;
}

/** a coluna está sob a plataforma ou em volta dela? (nada de pedra solta ali) */
export function inPad(x: number, z: number): boolean {
  return padWeight(x, z) > 0;
}

/**
 * Aplica a plataforma à altura natural `h` da coluna. `padH` é a altura da plataforma (a do planalto do pouso). Na sacada a
 * coluna sobe um bloco, para ficar rente ao piso da base.
 */
export function applyBasePad(h: number, x: number, z: number, padH: number): number {
  const w = padWeight(x, z);
  if (w <= 0) return h;
  if (isLanding(x, z)) return padH + 1;
  if (w >= 1) return padH; // exato (sem erro de arredondamento que derrube um bloco no Math.floor)
  return h + (padH - h) * w;
}
