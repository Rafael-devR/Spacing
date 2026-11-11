// Preferências do jogador (gráficos, som, tremor, vibração), salvas separadas do jogo.
import { isQualityName, type QualityName } from '../render/post';
import { PREFS_KEY, readJSON, writeJSON, type KeyValueStore } from './save';

export type ShakeLevel = 'off' | 'low' | 'normal';

export interface Prefs {
  /** ausente = automático (o jogo escolhe e pode reduzir sozinho) */
  quality?: QualityName;
  muted: boolean;
  shake: ShakeLevel;
  vibration: boolean;
}

export const SHAKE_SCALE: Record<ShakeLevel, number> = { off: 0, low: 0.45, normal: 1 };

export function defaultPrefs(): Prefs {
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  return { muted: false, shake: reduced ? 'low' : 'normal', vibration: true };
}

export function loadPrefs(store: KeyValueStore | null): Prefs {
  const p = defaultPrefs();
  const raw = readJSON(store, PREFS_KEY);
  if (typeof raw !== 'object' || raw === null) return p;
  const r = raw as Record<string, unknown>;
  if (isQualityName(r.quality)) p.quality = r.quality;
  if (typeof r.muted === 'boolean') p.muted = r.muted;
  if (r.shake === 'off' || r.shake === 'low' || r.shake === 'normal') p.shake = r.shake;
  if (typeof r.vibration === 'boolean') p.vibration = r.vibration;
  return p;
}

export function savePrefs(store: KeyValueStore | null, p: Prefs): void {
  writeJSON(store, PREFS_KEY, p);
}
