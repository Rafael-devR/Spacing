// Ajustes gráficos manuais (docs/design/GRAFICOS.md): o jogador escolhe uma qualidade (Baixa, Média, Alta ou
// Automática) e pode trocar cada item por cima dela. Tudo aqui é puro (sem WebGL): o que fica em branco segue o preset.
import type { QualityPreset } from './post';

/** resolução do desenho: multiplica os pixels da tela em CSS; 'native' = a densidade real da tela do aparelho */
export type ResolutionChoice = 0.5 | 0.75 | 1 | 1.25 | 1.5 | 2 | 'native';
export const RESOLUTION_CHOICES: readonly ResolutionChoice[] = [0.5, 0.75, 1, 1.25, 1.5, 2, 'native'];

export type MsaaChoice = 0 | 2 | 4;
export const MSAA_CHOICES: readonly MsaaChoice[] = [0, 2, 4];

/** tamanho do mapa de sombras; 0 = sem sombra */
export type ShadowChoice = 0 | 1024 | 2048 | 4096;
export const SHADOW_CHOICES: readonly ShadowChoice[] = [0, 1024, 2048, 4096];

/** limite de quadros por segundo; 0 = sem limite */
export type FpsCapChoice = 0 | 30 | 60 | 90 | 120;
export const FPS_CAP_CHOICES: readonly FpsCapChoice[] = [0, 30, 60, 90, 120];

/** Trocas do jogador por cima do preset. Campo ausente = segue o preset (ou, nos efeitos, fica ligado). */
export interface GfxOverrides {
  resolution?: ResolutionChoice;
  msaa?: MsaaChoice;
  shadow?: ShadowChoice;
  bloom?: boolean;
  chromatic?: boolean;
  vignette?: boolean;
  noise?: boolean;
  /** brilho dos cristais e do que brilha no terreno */
  glow?: boolean;
  fpsCap?: FpsCapChoice;
  /** contador de FPS no canto da tela */
  showFps?: boolean;
}

export const GFX_KEYS = ['resolution', 'msaa', 'shadow', 'bloom', 'chromatic', 'vignette', 'noise', 'glow', 'fpsCap', 'showFps'] as const;

/** valor que 'native' vira no preset: o Post limita à densidade real da tela e ao tamanho máximo de textura */
export const NATIVE_PIXEL_RATIO = 99;

/** O preset com as trocas do jogador aplicadas. */
export function resolveQuality(preset: QualityPreset, g: GfxOverrides | undefined): QualityPreset {
  const out = { ...preset };
  if (!g) return out;
  if (g.resolution !== undefined) out.pixelRatio = g.resolution === 'native' ? NATIVE_PIXEL_RATIO : g.resolution;
  if (g.msaa !== undefined) out.samples = g.msaa;
  if (g.shadow !== undefined) out.shadow = g.shadow;
  if (g.bloom !== undefined) out.bloom = g.bloom;
  if (g.chromatic !== undefined) out.chromatic = g.chromatic;
  if (g.vignette !== undefined) out.vignette = g.vignette;
  if (g.noise !== undefined) out.noise = g.noise;
  return out;
}

function pick<T>(list: readonly T[], v: unknown): T | undefined {
  return list.includes(v as T) ? (v as T) : undefined;
}

/** Lê as trocas guardadas, descartando o que não for válido. */
export function parseGfx(raw: unknown): GfxOverrides {
  const g: GfxOverrides = {};
  if (typeof raw !== 'object' || raw === null) return g;
  const r = raw as Record<string, unknown>;
  const resolution = pick(RESOLUTION_CHOICES, r.resolution);
  if (resolution !== undefined) g.resolution = resolution;
  const msaa = pick(MSAA_CHOICES, r.msaa);
  if (msaa !== undefined) g.msaa = msaa;
  const shadow = pick(SHADOW_CHOICES, r.shadow);
  if (shadow !== undefined) g.shadow = shadow;
  const fpsCap = pick(FPS_CAP_CHOICES, r.fpsCap);
  if (fpsCap !== undefined) g.fpsCap = fpsCap;
  for (const k of ['bloom', 'chromatic', 'vignette', 'noise', 'glow', 'showFps'] as const) {
    if (typeof r[k] === 'boolean') g[k] = r[k] as boolean;
  }
  return g;
}

/** quantas trocas o jogador tem hoje */
export function gfxCount(g: GfxOverrides | undefined): number {
  return g ? GFX_KEYS.filter((k) => g[k] !== undefined).length : 0;
}

/** tamanho do desenho em pixels, para mostrar no menu (limitado pela densidade da tela e pela textura máxima) */
export function drawSize(cssW: number, cssH: number, pixelRatio: number, devicePixelRatio: number, maxTexture: number, scale = 1): [number, number] {
  let pr = Math.min(devicePixelRatio, pixelRatio) * scale;
  pr = Math.min(pr, maxTexture / Math.max(cssW, cssH));
  return [Math.round(cssW * pr), Math.round(cssH * pr)];
}
