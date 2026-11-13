// Cores e letras da tela do forno: interface de nave, não brinquedo (docs/design/FORNO.md, ADR 0018). Fundo quase preto com grade
// fina, linhas de 1 px azul-petróleo, dados em fonte técnica, cantos chanfrados. O laranja fica só para o calor e o verde só para
// "pronto"; o resto é neutro e frio. Cores em número (Pixi).

export const FONT_TITLE = '"Chakra Petch", "JetBrains Mono", ui-monospace, "Segoe UI", sans-serif';
export const FONT_UI = '"JetBrains Mono", ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace';

export const C = {
  bg: 0x04070b,
  bgGrid: 0x0a1118,
  /** painéis (um tom acima do fundo) */
  panel: 0x08111a,
  panelHi: 0x0e1a26,
  panelLine: 0x1d3a4a,
  /** sombra (usada só para escurecer) */
  shadow: 0x02040a,
  ink: 0xdce9ee,
  dim: 0x8aa3ae,
  faint: 0x4e6672,
  /** acentos */
  orange: 0xf0933a,
  suit: 0xf0933a,
  ice: 0x59d4e6,
  ok: 0x4fdc9a,
  warn: 0xe8604c,
  gold: 0xe6b84a,
  /** metal do forno (cinza-azulado escuro) */
  metal: 0x101c27,
  metalHi: 0x2f5366,
  metalLo: 0x0a131c,
  /** vidro dos visores e câmara */
  chamber: 0x05090e,
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
