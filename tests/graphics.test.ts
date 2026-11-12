import { describe, expect, it } from 'vitest';
import { loadPrefs, savePrefs } from '../src/core/prefs';
import { PREFS_KEY, type KeyValueStore } from '../src/core/save';
import { NATIVE_PIXEL_RATIO, drawSize, gfxCount, parseGfx, resolveQuality } from '../src/render/graphics';
import { QUALITY } from '../src/render/post';

function store(init: Record<string, string> = {}): KeyValueStore {
  const data = { ...init };
  return { getItem: (k) => data[k] ?? null, setItem: (k, v) => (data[k] = v), removeItem: (k) => delete data[k] };
}

describe('gráficos manuais', () => {
  it('sem trocas, o preset sai igual (e é uma cópia)', () => {
    const q = resolveQuality(QUALITY.alto, {});
    expect(q).toEqual(QUALITY.alto);
    expect(q).not.toBe(QUALITY.alto);
    expect(resolveQuality(QUALITY.baixo, undefined)).toEqual(QUALITY.baixo);
  });

  it('cada troca vale só para o seu item', () => {
    const q = resolveQuality(QUALITY.baixo, { resolution: 1.5, msaa: 4, shadow: 4096, bloom: true, vignette: false });
    expect(q).toMatchObject({ pixelRatio: 1.5, samples: 4, shadow: 4096, bloom: true, vignette: false, chromatic: true, noise: true });
    expect(QUALITY.baixo.samples).toBe(0); // o preset original não muda
  });

  it('resolução nativa pede mais que qualquer tela (o Post limita à densidade real)', () => {
    expect(resolveQuality(QUALITY.medio, { resolution: 'native' }).pixelRatio).toBe(NATIVE_PIXEL_RATIO);
    expect(drawSize(832, 384, NATIVE_PIXEL_RATIO, 2.8125, 8192)).toEqual([2340, 1080]);
    expect(drawSize(832, 384, 2, 2.8125, 8192)).toEqual([1664, 768]);
    expect(drawSize(832, 384, 2, 1, 8192)).toEqual([832, 384]); // tela comum: não passa da densidade
    expect(drawSize(4000, 2000, 2, 3, 4096)).toEqual([4096, 2048]); // nem da textura máxima
  });

  it('sombra 0 = sem sombra', () => {
    expect(resolveQuality(QUALITY.alto, { shadow: 0 }).shadow).toBe(0);
  });

  it('Média e Alta usam MSAA 2×', () => {
    expect(QUALITY.medio.samples).toBe(2);
    expect(QUALITY.alto.samples).toBe(2);
    expect(QUALITY.baixo.samples).toBe(0);
  });

  it('lê as trocas guardadas e joga fora o que for inválido', () => {
    expect(parseGfx({ resolution: 'native', msaa: 4, shadow: 2048, bloom: false, fpsCap: 60, showFps: true })).toEqual({
      resolution: 'native', msaa: 4, shadow: 2048, bloom: false, fpsCap: 60, showFps: true,
    });
    expect(parseGfx({ resolution: 3, msaa: 8, shadow: 99, bloom: 'sim', fpsCap: 144, glow: 1 })).toEqual({});
    expect(parseGfx(null)).toEqual({});
    expect(parseGfx('x')).toEqual({});
  });

  it('conta as trocas', () => {
    expect(gfxCount(undefined)).toBe(0);
    expect(gfxCount({})).toBe(0);
    expect(gfxCount({ msaa: 0, noise: false })).toBe(2);
  });

  it('as preferências guardam as trocas; preferências antigas ficam sem nenhuma', () => {
    const s = store();
    const p = loadPrefs(s);
    expect(p.gfx).toEqual({});
    p.gfx = { resolution: 1.5, fpsCap: 60, chromatic: false };
    savePrefs(s, p);
    expect(loadPrefs(s).gfx).toEqual({ resolution: 1.5, fpsCap: 60, chromatic: false });
    expect(loadPrefs(store({ [PREFS_KEY]: JSON.stringify({ muted: true, quality: 'alto' }) })).gfx).toEqual({});
  });
});
