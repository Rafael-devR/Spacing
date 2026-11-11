// Física do espaço para o que não é o astronauta (docs/design/FISICA.md).
// Na Lua não há ar e a gravidade é fraca: pedaços de bloco, lascas e itens que saem de um bloco quebrado
// ficam flutuando e descem devagar. O astronauta tem gravidade própria (entities/Player.ts), pensada para o pulo.

/** gravidade dos pedaços soltos, em blocos por segundo ao quadrado (a gravidade real da Lua é 1,6) */
export const MICROGRAVITY = 0.45;
