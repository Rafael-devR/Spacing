// Vibração do aparelho (Android). Silenciosa onde não existe ou quando o jogador desliga.

export const hapticsSupported = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

export type HapticPattern = 'tap' | 'medium' | 'heavy' | 'success';

const PATTERNS: Record<HapticPattern, number | number[]> = {
  tap: 12,
  medium: 28,
  heavy: [60, 30, 90],
  success: [20, 40, 20],
};

export class Haptics {
  enabled = true;

  play(p: HapticPattern): void {
    if (!this.enabled || !hapticsSupported) return;
    try {
      navigator.vibrate(PATTERNS[p]);
    } catch {
      /* alguns navegadores recusam fora de um gesto do usuário */
    }
  }
}
