// Conversão de cores sRGB (hex) para o espaço linear usado nos shaders.

export type RGB = [number, number, number];

export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function hexToLinear(hex: string, mul = 1): RGB {
  const n = parseInt(hex.replace('#', ''), 16);
  return [
    srgbToLinear(((n >> 16) & 255) / 255) * mul,
    srgbToLinear(((n >> 8) & 255) / 255) * mul,
    srgbToLinear((n & 255) / 255) * mul,
  ];
}
