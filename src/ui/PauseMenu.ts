// Menu de pausa (docs/design/PAUSA.md): continuar, salvar, configurações, controles, teste de desempenho, sair para o título e
// novo jogo. As configurações em si moram em `ui/settings/SettingsPanel.ts` (a mesma tela do título).
import { t } from '../i18n';
import { el } from './dom';

export interface PauseMenuHandlers {
  onResume(): void;
  /** grava agora; devolve se deu certo */
  onSave(): boolean;
  onSettings(): void;
  onControls(): void;
  /** abrir o teste de desempenho (escolha do modo, resultados guardados) */
  onBenchmark(): void;
  /** grava e volta para a tela de título */
  onExit(): void;
  onNewGame(): void;
}

export class PauseMenu {
  private readonly root = el('#pause');
  private confirmTimer = 0;
  private savedAt: number | null = null;
  private failed = false;

  constructor(
    h: PauseMenuHandlers,
    version: string,
  ) {
    el('#pause-version').textContent = t('pause.version', { version });
    el('#pause-resume').addEventListener('click', () => h.onResume());
    el('#pause-settings').addEventListener('click', () => h.onSettings());
    el('#pause-controls').addEventListener('click', () => h.onControls());
    el('#pause-bench').addEventListener('click', () => h.onBenchmark());
    el('#pause-exit').addEventListener('click', () => h.onExit());
    const save = el<HTMLButtonElement>('#pause-save');
    save.addEventListener('click', () => {
      this.markSaved(h.onSave());
      save.classList.add('done');
      save.textContent = t(this.failed ? 'pause.saveFailed' : 'pause.saved');
      clearTimeout(this.confirmTimer);
      this.confirmTimer = window.setTimeout(() => this.resetButtons(), 1800);
    });
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.root) h.onResume();
    });
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
      this.confirmTimer = window.setTimeout(() => this.resetButtons(), 4000);
    });
  }

  private resetButtons(): void {
    const reset = el<HTMLButtonElement>('#pause-new');
    delete reset.dataset.confirm;
    reset.textContent = t('pause.newGame');
    reset.classList.remove('danger');
    const save = el<HTMLButtonElement>('#pause-save');
    save.classList.remove('done');
    save.textContent = t('pause.save');
  }

  /** guarda o horário da gravação (ou a falha) para a linha de baixo */
  markSaved(ok: boolean): void {
    this.failed = !ok;
    if (ok) this.savedAt = Date.now();
    this.renderStatus();
  }

  private renderStatus(): void {
    const at = this.savedAt;
    const hhmm = at === null ? '' : new Date(at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    el('#pause-saved').textContent = this.failed ? t('pause.saveFailed') : at === null ? '' : t('pause.savedAt', { time: hhmm });
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  show(): void {
    this.resetButtons();
    this.renderStatus();
    this.root.hidden = false;
    el<HTMLButtonElement>('#pause-resume').focus({ preventScroll: true });
  }

  hide(): void {
    this.root.hidden = true;
  }
}
