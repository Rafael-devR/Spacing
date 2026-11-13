import { describe, expect, it } from 'vitest';
import { detectNative } from '../src/core/platform';

describe('detectNative (app Android × navegador)', () => {
  it('sem Capacitor é navegador', () => {
    expect(detectNative(undefined)).toBe(false);
    expect(detectNative({})).toBe(false);
  });

  it('o Capacitor do navegador não é o app', () => {
    expect(detectNative({ Capacitor: { isNativePlatform: () => false } })).toBe(false);
  });

  it('dentro do app Android', () => {
    expect(detectNative({ Capacitor: { isNativePlatform: () => true } })).toBe(true);
  });

  it('um erro na ponte não derruba o jogo', () => {
    expect(
      detectNative({
        Capacitor: {
          isNativePlatform: () => {
            throw new Error('ponte quebrada');
          },
        },
      }),
    ).toBe(false);
  });
});
