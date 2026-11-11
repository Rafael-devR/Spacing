import { describe, expect, it } from 'vitest';
import { loadPrefs, savePrefs } from '../src/core/prefs';
import { PREFS_KEY, type KeyValueStore } from '../src/core/save';

function store(init: Record<string, string> = {}): KeyValueStore {
  const data = { ...init };
  return {
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => (data[k] = v),
    removeItem: (k) => delete data[k],
  };
}

describe('preferências', () => {
  it('padrão: mira acima do dedo, tela cheia ao tocar, tela deitada', () => {
    const p = loadPrefs(store());
    expect([p.touchAim, p.fullscreen, p.orientation]).toEqual(['offset', true, 'landscape']);
  });

  it('preferências antigas (sem os campos novos) ganham os padrões', () => {
    const p = loadPrefs(
      store({ [PREFS_KEY]: JSON.stringify({ muted: true, shake: 'off', vibration: false }) }),
    );
    expect(p.muted).toBe(true);
    expect(p.touchAim).toBe('offset');
    expect(p.fullscreen).toBe(true);
  });

  it('salva e lê de volta, ignorando valores inválidos', () => {
    const s = store();
    const p = loadPrefs(s);
    p.touchAim = 'finger';
    p.fullscreen = false;
    p.orientation = 'free';
    savePrefs(s, p);
    expect(loadPrefs(s)).toMatchObject({ touchAim: 'finger', fullscreen: false, orientation: 'free' });
    const bad = loadPrefs(store({ [PREFS_KEY]: JSON.stringify({ touchAim: 'nariz', orientation: 42 }) }));
    expect([bad.touchAim, bad.orientation]).toEqual(['offset', 'landscape']);
  });
});
