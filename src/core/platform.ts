// Onde o jogo está rodando: no navegador ou dentro do app Android (Capacitor, docs/design/APK.md). O Capacitor injeta o objeto
// global `Capacitor` antes da página abrir, então dá para saber sem importar nada dele (o build da web não paga por isso).

type CapacitorGlobal = { isNativePlatform?: () => boolean };

export function detectNative(win: { Capacitor?: CapacitorGlobal } | undefined): boolean {
  try {
    return win?.Capacitor?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}

/** verdadeiro dentro do app Android */
export const isNative: boolean = typeof window !== 'undefined' && detectNative(window as unknown as { Capacitor?: CapacitorGlobal });
