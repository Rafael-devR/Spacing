// Monta a estrutura de colisão de um módulo da base a partir dos dados (data/base.ts) e calcula os pontos
// importantes em coordenadas do mundo (porta, lado de fora e de dentro, frente de cada móvel).
import type { FurnitureDef, ModuleDef, Side } from '../data/base';
import { Cell, Structure } from './Structure';
import type { Terrain } from './terrain';

export interface Point {
  x: number;
  y: number;
  z: number;
}

export interface FurniturePlaced {
  def: FurnitureDef;
  /** centro do móvel no piso */
  center: Point;
  /** onde o astronauta fica para usar o móvel */
  use: Point;
  /** para onde o móvel olha (radianos, como Player.facing) */
  facing: number;
}

export interface ModuleLayout {
  def: ModuleDef;
  structure: Structure;
  /** célula do piso (o astronauta pisa em floorY + 1) */
  floorY: number;
  /** células da porta (x, z) e sua altura (2 blocos a partir de floorY + 1) */
  door: { x: number; z: number; side: Side };
  /** ponto do lado de fora, em frente à porta */
  outside: Point;
  /** ponto do lado de dentro, logo depois da porta */
  inside: Point;
  /** centro do interior no piso */
  center: Point;
  furniture: FurniturePlaced[];
}

const NORMAL: Record<Side, [number, number]> = { north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] };

/** ângulo de Player.facing para olhar na direção (dx, dz) */
const angleOf = (dx: number, dz: number): number => Math.atan2(dx, dz);

export function layoutModule(def: ModuleDef, terrain: Terrain): ModuleLayout {
  const { origin, size, interiorHeight } = def;
  // piso uma célula acima do ponto mais alto do terreno gerado (não depende de edições do jogador)
  let top = 0;
  for (let x = origin.x; x < origin.x + size.x; x++)
    for (let z = origin.z; z < origin.z + size.z; z++) top = Math.max(top, terrain.column(x, z).h);
  const floorY = top + 1;
  const roofY = floorY + interiorHeight + 1;
  const x0 = origin.x,
    z0 = origin.z,
    x1 = origin.x + size.x - 1,
    z1 = origin.z + size.z - 1;
  const s = new Structure(def.id, { x0, y0: floorY, z0, x1, y1: roofY, z1 });

  for (let x = x0; x <= x1; x++)
    for (let z = z0; z <= z1; z++) {
      s.set(x, floorY, z, Cell.Floor);
      s.set(x, roofY, z, Cell.Roof);
      const wall = x === x0 || x === x1 || z === z0 || z === z1;
      if (!wall) continue;
      for (let y = floorY + 1; y < roofY; y++) s.set(x, y, z, y === floorY + 1 ? Cell.Wall : Cell.WallHigh);
    }

  // porta (2 de altura)
  const [nx, nz] = NORMAL[def.door.side];
  const dx = def.door.side === 'west' ? x0 : def.door.side === 'east' ? x1 : x0 + def.door.at;
  const dz = def.door.side === 'north' ? z0 : def.door.side === 'south' ? z1 : z0 + def.door.at;
  s.set(dx, floorY + 1, dz, Cell.Door);
  s.set(dx, floorY + 2, dz, Cell.Door);

  // móveis: 2 de altura, para o astronauta não subir neles
  const furniture: FurniturePlaced[] = def.furniture.map((f) => {
    for (let x = x0 + f.x; x < x0 + f.x + f.w; x++)
      for (let z = z0 + f.z; z < z0 + f.z + f.d; z++) {
        s.set(x, floorY + 1, z, Cell.Furniture);
        s.set(x, floorY + 2, z, Cell.Furniture);
      }
    const [fx, fz] = NORMAL[f.against];
    const cx = x0 + f.x + f.w / 2,
      cz = z0 + f.z + f.d / 2;
    const front = { x: -fx, z: -fz };
    const reach = (front.x !== 0 ? f.w : f.d) / 2 + 0.6;
    return {
      def: f,
      center: { x: cx, y: floorY + 1, z: cz },
      use: { x: cx + front.x * reach, y: floorY + 1, z: cz + front.z * reach },
      facing: angleOf(front.x, front.z),
    };
  });

  return {
    def,
    structure: s,
    floorY,
    door: { x: dx, z: dz, side: def.door.side },
    outside: { x: dx + 0.5 + nx * 1.6, y: floorY + 1, z: dz + 0.5 + nz * 1.6 },
    inside: { x: dx + 0.5 - nx * 1.3, y: floorY + 1, z: dz + 0.5 - nz * 1.3 },
    center: { x: (x0 + x1 + 1) / 2, y: floorY + 1, z: (z0 + z1 + 1) / 2 },
    furniture,
  };
}

/** o ponto está dentro do interior do módulo (entre as paredes, acima do piso) */
export function insideModule(l: ModuleLayout, p: Point): boolean {
  const b = l.structure.box;
  return p.x > b.x0 + 1 && p.x < b.x1 && p.z > b.z0 + 1 && p.z < b.z1 && p.y >= l.floorY + 0.5 && p.y < b.y1;
}
