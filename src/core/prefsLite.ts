// Preferências lidas e gravadas sem carregar o jogo: a tela de título usa isto (ela não pode importar `core/prefs.ts`, que puxa o
// salvamento e, por ele, o planeta). Mesma chave e mesmo formato de `core/prefs.ts`; só mexe nos campos pedidos e preserva o resto
// (trocas de gráficos avançados, por exemplo).
import { PREFS_KEY } from './keys';

/** o que o painel de configurações mostra (um subconjunto estrutural de `Prefs`) */
export interface SettingsView {
  quality?: 'baixo' | 'medio' | 'alto';
  muted: boolean;
  shake: 'off' | 'low' | 'normal';
  vibration: boolean;
  touchAim: 'offset' | 'finger';
  fullscreen: boolean;
  orientation: 'landscape' | 'free';
}

type Raw = Record<string, unknown>;

function readRaw(): Raw {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as unknown;
    return raw && typeof raw === 'object' ? (raw as Raw) : {};
  } catch {
    return {};
  }
}

/** as preferências guardadas, com o padrão onde falta */
export function readSettings(): SettingsView {
  const r = readRaw();
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  return {
    quality: r.quality === 'baixo' || r.quality === 'medio' || r.quality === 'alto' ? r.quality : undefined,
    muted: typeof r.muted === 'boolean' ? r.muted : false,
    shake: r.shake === 'off' || r.shake === 'low' || r.shake === 'normal' ? r.shake : reduced ? 'low' : 'normal',
    vibration: typeof r.vibration === 'boolean' ? r.vibration : true,
    touchAim: r.touchAim === 'finger' ? 'finger' : 'offset',
    fullscreen: typeof r.fullscreen === 'boolean' ? r.fullscreen : true,
    orientation: r.orientation === 'free' ? 'free' : 'landscape',
  };
}

/** troca alguns campos e guarda; `quality: undefined` volta para o automático */
export function patchSettings(patch: Partial<SettingsView>): void {
  const r = readRaw();
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete r[k];
    else r[k] = v;
  }
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(r));
  } catch {
    /* sem armazenamento */
  }
}
