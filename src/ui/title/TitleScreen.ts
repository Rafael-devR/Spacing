// Tela de título (docs/design/TITULO.md): nome do jogo, versão, os botões de sempre (Jogar ou Continuar, Novo jogo, Configurações,
// Controles, Modo de teste) e, no fundo, o planeta escolhido girando num céu estrelado (titleScene.ts). Não carrega o jogo: só lê o
// que precisa do armazenamento (há jogo salvo? qual planeta? preferências) e, em "Jogar", entrega para o carregamento (main.ts).
// As configurações daqui são as que fazem sentido antes de jogar: planeta (provisório, até existir a viagem), gráficos, som e
// vibração. O resto continua no menu de pausa.
import type * as THREE from 'three';
import { VERSION } from '../../app/config';
import { primeAudio } from '../../audio/unlock';
import { enterFullscreen, fullscreenSupported, isFullscreen } from '../../core/fullscreen';
import { LEGACY_SAVE_KEY, PREFS_KEY } from '../../core/keys';
import { currentPlanet, setPlanet } from '../../core/planetChoice';
import { PLANETS, isPlanetId, type PlanetId } from '../../data/planets';
import { t } from '../../i18n';
import { el } from '../dom';
import { TitleScene } from './titleScene';

export interface PlayOptions {
  /** apagar o jogo salvo deste planeta antes de carregar */
  newGame: boolean;
}

const testMode = (): boolean => new URLSearchParams(location.search).has('teste');
/** celular ou tablet (o mesmo teste do `Input` do jogo) */
const isTouch = (): boolean => matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

/** preferências como estão guardadas (só os campos que esta tela mexe) */
type RawPrefs = { quality?: string; muted?: boolean; vibration?: boolean; fullscreen?: boolean; orientation?: string } & Record<string, unknown>;

function readPrefs(): RawPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as unknown;
    return raw && typeof raw === 'object' ? (raw as RawPrefs) : {};
  } catch {
    return {};
  }
}

function writePrefs(p: RawPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* sem armazenamento */
  }
}

export class TitleScreen {
  onPlay: ((o: PlayOptions) => void) | null = null;
  readonly scene: TitleScene;
  private readonly root = el('#title');
  private readonly settings = el('#title-settings');
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
    el('#title-settings-back').addEventListener('click', () => this.openSettings(false));
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
    // configurações
    for (const b of this.settings.querySelectorAll<HTMLButtonElement>('[data-planet]'))
      b.addEventListener('click', () => {
        const id = b.dataset.planet;
        if (isPlanetId(id) && id !== this.planet) {
          setPlanet(id);
          this.planet = id;
          this.refresh();
          void this.scene.show(id);
        }
      });
    for (const b of this.settings.querySelectorAll<HTMLButtonElement>('[data-quality]'))
      b.addEventListener('click', () => {
        const p = readPrefs();
        if (b.dataset.quality === 'auto') delete p.quality;
        else p.quality = b.dataset.quality;
        writePrefs(p);
        this.refresh();
      });
    for (const [id, key] of [['#title-sound', 'muted'], ['#title-vibration', 'vibration'], ['#title-fullscreen', 'fullscreen']] as const)
      el(id).addEventListener('click', () => {
        const p = readPrefs();
        if (key === 'muted') p.muted = !p.muted;
        else p[key] = p[key] === false;
        writePrefs(p);
        this.refresh();
      });
    el('#title-fullscreen-row').hidden = !fullscreenSupported;
    // no celular, o primeiro toque já põe em tela cheia (o navegador só deixa depois de um gesto); igual ao jogo
    document.addEventListener('pointerup', (e) => {
      if (this.root.hidden || e.pointerType === 'mouse') return;
      this.fullscreen();
    });
    window.addEventListener('keydown', (e) => {
      if (this.root.hidden) return;
      if (e.key === 'Escape' && !this.settings.hidden) this.openSettings(false);
      else if (e.key === 'Enter' && this.settings.hidden && el('#help').hidden) this.play(false);
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
    const p = readPrefs();
    for (const b of this.settings.querySelectorAll<HTMLButtonElement>('[data-planet]')) b.setAttribute('aria-pressed', String(b.dataset.planet === this.planet));
    const q = typeof p.quality === 'string' ? p.quality : 'auto';
    for (const b of this.settings.querySelectorAll<HTMLButtonElement>('[data-quality]')) b.setAttribute('aria-pressed', String(b.dataset.quality === q));
    const fs = el('#title-fullscreen');
    fs.setAttribute('aria-pressed', String(p.fullscreen !== false));
    fs.textContent = p.fullscreen === false ? t('title.off') : t('title.on');
    const sound = el('#title-sound'), vib = el('#title-vibration');
    sound.setAttribute('aria-pressed', String(!p.muted));
    sound.textContent = p.muted ? t('title.off') : t('title.on');
    vib.setAttribute('aria-pressed', String(p.vibration !== false));
    vib.textContent = p.vibration === false ? t('title.off') : t('title.on');
  }

  /** tela cheia (se a preferência deixar), deitada se a preferência de orientação pedir */
  private fullscreen(): void {
    const p = readPrefs();
    if (p.fullscreen === false || isFullscreen()) return;
    void enterFullscreen(p.orientation !== 'free');
  }

  private openSettings(open: boolean): void {
    this.settings.hidden = !open;
    this.root.classList.toggle('settings-open', open);
    this.refresh();
  }

  private play(newGame: boolean): void {
    if (this.root.hidden) return;
    // o som só pode nascer dentro do toque: o contexto fica pronto para o jogo usar quando carregar
    primeAudio();
    if (isTouch()) this.fullscreen();
    this.onPlay?.({ newGame });
  }

  /** o planeta que vai ser carregado */
  get planetId(): PlanetId {
    return this.planet;
  }
}
