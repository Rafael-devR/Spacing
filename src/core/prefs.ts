// Preferências do jogador (gráficos, som, tremor, vibração, toque e tela), salvas separadas do jogo.
import { parseGfx, type GfxOverrides } from '../render/graphics';
import { isQualityName, type QualityName } from '../render/post';
import { PREFS_KEY, readJSON, writeJSON, type KeyValueStore } from './save';

export type ShakeLevel = 'off' | 'low' | 'normal';
/** onde fica a mira ao segurar o dedo no mundo: acima do dedo (padrão) ou embaixo dele */
export type TouchAim = 'offset' | 'finger';
/** paisagem = trava a tela deitada quando entra em tela cheia; livre = segue o celular */
export type OrientationPref = 'landscape' | 'free';

export interface Prefs {
  /** ausente = automático (o jogo escolhe e pode reduzir sozinho) */
  quality?: QualityName;
  /** trocas manuais por cima da qualidade (resolução, MSAA, sombra, efeitos, limite de FPS…); vazio = segue o preset */
  gfx: GfxOverrides;
  muted: boolean;
  shake: ShakeLevel;
  vibration: boolean;
  touchAim: TouchAim;
  /** entrar em tela cheia ao tocar (celular) */
  fullscreen: boolean;
  orientation: OrientationPref;
}

export const SHAKE_SCALE: Record<ShakeLevel, number> = { off: 0, low: 0.45, normal: 1 };

export function defaultPrefs(): Prefs {
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  return { gfx: {}, muted: false, shake: reduced ? 'low' : 'normal', vibration: true, touchAim: 'offset', fullscreen: true, orientation: 'landscape' };
}

export function loadPrefs(store: KeyValueStore | null): Prefs {
  const p = defaultPrefs();
  const raw = readJSON(store, PREFS_KEY);
  if (typeof raw !== 'object' || raw === null) return p;
  const r = raw as Record<string, unknown>;
  if (isQualityName(r.quality)) p.quality = r.quality;
  p.gfx = parseGfx(r.gfx);
  if (typeof r.muted === 'boolean') p.muted = r.muted;
  if (r.shake === 'off' || r.shake === 'low' || r.shake === 'normal') p.shake = r.shake;
  if (typeof r.vibration === 'boolean') p.vibration = r.vibration;
  if (r.touchAim === 'offset' || r.touchAim === 'finger') p.touchAim = r.touchAim;
  if (typeof r.fullscreen === 'boolean') p.fullscreen = r.fullscreen;
  if (r.orientation === 'landscape' || r.orientation === 'free') p.orientation = r.orientation;
  return p;
}

export function savePrefs(store: KeyValueStore | null, p: Prefs): void {
  writeJSON(store, PREFS_KEY, p);
}
