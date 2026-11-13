// Colisão da estufa (docs/design/ESTUFA.md): uma Structure, como a base. O chão nivelado é sólido desde o início; cada peça entregue
// fecha as células dela (paredes, telhado). O vão da porta, no meio do lado sul, fica sempre aberto.
import { GH, type PartId, type SiteSave } from '../data/greenhouse';
import { Cell, Structure } from './Structure';

export function greenhouseStructure(site: SiteSave): Structure {
  const n = GH.size;
  const s = new Structure('greenhouse', {
    x0: site.x, y0: site.floorY, z0: site.z,
    x1: site.x + n - 1, y1: site.floorY + GH.wallHeight + 1, z1: site.z + n - 1,
  });
  applyParts(s, site);
  return s;
}

/** Refaz as células segundo as peças entregues. */
export function applyParts(s: Structure, site: SiteSave): void {
  const n = GH.size, b = s.box;
  for (let y = b.y0; y <= b.y1; y++) for (let z = b.z0; z <= b.z1; z++) for (let x = b.x0; x <= b.x1; x++) s.set(x, y, z, Cell.Air);
  const has = (id: PartId): boolean => site.parts.includes(id);
  const x0 = site.x, z0 = site.z, x1 = x0 + n - 1, z1 = z0 + n - 1, fy = site.floorY;
  // o chão nivelado
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) s.set(x, fy, z, Cell.Floor);
  const wall = (x: number, z: number, door = false): void => {
    for (let y = fy + 1; y <= fy + GH.wallHeight; y++) {
      if (door && y <= fy + 2) continue; // o vão da porta: 2 de altura
      s.set(x, y, z, y === fy + 1 ? Cell.Wall : Cell.WallHigh);
    }
  };
  if (has('wallS')) for (let x = x0; x <= x1; x++) wall(x, z1, x === x0 + GH.doorAt);
  if (has('wallN')) for (let x = x0; x <= x1; x++) wall(x, z0);
  if (has('wallW')) for (let z = z0 + 1; z < z1; z++) wall(x0, z);
  if (has('wallE')) for (let z = z0 + 1; z < z1; z++) wall(x1, z);
  // telhado: a estrutura da cúpula fecha por cima (sem ele, o astronauta pularia para cima das paredes)
  if (has('frame')) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) s.set(x, fy + GH.wallHeight + 1, z, Cell.Roof);
}
