// Menu de pausa: continuar, configurações (gráficos, som, tremor, vibração, mira, tela), controles e novo jogo.
import { hapticsSupported } from '../core/haptics';
import { fullscreenSupported } from '../core/fullscreen';
import type { OrientationPref, Prefs, ShakeLevel, TouchAim } from '../core/prefs';
import { t } from '../i18n';
import type { QualityName } from '../render/post';
import { el } from './dom';

export interface PauseMenuHandlers {
  onResume(): void;
  /** undefined = automático */
  onQuality(q: QualityName | undefined): void;
  onMuted(muted: boolean): void;
  onShake(level: ShakeLevel): void;
  onVibration(on: boolean): void;
  onTouchAim(aim: TouchAim): void;
  onFullscreen(on: boolean): void;
  onOrientation(o: OrientationPref): void;
  onControls(): void;
  /** abrir os gráficos avançados */
  onGraphics(): void;
  onNewGame(): void;
  /** abrir o teste de desempenho (escolha do modo, resultados guardados) */
  onBenchmark(): void;
}

export class PauseMenu {
  private readonly root = el('#pause');
  private confirmTimer = 0;

  constructor(
    h: PauseMenuHandlers,
    version: string,
  ) {
    el('#pause-version').textContent = t('pause.version', { version });
    el('#pause-resume').addEventListener('click', () => h.onResume());
    el('#pause-controls').addEventListener('click', () => h.onControls());
    el('#pause-gfx').textContent = t('gfx.open');
    el('#pause-gfx').addEventListener('click', () => h.onGraphics());
    el('#pause-bench-hint').textContent = t('pause.benchHint');
    el('#pause-bench').textContent = t('pause.bench');
    el('#pause-bench').addEventListener('click', () => h.onBenchmark());
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.root) h.onResume();
    });
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('[data-quality]')) {
      b.addEventListener('click', () => {
        const q = b.dataset.quality;
        h.onQuality(q === 'auto' ? undefined : (q as QualityName));
      });
    }
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('[data-shake]')) {
      b.addEventListener('click', () => h.onShake(b.dataset.shake as ShakeLevel));
    }
    const sound = el<HTMLButtonElement>('#pause-sound');
    sound.addEventListener('click', () => h.onMuted(sound.getAttribute('aria-pressed') === 'true'));
    const vib = el<HTMLButtonElement>('#pause-vibration');
    vib.addEventListener('click', () => h.onVibration(vib.getAttribute('aria-pressed') !== 'true'));
    el('#pause-vibration-row').hidden = !hapticsSupported;
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('[data-aim]')) {
      b.addEventListener('click', () => h.onTouchAim(b.dataset.aim as TouchAim));
    }
    const fs = el<HTMLButtonElement>('#pause-fullscreen');
    fs.addEventListener('click', () => h.onFullscreen(fs.getAttribute('aria-pressed') !== 'true'));
    el('#pause-fullscreen-row').hidden = !fullscreenSupported;
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('[data-orientation]')) {
      b.addEventListener('click', () => h.onOrientation(b.dataset.orientation as OrientationPref));
    }
    el('#pause-orientation-row').hidden = !fullscreenSupported || !('orientation' in screen);

    const reset = el<HTMLButtonElement>('#pause-new');
    reset.addEventListener('click', () => {
      if (reset.dataset.confirm) {
        h.onNewGame();
        return;
      }
      reset.dataset.confirm = '1';
      reset.textContent = t('pause.confirmNewGame');
      reset.classList.add('danger');
      clearTimeout(this.confirmTimer);
      this.confirmTimer = window.setTimeout(() => this.resetConfirm(), 4000);
    });
  }

  private resetConfirm(): void {
    const reset = el<HTMLButtonElement>('#pause-new');
    delete reset.dataset.confirm;
    reset.textContent = t('pause.newGame');
    reset.classList.remove('danger');
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  show(prefs: Prefs): void {
    this.render(prefs);
    this.resetConfirm();
    this.root.hidden = false;
    el<HTMLButtonElement>('#pause-resume').focus({ preventScroll: true });
  }

  hide(): void {
    this.root.hidden = true;
  }

  render(prefs: Prefs): void {
    const q = prefs.quality ?? 'auto';
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('[data-quality]')) {
      b.setAttribute('aria-pressed', String(b.dataset.quality === q));
    }
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('[data-shake]')) {
      b.setAttribute('aria-pressed', String(b.dataset.shake === prefs.shake));
    }
    const sound = el('#pause-sound');
    sound.setAttribute('aria-pressed', String(!prefs.muted));
    sound.textContent = t(prefs.muted ? 'pause.off' : 'pause.on');
    const vib = el('#pause-vibration');
    vib.setAttribute('aria-pressed', String(prefs.vibration));
    vib.textContent = t(prefs.vibration ? 'pause.on' : 'pause.off');
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('[data-aim]')) {
      b.setAttribute('aria-pressed', String(b.dataset.aim === prefs.touchAim));
    }
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('[data-orientation]')) {
      b.setAttribute('aria-pressed', String(b.dataset.orientation === prefs.orientation));
    }
    const fs = el('#pause-fullscreen');
    fs.setAttribute('aria-pressed', String(prefs.fullscreen));
    fs.textContent = t(prefs.fullscreen ? 'pause.on' : 'pause.off');
  }
}
