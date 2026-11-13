// Tela de configurações única (docs/design/PAUSA.md): a mesma no título e na pausa. Tudo o que o jogador ajusta mora aqui:
// planeta (só no título, provisório), gráficos (qualidade e, no jogo, os avançados), som, vibração, tremor de tela, mira ao segurar,
// tela cheia e orientação. O painel só desenha e avisa; quem o abriu aplica a mudança (o título grava as preferências, o jogo também
// ajusta o que está rodando). Linhas que o aparelho não suporta somem.
import { fullscreenSupported } from '../../core/fullscreen';
import { hapticsSupported } from '../../core/haptics';
import { isNative } from '../../core/platform';
import type { SettingsView } from '../../core/prefsLite';
import { t } from '../../i18n';
import { el } from '../dom';

export interface SettingsHandlers {
  onQuality(q: SettingsView['quality']): void;
  onMuted(muted: boolean): void;
  onShake(level: SettingsView['shake']): void;
  onVibration(on: boolean): void;
  onTouchAim(aim: SettingsView['touchAim']): void;
  onFullscreen(on: boolean): void;
  onOrientation(o: SettingsView['orientation']): void;
  /** abrir os gráficos avançados (só no jogo) */
  onAdvanced?(): void;
  /** o planeta (só no título) */
  onPlanet?(id: string): void;
  /** o jogador voltou (botão Voltar, Esc ou toque fora) */
  onBack(): void;
}

export interface SettingsOpen {
  /** o que mostrar além do comum: planeta (título) ou gráficos avançados (jogo) */
  where: 'title' | 'game';
  planet?: string;
}

export class SettingsPanel {
  private readonly root = el('#settings');
  /** a tela é uma só no HTML: quem a larga (o título, ao carregar o jogo) tira os seus ouvintes para o próximo dono */
  private readonly abort = new AbortController();

  constructor(h: SettingsHandlers) {
    const { signal } = this.abort;
    el('#settings-back').addEventListener('click', () => h.onBack(), { signal });
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.root) h.onBack();
    }, { signal });
    const press = (sel: string, fn: (b: HTMLButtonElement) => void): void => {
      for (const b of this.root.querySelectorAll<HTMLButtonElement>(sel)) b.addEventListener('click', () => fn(b), { signal });
    };
    press('[data-quality]', (b) => h.onQuality(b.dataset.quality === 'auto' ? undefined : (b.dataset.quality as SettingsView['quality'])));
    press('[data-shake]', (b) => h.onShake(b.dataset.shake as SettingsView['shake']));
    press('[data-aim]', (b) => h.onTouchAim(b.dataset.aim as SettingsView['touchAim']));
    press('[data-orientation]', (b) => h.onOrientation(b.dataset.orientation as SettingsView['orientation']));
    press('[data-planet]', (b) => h.onPlanet?.(b.dataset.planet as string));
    el('#set-sound').addEventListener('click', () => h.onMuted(el('#set-sound').getAttribute('aria-pressed') === 'true'), { signal });
    el('#set-vibration').addEventListener('click', () => h.onVibration(el('#set-vibration').getAttribute('aria-pressed') !== 'true'), { signal });
    el('#set-fullscreen').addEventListener('click', () => h.onFullscreen(el('#set-fullscreen').getAttribute('aria-pressed') !== 'true'), { signal });
    el('#set-advanced').addEventListener('click', () => h.onAdvanced?.(), { signal });
    el('#set-vibration-row').hidden = !hapticsSupported;
    el('#set-fullscreen-row').hidden = !fullscreenSupported;
    // no app Android a orientação é travada pelo plugin nativo; no navegador só vale em tela cheia
    el('#set-orientation-row').hidden = !isNative && (!fullscreenSupported || !('orientation' in screen));
  }

  /** tira os ouvintes e fecha */
  dispose(): void {
    this.abort.abort();
    this.hide();
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  show(view: SettingsView, o: SettingsOpen): void {
    this.root.hidden = false;
    for (const row of this.root.querySelectorAll<HTMLElement>('[data-only]')) row.hidden = row.dataset.only !== o.where;
    // linhas "só no toque" seguem a classe do corpo (a tela de título também a põe)
    this.render(view, o.planet);
    el<HTMLButtonElement>('#settings-back').focus({ preventScroll: true });
  }

  hide(): void {
    this.root.hidden = true;
  }

  render(v: SettingsView, planet?: string): void {
    const mark = (sel: string, attr: string, value: string): void => {
      for (const b of this.root.querySelectorAll<HTMLButtonElement>(sel)) b.setAttribute('aria-pressed', String(b.dataset[attr] === value));
    };
    mark('[data-quality]', 'quality', v.quality ?? 'auto');
    mark('[data-shake]', 'shake', v.shake);
    mark('[data-aim]', 'aim', v.touchAim);
    mark('[data-orientation]', 'orientation', v.orientation);
    if (planet) mark('[data-planet]', 'planet', planet);
    const toggle = (id: string, on: boolean): void => {
      const b = el(id);
      b.setAttribute('aria-pressed', String(on));
      b.textContent = t(on ? 'pause.on' : 'pause.off');
    };
    toggle('#set-sound', !v.muted);
    toggle('#set-vibration', v.vibration);
    toggle('#set-fullscreen', v.fullscreen);
  }
}
