// Definições de blocos e itens. Cores em sRGB (hex) convertidas para linear.

export const AIR = 0;
export const BEDROCK = 1;
export const REGOLITH = 2;
export const ROCK = 3;
export const BASALT = 4;
export const ICE = 5;
export const IRON = 6;
export const CRYSTAL = 7;

function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function hexToLinear(hex, mul = 1) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [
    srgbToLinear(((n >> 16) & 255) / 255) * mul,
    srgbToLinear(((n >> 8) & 255) / 255) * mul,
    srgbToLinear((n & 255) / 255) * mul,
  ];
}

function def(o) {
  const side = o.side || o.color;
  return {
    ...o,
    topL: hexToLinear(o.top || o.color),
    sideL: hexToLinear(side),
    botL: hexToLinear(o.bottom || side, o.bottom ? 1 : 0.8),
    oreL: o.ore ? hexToLinear(o.ore, o.oreMul || 1) : null,
  };
}

// hardness = segundos para quebrar com a ferramenta inicial
export const BLOCKS = [];
BLOCKS[BEDROCK] = def({ name: 'Rocha-mãe', color: '#3d3646', hardness: Infinity, drop: null });
BLOCKS[REGOLITH] = def({ name: 'Regolito', top: '#ddd3c3', color: '#b5a796', bottom: '#9a8d7d', hardness: 0.35, drop: 'regolith' });
BLOCKS[ROCK] = def({ name: 'Rocha lunar', top: '#a39a91', color: '#8f867e', hardness: 0.8, drop: 'rock' });
BLOCKS[BASALT] = def({ name: 'Basalto', top: '#7a7183', color: '#5d5567', hardness: 1.1, drop: 'basalt' });
BLOCKS[ICE] = def({ name: 'Gelo', top: '#e4f6fb', color: '#a6d9ea', hardness: 0.6, drop: 'ice' });
BLOCKS[IRON] = def({ name: 'Ferro', top: '#9c9187', color: '#8a8077', ore: '#e07a38', hardness: 1.4, drop: 'iron' });
BLOCKS[CRYSTAL] = def({ name: 'Cristal', top: '#77708a', color: '#665e78', ore: '#8ff1ff', oreMul: 1.6, hardness: 1.5, drop: 'crystal' });

export const ITEMS = {
  regolith: { name: 'Regolito', block: REGOLITH },
  rock: { name: 'Rocha lunar', block: ROCK },
  basalt: { name: 'Basalto', block: BASALT },
  ice: { name: 'Gelo', block: ICE },
  iron: { name: 'Minério de ferro', icon: { block: IRON } },
  ilmenite: { name: 'Ilmenita', icon: { prop: 'ilmenite' } },
  gold: { name: 'Ouro', icon: { prop: 'gold' } },
  crystal: { name: 'Cristal lunar', icon: { prop: 'crystal' } },
};

export const ITEM_ORDER = ['regolith', 'rock', 'basalt', 'ice', 'iron', 'ilmenite', 'gold', 'crystal'];

// Objetos soltos no chão (pedras e minérios)
export const PROPS = {
  boulder: { name: 'Pedregulho', hardness: 0.9, drop: 'rock', amount: 2 },
  ilmenite: { name: 'Ilmenita', hardness: 1.3, drop: 'ilmenite', amount: 2 },
  gold: { name: 'Ouro', hardness: 1.6, drop: 'gold', amount: 1 },
  crystal: { name: 'Cristal lunar', hardness: 1.2, drop: 'crystal', amount: 2 },
  meteorite: { name: 'Meteorito', hardness: 2.2, drop: 'crystal', amount: 3, bonus: { gold: 2, iron: 2 } },
};

// cores dos destroços de cada objeto (linear)
export const PROP_DEBRIS = {
  boulder: [[0.29, 0.26, 0.23]],
  ilmenite: [[0.045, 0.03, 0.022]],
  gold: [[0.19, 0.14, 0.07], [0.95, 0.5, 0.06]],
  crystal: [[0.14, 0.12, 0.18], [0.4, 1.2, 1.4]],
  meteorite: [[0.03, 0.025, 0.035], [2.2, 0.7, 0.15], [0.4, 1.2, 1.4]],
};
