// Tela cheia e orientação da tela.
// O navegador só deixa entrar em tela cheia logo depois de um gesto do jogador (toque solto ou clique).
// A trava de orientação (paisagem) só funciona em tela cheia e não existe no iPhone: lá o jogo segue o
// celular e o layout de retrato continua funcionando.

interface LockableOrientation {
  lock?(o: 'landscape'): Promise<void>;
  unlock?(): void;
}

type WebkitDoc = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void>;
};
type WebkitEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };

export const fullscreenSupported: boolean =
  typeof document !== 'undefined' &&
  (!!document.documentElement.requestFullscreen ||
    !!(document.documentElement as WebkitEl).webkitRequestFullscreen) &&
  (document.fullscreenEnabled ?? true);

export function isFullscreen(): boolean {
  const d = document as WebkitDoc;
  return !!(d.fullscreenElement ?? d.webkitFullscreenElement);
}

/** Entra em tela cheia e, se `landscape`, tenta travar a tela deitada. Falhas são ignoradas. */
export async function enterFullscreen(landscape: boolean): Promise<void> {
  if (!fullscreenSupported) return;
  try {
    if (!isFullscreen()) {
      const root = document.documentElement as WebkitEl;
      if (root.requestFullscreen) await root.requestFullscreen({ navigationUI: 'hide' });
      else await root.webkitRequestFullscreen?.();
    }
    await applyOrientation(landscape);
  } catch {
    // sem gesto válido, recusado pelo navegador ou sem suporte: segue sem tela cheia
  }
}

export async function exitFullscreen(): Promise<void> {
  const d = document as WebkitDoc;
  try {
    if (d.exitFullscreen) await d.exitFullscreen();
    else await d.webkitExitFullscreen?.();
  } catch {
    // já saiu
  }
}

/** Trava ou solta a orientação (só tem efeito em tela cheia, em celulares que permitem). */
export async function applyOrientation(landscape: boolean): Promise<void> {
  const o = screen.orientation as (ScreenOrientation & LockableOrientation) | undefined;
  if (!o) return;
  try {
    if (landscape && isFullscreen()) await o.lock?.('landscape');
    else o.unlock?.();
  } catch {
    // celular ou navegador sem trava de orientação
  }
}

export function onFullscreenChange(fn: (on: boolean) => void): void {
  const h = (): void => fn(isFullscreen());
  document.addEventListener('fullscreenchange', h);
  document.addEventListener('webkitfullscreenchange', h);
}
