// Base lunar como dados (docs/design/BASE.md). A base é feita de módulos; cada módulo é uma caixa com
// paredes, piso, telhado, uma porta com câmara de pressurização e móveis. Crescer a base = acrescentar
// módulos e móveis aqui, sem mudar o código que monta, desenha e colide.

export type FurnitureKind = 'workbench' | 'bed' | 'locker' | 'console';

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
 * Módulo inicial: um habitat de 7×5 blocos por dentro, no platô a nordeste do módulo de pouso, com a porta
 * virada para ele. Bancada de fabricação, beliche, armário e console.
 */
export const HAB_MODULE: ModuleDef = {
  id: 'hab-01',
  name: 'Habitat 01',
  origin: { x: 7, z: -12 },
  size: { x: 9, z: 7 },
  interiorHeight: 3,
  door: { side: 'south', at: 4 },
  furniture: [
    { id: 'workbench', kind: 'workbench', x: 3, z: 1, w: 2, d: 1, against: 'north' },
    { id: 'bunk', kind: 'bed', x: 1, z: 2, w: 1, d: 2, against: 'west' },
    { id: 'locker', kind: 'locker', x: 1, z: 1, w: 1, d: 1, against: 'north' },
    { id: 'console', kind: 'console', x: 7, z: 1, w: 1, d: 1, against: 'east' },
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
  insideZoom: 17,
};
