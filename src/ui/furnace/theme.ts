// Cores e letras da tela do forno, na direção de arte do Spacing (docs/ART_DIRECTION.md, docs/design/FORNO.md): cartoon, formas
// arredondadas e chapadas, neutros com leve tom roxo, laranja do traje e ciano do gelo como acentos. Cores em número (Pixi).

export const FONT_TITLE = 'Fredoka, "Trebuchet MS", system-ui, sans-serif';
export const FONT_UI = 'Rubik, system-ui, -apple-system, "Segoe UI", sans-serif';

export const C = {
  bg: 0x120f26,
  bgGrid: 0x1a1536,
  /** painéis (um tom acima do fundo) */
  panel: 0x1d1743,
  panelHi: 0x2a2360,
  panelLine: 0x40378a,
  /** sombra chapada embaixo de tudo que aperta */
  shadow: 0x0a0818,
  ink: 0xf4f0e8,
  dim: 0xb4aed4,
  faint: 0x756ea6,
  /** acentos */
  orange: 0xff8a3d,
  suit: 0xff7a2f,
  ice: 0x7fe7ff,
  ok: 0x6dffb0,
  warn: 0xff9a85,
  gold: 0xffcf5a,
  /** metal do forno (neutro roxo-acinzentado) */
  metal: 0x4a4470,
  metalHi: 0x6a6396,
  metalLo: 0x2c2750,
  /** vidro dos visores e câmara */
  chamber: 0x0d0a1c,
} as const;

/** '#rrggbb' → número */
export const hexNum = (hex: string): number => parseInt(hex.replace('#', ''), 16);

/** mistura duas cores (t de 0 a 1) */
export function mix(a: number, b: number, t: number): number {
  const k = Math.max(0, Math.min(1, t));
  const r = ((a >> 16) & 255) + (((b >> 16) & 255) - ((a >> 16) & 255)) * k;
  const g = ((a >> 8) & 255) + (((b >> 8) & 255) - ((a >> 8) & 255)) * k;
  const bl = (a & 255) + ((b & 255) - (a & 255)) * k;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
}

/** mais claro (t > 0) ou mais escuro (t < 0) */
export const shade = (c: number, t: number): number => (t >= 0 ? mix(c, 0xffffff, t) : mix(c, 0x000000, -t));
