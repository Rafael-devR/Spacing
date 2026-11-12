// Base lunar como dados (docs/design/BASE.md). A base é feita de módulos; cada módulo é uma caixa com
// paredes, piso, telhado, uma porta com câmara de pressurização e móveis. Crescer a base = acrescentar
// módulos e móveis aqui, sem mudar o código que monta, desenha e colide.

import type { StationId } from './stations';

/** `furnace` e `electrolyzer` são estações (data/stations.ts): o lugar existe desde o início, a máquina é fabricada */
export type FurnitureKind =
  | 'workbench' | 'furnace' | 'electrolyzer' | 'bed' | 'locker' | 'console'
  // só de enfeite (sem botão de usar), mas ocupam lugar como os outros
  | 'shelf' | 'plants' | 'table' | 'tank' | 'crates';

/** móveis que são estações de fabricação */
export const STATION_FURNITURE: Partial<Record<FurnitureKind, StationId>> = {
  workbench: 'workbench',
  furnace: 'furnace',
  electrolyzer: 'electrolyzer',
};

/** lado da parede, visto de cima: north = -z, south = +z, west = -x, east = +x */
export type Side = 'north' | 'south' | 'east' | 'west';

export interface FurnitureDef {
  id: string;
  kind: FurnitureKind;
  /** células ocupadas, em coordenadas locais do módulo (0 = parede oeste/norte) */
  x: number;
  z: number;
  w: number;
  d: number;
  /** lado da parede em que encosta (para onde fica a frente: o lado oposto) */
  against: Side;
}

export interface ModuleDef {
  id: string;
  name: string;
  /** canto mínimo (x, z) da caixa externa, em coordenadas do mundo */
  origin: { x: number; z: number };
  /** tamanho externo em blocos, paredes incluídas */
  size: { x: number; z: number };
  /** altura livre por dentro, em blocos */
  interiorHeight: number;
  /** porta: parede onde fica e posição ao longo dela (local) */
  door: { side: Side; at: number };
  furniture: FurnitureDef[];
}

/**
 * Módulo inicial: um habitat de 9×7 blocos por dentro (11×9 com as paredes), no platô a nordeste do módulo de pouso, com a
 * porta virada para ele. Bancada de fabricação, beliche, armário, console e, na parede leste, os lugares do forno solar e do
 * eletrolisador (as máquinas são fabricadas na bancada; docs/design/CRAFTING.md). Estante, horta, mesa, tanque e caixas são
 * enfeite. O casco e o interior do Blender (tools/models/habitat*.py) são feitos para estas medidas (lib.HAB).
 * Cresceu de 9×7 em 2026-11-12; a porta ficou no mesmo lugar do mundo.
 */
export const HAB_MODULE: ModuleDef = {
  id: 'hab-01',
  name: 'Habitat 01',
  origin: { x: 6, z: -14 },
  size: { x: 11, z: 9 },
  interiorHeight: 3,
  door: { side: 'south', at: 5 },
  furniture: [
    // parede norte (z = 1)
    { id: 'locker', kind: 'locker', x: 1, z: 1, w: 1, d: 1, against: 'north' },
    { id: 'shelf', kind: 'shelf', x: 2, z: 1, w: 1, d: 1, against: 'north' },
    { id: 'workbench', kind: 'workbench', x: 4, z: 1, w: 2, d: 1, against: 'north' },
    { id: 'plants', kind: 'plants', x: 7, z: 1, w: 2, d: 1, against: 'north' },
    // parede oeste
    { id: 'bunk', kind: 'bed', x: 1, z: 3, w: 1, d: 2, against: 'west' },
    // parede leste (x = 9)
    { id: 'console', kind: 'console', x: 9, z: 2, w: 1, d: 1, against: 'east' },
    { id: 'furnace', kind: 'furnace', x: 9, z: 4, w: 1, d: 1, against: 'east' },
    { id: 'electrolyzer', kind: 'electrolyzer', x: 9, z: 5, w: 1, d: 1, against: 'east' },
    { id: 'tank', kind: 'tank', x: 9, z: 7, w: 1, d: 1, against: 'east' },
    // parede sul (z = 7), longe da porta (x = 5)
    { id: 'table', kind: 'table', x: 1, z: 7, w: 2, d: 1, against: 'south' },
    { id: 'crates', kind: 'crates', x: 8, z: 7, w: 1, d: 1, against: 'south' },
  ],
};

/** módulos da base, na ordem em que foram construídos (por enquanto, só o primeiro) */
export const BASE_MODULES: ModuleDef[] = [HAB_MODULE];

export const BASE = {
  /** segundos da sequência da câmara de pressurização */
  airlockSeconds: 2.2,
  /** distância (blocos) para aparecer o botão de usar um móvel ou a porta */
  useRadius: 1.25,
  /** zoom da câmera por dentro */
  insideZoom: 19,
};
