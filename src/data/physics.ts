// Física do espaço para o que não é o astronauta (docs/design/FISICA.md).
// Na Lua não há ar e a gravidade é fraca: pedaços de bloco, lascas e itens que saem de um bloco quebrado
// ficam flutuando e descem devagar. O astronauta tem gravidade própria (entities/Player.ts), pensada para o pulo.

import { PLANET } from '../core/planet';

/** gravidade dos pedaços soltos, em blocos por segundo ao quadrado (Lua 0,45: flutuam; Marte cai de verdade) */
export const MICROGRAVITY = PLANET.physics.debrisGravity;
/** freio do ar nos pedaços, por segundo (0 na Lua) */
export const AIR_DRAG = PLANET.physics.debrisDrag;
