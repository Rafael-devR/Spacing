// Ligação com o app Android (Capacitor, docs/design/APK.md). Só é carregado dentro do app (import dinâmico a partir de `main.ts`
// e de `core/fullscreen.ts`): no navegador estes plugins nem entram na página. O que não precisa de código nativo próprio é feito
// aqui por plugins: tela sempre ligada, barra de status escondida, orientação deitada e o botão Voltar do Android.
import { App } from '@capacitor/app';
import { KeepAwake } from '@capacitor-community/keep-awake';
import { ScreenOrientation } from '@capacitor/screen-orientation';
import { StatusBar } from '@capacitor/status-bar';
import { readSettings } from './prefsLite';

export interface NativeHooks {
  /** o botão Voltar do Android; devolva `false` se não havia nada a fechar (aí o app fecha, no título) */
  onBack(): boolean;
  /** o app foi para o segundo plano (tela bloqueada, outro app): pausar e salvar */
  onBackground(): void;
}

/** trava a tela deitada ou solta (a escolha "Orientação" das configurações) */
export async function setOrientation(landscape: boolean): Promise<void> {
  try {
    if (landscape) await ScreenOrientation.lock({ orientation: 'landscape' });
    else await ScreenOrientation.unlock();
  } catch {
    /* aparelho sem suporte */
  }
}

/** Liga o que vale para o app inteiro. Chamar uma vez, no começo. */
export async function initNative(hooks: NativeHooks): Promise<void> {
  const quiet = (p: Promise<unknown>): void => void p.catch(() => undefined);
  quiet(StatusBar.hide());
  quiet(KeepAwake.keepAwake());
  quiet(setOrientation(readSettings().orientation !== 'free'));
  try {
    await App.addListener('backButton', () => {
      if (!hooks.onBack()) void App.exitApp();
    });
    await App.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) hooks.onBackground();
    });
  } catch {
    /* sem a ponte nativa (página aberta fora do app): o jogo segue sem o botão Voltar do Android */
  }
}
