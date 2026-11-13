// Tela de título (docs/design/TITULO.md): nome do jogo, versão, os botões de sempre (Jogar ou Continuar, Novo jogo, Configurações,
// Controles, Modo de teste) e, no fundo, o planeta escolhido girando num céu estrelado (titleScene.ts). Não carrega o jogo: só lê o
// que precisa do armazenamento (há jogo salvo? qual planeta? preferências) e, em "Jogar", entrega para o carregamento (main.ts).
// As configurações são a tela única de `ui/settings` (a mesma da pausa); aqui ela ganha a escolha do planeta (provisória, até
// existir a viagem) e grava as preferências sem o jogo carregado (`core/prefsLite.ts`).
import type * as THREE from 'three';
import { VERSION } from '../../app/config';
import { primeAudio } from '../../audio/unlock';
import { applyOrientation, enterFullscreen, isFullscreen } from '../../core/fullscreen';
import { LEGACY_SAVE_KEY } from '../../core/keys';
import { patchSettings, readSettings } from '../../core/prefsLite';
import { currentPlanet, setPlanet } from '../../core/planetChoice';
import { PLANETS, isPlanetId, type PlanetId } from '../../data/planets';
import { t } from '../../i18n';
import { el } from '../dom';
import { SettingsPanel } from '../settings/SettingsPanel';
import { TitleScene } from './titleScene';

export interface PlayOptions {
  /** apagar o jogo salvo deste planeta antes de carregar */
  newGame: boolean;
}

const testMode = (): boolean => new URLSearchParams(location.search).has('teste');
/** celular ou tablet (o mesmo teste do `Input` do jogo) */
const isTouch = (): boolean => matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

export class TitleScreen {
  onPlay: ((o: PlayOptions) => void) | null = null;
  readonly scene: TitleScene;
  private readonly root = el('#title');
  private readonly settings: SettingsPanel;
  private planet: PlanetId = currentPlanet();
  private confirmNew = false;

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    this.scene = new TitleScene(renderer);
    // as linhas "só no toque" (tela cheia, aviso de girar) já valem aqui; o jogo confirma depois
    document.body.classList.toggle('touch', isTouch());
    el('#title-version').textContent = t('title.version', { v: VERSION });
    el('#btn-start').addEventListener('click', () => this.play(false));
    const reset = el<HTMLButtonElement>('#btn-reset');
    reset.addEventListener('click', () => {
      if (!this.confirmNew) {
        this.confirmNew = true;
        reset.textContent = t('menu.confirmReset');
        reset.classList.add('danger');
        return;
      }
      this.play(true);
    });
    el('#btn-settings').addEventListener('click', () => this.openSettings(true));
    el('#btn-controls').addEventListener('click', () => (el('#help').hidden = false));
    el('#help').addEventListener('pointerdown', () => (el('#help').hidden = true));
    const tm = el('#btn-testmode');
    tm.textContent = testMode() ? t('title.leaveTest') : t('title.test');
    tm.addEventListener('click', () => {
      const u = new URL(location.href);
      if (testMode()) u.searchParams.delete('teste');
      else u.searchParams.set('teste', '');
      location.assign(u.toString());
    });
    this.settings = new SettingsPanel({
      onQuality: (q) => this.change({ quality: q }),
      onMuted: (muted) => this.change({ muted }),
      onShake: (shake) => this.change({ shake }),
      onVibration: (vibration) => this.change({ vibration }),
      onTouchAim: (touchAim) => this.change({ touchAim }),
      onFullscreen: (fullscreen) => {
        this.change({ fullscreen });
        if (fullscreen) this.fullscreen();
      },
      onOrientation: (orientation) => {
        this.change({ orientation });
        void applyOrientation(orientation === 'landscape');
      },
      onPlanet: (id) => {
        if (isPlanetId(id) && id !== this.planet) {
          setPlanet(id);
          this.planet = id;
          this.refresh();
          void this.scene.show(id);
        }
      },
      onBack: () => this.openSettings(false),
    });
    // no celular, o primeiro toque já põe em tela cheia (o navegador só deixa depois de um gesto); igual ao jogo
    document.addEventListener('pointerup', (e) => {
      if (this.root.hidden || e.pointerType === 'mouse' || this.settings.open) return;
      this.fullscreen();
    });
    window.addEventListener('keydown', (e) => {
      if (this.root.hidden) return;
      if (e.key === 'Escape' && this.settings.open) this.openSettings(false);
      else if (e.key === 'Enter' && !this.settings.open && el('#help').hidden) this.play(false);
    });
  }

  /** jogo salvo do planeta escolhido (no modo de teste, o salvamento dele) */
  private hasSave(): boolean {
    try {
      const key = PLANETS[this.planet].saveKey + (testMode() ? '.teste' : '');
      return localStorage.getItem(key) !== null || (this.planet === 'lua' && !testMode() && localStorage.getItem(LEGACY_SAVE_KEY) !== null);
    } catch {
      return false;
    }
  }

  show(): void {
    this.root.hidden = false;
    this.refresh();
    this.renderer.domElement.classList.add('title-canvas');
    this.scene.start();
    void this.scene.show(this.planet).catch((err: unknown) => console.warn('planeta da tela de título não carregou', err));
  }

  /** some com a tela (o carregamento começa) e devolve o canvas para o jogo */
  hide(): void {
    this.root.hidden = true;
    this.settings.dispose();
    this.scene.dispose();
    this.renderer.domElement.classList.remove('title-canvas');
  }

  private refresh(): void {
    const save = this.hasSave();
    const def = PLANETS[this.planet];
    document.body.dataset.planet = this.planet;
    el('#title-region').textContent = def.region;
    el('#btn-start').textContent = save ? t('menu.continue') : t('menu.start');
    const reset = el<HTMLButtonElement>('#btn-reset');
    reset.hidden = !save;
    this.confirmNew = false;
    reset.textContent = t('title.newGame');
    reset.classList.remove('danger');
    el('#title-planet').textContent = t('title.planetLine', { name: def.name });
  }

  /** tela cheia (se a preferência deixar), deitada se a preferência de orientação pedir */
  private fullscreen(): void {
    const p = readSettings();
    if (!p.fullscreen || isFullscreen()) return;
    void enterFullscreen(p.orientation !== 'free');
  }

  private change(patch: Parameters<typeof patchSettings>[0]): void {
    patchSettings(patch);
    this.settings.render(readSettings(), this.planet);
  }

  private openSettings(open: boolean): void {
    if (open) this.settings.show(readSettings(), { where: 'title', planet: this.planet });
    else this.settings.hide();
    this.refresh();
  }

  private play(newGame: boolean): void {
    if (this.root.hidden) return;
    // o som só pode nascer dentro do toque: o contexto fica pronto para o jogo usar quando carregar
    primeAudio();
    if (isTouch()) this.fullscreen();
    this.onPlay?.({ newGame });
  }

  /** o botão Voltar do app: fecha o que estiver aberto (configurações, controles); `false` se não havia nada (o app fecha) */
  back(): boolean {
    if (this.root.hidden) return true; // carregando: o Voltar não faz nada
    if (this.settings.open) {
      this.openSettings(false);
      return true;
    }
    const help = el('#help');
    if (!help.hidden) {
      help.hidden = true;
      return true;
    }
    return false;
  }

  /** o planeta que vai ser carregado */
  get planetId(): PlanetId {
    return this.planet;
  }
}
