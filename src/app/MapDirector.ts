// Mapa do tablet (docs/design/MAPA.md): o botão do tablet (ou M) traz o tablet do pulso até a câmera, até a tela
// dele ocupar a tela do celular; ali fica o mapa em blocos (render/blockMap.ts), na mesma perspectiva da câmera do
// jogo, só com o que o astronauta já descobriu (systems/Exploration.ts), mais os lugares, a sonda, a base, o
// objetivo, os itens e os minérios vistos. Fechar faz o caminho de volta.
// Enquanto o mapa está aberto o astronauta fica parado (o traje continua gastando oxigênio).
import * as THREE from 'three';
import type { Sfx } from '../audio/Sfx';
import type { Haptics } from '../core/haptics';
import type { PropType } from '../data/props';
import { buildTablet } from '../render/equipModels';
import { BlockMap, MARKER_COLOR, MARKER_PINNED, type MapMarker, type MarkerKind, type SurfaceCell } from '../render/blockMap';
import type { Exploration } from '../systems/Exploration';
import { INTERIOR_LAYER } from '../render/indoors';
import { t } from '../i18n';
import { el } from '../ui/dom';
import type { GameBus } from './events';

/** camada do three.js só do tablet: com o mapa aberto, a câmera vê só ela (o mundo não é desenhado) */
export const TABLET_LAYER = 2;

/** segundos da animação de abrir e de fechar */
const OPEN_SECONDS = 0.6;
const CLOSE_SECONDS = 0.42;
/** distância do tablet à câmera, em unidades do mundo (a câmera enxerga a partir de 1) */
const TABLET_DIST = 4;
/** maior lado da textura do mapa, em pixels (a textura tem o tamanho real da tela) */
const MAX_TEXTURE = 2560;
/** chunks do mapa montados por quadro com o mapa aberto (o primeiro quadro monta mais) */
const BUILD_PER_FRAME = 6;

const ORE_KINDS: Partial<Record<PropType, MarkerKind>> = { crystal: 'crystal', gold: 'gold', ilmenite: 'ilmenite', meteorite: 'meteorite' };

export interface MapDeps {
  events: GameBus;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  sfx: Sfx;
  haptics: Haptics;
  /** bloco do topo da coluna (com as edições do jogador e a base) */
  surface(x: number, z: number): SurfaceCell;
  /** o que já foi descoberto */
  exploration: Exploration;
  /** altura de referência (o planalto do pouso): o mapa clareia acima dela e escurece abaixo */
  refY: number;
  /** giro atual da câmera do jogo (o mapa abre olhando para o mesmo lado) */
  cameraYaw(): number;
  player(): { x: number; y: number; z: number; facing: number };
  lander(): THREE.Vector3;
  base(): { x: number; z: number };
  goal(): THREE.Vector3 | null;
  loot(): THREE.Vector3[];
  props(): { type: PropType; x: number; z: number }[];
  /** pode abrir agora (jogando, sem outra tela aberta, sem cena da base) */
  canOpen(): boolean;
}

type MapState = 'closed' | 'opening' | 'open' | 'closing';

const ease = (k: number): number => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

export class MapDirector {
  state: MapState = 'closed';
  /** 0 = tablet no pulso, 1 = tela cheia */
  private k = 0;
  private readonly map: BlockMap;
  private readonly pivot = new THREE.Group();
  private tablet: THREE.Group | null = null;
  private tabletAspect = 0;
  private readonly screenMat: THREE.MeshBasicMaterial;
  private readonly root = el('#map');
  private readonly labels = el('#map-labels');
  private readonly north = el('.map-north');
  private dt = 0;
  private readonly labelEls = new Map<string, HTMLElement>();
  private markers: MapMarker[] = [];
  private markerT = 0;
  private time = 0;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinch = 0;
  private readonly v = new THREE.Vector3();

  constructor(private readonly d: MapDeps) {
    this.map = new BlockMap(d.surface, (x, z) => d.exploration.at(x, z), d.refY);
    d.events.on('map:revealed', ({ chunks }) => this.map.invalidate(chunks));
    d.events.on('world:blockChanged', ({ x, z }) => this.map.blockChanged(x, z));
    this.screenMat = new THREE.MeshBasicMaterial({ map: this.map.target.texture, toneMapped: false, depthTest: false, fog: false });
    this.pivot.visible = false;
    d.scene.add(this.pivot);
    this.buildLegend();
    el('#map-close').addEventListener('click', () => this.close());
    el('#map-in').addEventListener('click', () => this.zoom(1 / 1.3));
    el('#map-out').addEventListener('click', () => this.zoom(1.3));
    el('#map-rot-l').addEventListener('click', () => (this.map.yawTarget -= Math.PI / 2));
    el('#map-rot-r').addEventListener('click', () => (this.map.yawTarget += Math.PI / 2));
    el('#map-me').addEventListener('click', () => {
      const p = d.player();
      this.map.view.set(p.x, p.z);
      this.refreshMarkers();
    });
    for (const b of this.root.querySelectorAll('button')) b.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.root.addEventListener('pointerdown', (e) => this.down(e));
    this.root.addEventListener('pointermove', (e) => this.move(e));
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave'] as const) this.root.addEventListener(ev, (e) => this.up(e));
    this.root.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoom(e.deltaY > 0 ? 1.12 : 1 / 1.12);
    }, { passive: false });
  }

  /** aberto ou abrindo/fechando: o jogo trava o astronauta */
  get active(): boolean {
    return this.state !== 'closed';
  }

  /** o tablet ocupa a tela toda: o mundo não precisa ser desenhado */
  get full(): boolean {
    return this.state === 'open';
  }

  toggle(): void {
    if (this.state === 'closed' || this.state === 'closing') this.open();
    else this.close();
  }

  open(): void {
    if (this.state === 'open' || this.state === 'opening' || !this.d.canOpen()) return;
    const p = this.d.player();
    const m = this.map;
    m.view.set(p.x, p.z);
    // abre olhando para o mesmo lado que a câmera do jogo
    m.yaw = m.yawTarget = this.d.cameraYaw();
    this.d.exploration.revealAround(p.x, p.z);
    m.sync(this.d.exploration.chunks(), 60);
    this.refreshMarkers();
    this.ensureTablet();
    this.state = 'opening';
    this.pivot.visible = true;
    this.root.hidden = false;
    this.root.classList.remove('full');
    document.body.classList.add('map-open');
    this.d.sfx.play('tabletOpen');
    this.d.haptics.play('tap');
    this.d.events.emit('map:toggled', { open: true });
  }

  /** Fecha (com animação; `instant` = na hora, para a morte ou um salvamento). */
  close(instant = false): void {
    if (this.state === 'closed') return;
    this.root.classList.remove('full');
    this.pointers.clear();
    if (instant) {
      this.k = 0;
      this.finishClose();
      this.d.events.emit('map:toggled', { open: false });
      return;
    }
    if (this.state === 'closing') return;
    this.state = 'closing';
    this.d.sfx.play('tabletClose');
    this.d.events.emit('map:toggled', { open: false });
  }

  private finishClose(): void {
    this.state = 'closed';
    this.pivot.visible = false;
    this.root.hidden = true;
    document.body.classList.remove('map-open');
    this.clearLabels();
  }

  /** Tamanho da tela mudou: refaz a textura e o tablet (a tela do tablet tem a proporção da tela). */
  resize(w: number, h: number): void {
    // tamanho real da tela (com a densidade de pixels): o mapa fica nítido em tela cheia
    const pr = this.d.renderer.getPixelRatio();
    const k = Math.min(1, MAX_TEXTURE / Math.max(w * pr, h * pr));
    this.map.setSize(w * pr * k, h * pr * k);
    if (this.tablet && Math.abs(this.tabletAspect - w / h) > 0.01) this.ensureTablet(true);
  }

  private ensureTablet(force = false): void {
    const aspect = this.d.camera.aspect;
    if (this.tablet && !force && Math.abs(aspect - this.tabletAspect) < 0.01) return;
    if (this.tablet) this.pivot.remove(this.tablet);
    const tab = buildTablet(this.screenMat, aspect, 0.07, false);
    // sempre por cima do mundo: sem teste de profundidade, na ordem moldura → tela → detalhes
    let order = 50;
    tab.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.material) {
        const mat = m.material as THREE.Material;
        mat.depthTest = false;
        (mat as THREE.MeshBasicMaterial).fog = false;
        m.renderOrder = o.name === 'screen' ? 60 : order++;
      }
      o.layers.enable(INTERIOR_LAYER);
      o.layers.enable(TABLET_LAYER);
      o.frustumCulled = false;
    });
    this.pivot.layers.enable(INTERIOR_LAYER);
    this.pivot.layers.enable(TABLET_LAYER);
    this.tablet = tab;
    this.tabletAspect = aspect;
    this.pivot.add(tab);
  }

  private zoom(f: number): void {
    const h = this.map;
    h.distance = THREE.MathUtils.clamp(h.distance * f, h.minDistance, h.maxDistance);
  }

  // ---------- dedo: arrastar e pinçar ----------

  private down(e: PointerEvent): void {
    if (this.state !== 'open') return;
    this.root.setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) this.pinch = this.spread();
  }

  private move(e: PointerEvent): void {
    const prev = this.pointers.get(e.pointerId);
    if (!prev || this.state !== 'open') return;
    if (this.pointers.size === 1) {
      // arrasta nos eixos da câmera: para os lados, e para a frente e para trás no chão
      const m = this.map;
      const bpp = m.blocksPerPixel(innerHeight);
      const { right, forward } = m.axes();
      const dx = (e.clientX - prev.x) * bpp, dy = ((e.clientY - prev.y) * bpp) / Math.sin(m.pitch);
      m.view.x += -right.x * dx + forward.x * dy;
      m.view.y += -right.y * dx + forward.y * dy;
    }
    prev.x = e.clientX;
    prev.y = e.clientY;
    if (this.pointers.size === 2) {
      const s = this.spread();
      if (this.pinch > 0 && s > 0) this.zoom(this.pinch / s);
      this.pinch = s;
    }
  }

  private up(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = 0;
  }

  private spread(): number {
    const [a, b] = [...this.pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  // ---------- marcadores ----------

  private refreshMarkers(): void {
    const d = this.d;
    const list: MapMarker[] = [];
    const l = d.lander();
    list.push({ kind: 'lander', x: l.x, z: l.z });
    const b = d.base();
    list.push({ kind: 'base', x: b.x, z: b.z });
    const g = d.goal();
    if (g) list.push({ kind: 'goal', x: g.x, z: g.z });
    for (const p of d.loot()) list.push({ kind: 'loot', x: p.x, z: p.z });
    // objetos só onde já se andou: o mapa não entrega o que ainda não foi visto
    for (const p of d.props()) {
      const kind = ORE_KINDS[p.type];
      if (kind && d.exploration.at(p.x, p.z)) list.push({ kind, x: p.x, z: p.z });
    }
    this.markers = list;
    this.map.setMarkers(list);
  }

  private buildLegend(): void {
    const ul = el('#map-legend');
    const kinds: MarkerKind[] = ['player', 'lander', 'base', 'goal', 'loot', 'meteorite', 'crystal', 'gold', 'ilmenite'];
    ul.innerHTML = kinds
      .map((k) => `<li><i style="--c:${MARKER_COLOR[k]}" class="${MARKER_PINNED.has(k) ? 'pin' : ''}"></i>${t(`map.kind.${k}`)}</li>`)
      .join('');
  }

  private clearLabels(): void {
    for (const e of this.labelEls.values()) e.remove();
    this.labelEls.clear();
  }

  /** nomes dos lugares, em HTML por cima do mapa (nítidos) */
  private placeLabels(): void {
    const used = new Set<string>();
    const w = innerWidth, h = innerHeight;
    const show = (key: string, kind: MarkerKind, at: THREE.Vector3, text: string): void => {
      const s = this.map.project(at);
      if (!s || s.x < -0.05 || s.x > 1.05 || s.y < -0.05 || s.y > 1.05) return;
      let e = this.labelEls.get(key);
      if (!e) {
        e = document.createElement('span');
        e.className = `map-label k-${kind}`;
        e.style.setProperty('--c', MARKER_COLOR[kind]);
        this.labels.appendChild(e);
        this.labelEls.set(key, e);
      }
      if (e.textContent !== text) e.textContent = text;
      e.style.transform = `translate(${(s.x * w).toFixed(1)}px, ${(s.y * h).toFixed(1)}px) translate(-50%, -130%)`;
      used.add(key);
    };
    const p = this.d.player();
    show('player', 'player', this.v.set(p.x, p.y + 2.6, p.z), t('map.kind.player'));
    this.markers.forEach((m, i) => {
      if (!MARKER_PINNED.has(m.kind)) return;
      show(`${m.kind}${i}`, m.kind, this.map.markerTop(m, this.v), t(`map.kind.${m.kind}`));
    });
    for (const [k, e] of this.labelEls)
      if (!used.has(k)) {
        e.remove();
        this.labelEls.delete(k);
      }
  }

  // ---------- a cada quadro ----------

  /** Depois da câmera se mexer: anima o tablet e atualiza o mapa. */
  update(dt: number): void {
    if (this.state === 'closed') return;
    this.time += dt;
    this.dt = dt;
    if (this.state === 'opening') {
      this.k = Math.min(1, this.k + dt / OPEN_SECONDS);
      if (this.k >= 1) {
        this.state = 'open';
        this.root.classList.add('full');
      }
    } else if (this.state === 'closing') {
      this.k = Math.max(0, this.k - dt / CLOSE_SECONDS);
      if (this.k <= 0) {
        this.finishClose();
        return;
      }
    }
    this.poseTablet();
    const p = this.d.player();
    this.map.setPlayer(p.x, p.y, p.z, p.facing, this.time);
    this.map.sync(this.d.exploration.chunks(), BUILD_PER_FRAME);
    // bússola: o norte gira junto com o mapa
    this.north.style.transform = `translateX(-50%) rotate(${THREE.MathUtils.radToDeg(this.map.yaw).toFixed(1)}deg)`;
    this.markerT -= dt;
    if (this.markerT <= 0) {
      this.markerT = 0.5;
      this.refreshMarkers();
    }
    if (this.state === 'open') this.placeLabels();
    else this.clearLabels();
  }

  /** tablet entre o pulso (canto de baixo, deitado) e a frente da câmera (ocupando a tela) */
  private poseTablet(): void {
    const tab = this.tablet;
    if (!tab) return;
    const cam = this.d.camera;
    this.pivot.position.copy(cam.position);
    this.pivot.quaternion.copy(cam.quaternion);
    const vh = 2 * TABLET_DIST * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    const vw = vh * cam.aspect;
    const full = vh * 1.035; // a tela do tablet passa um pouco da borda: a moldura fica de fora
    const e = ease(this.k);
    const lerp = THREE.MathUtils.lerp;
    const s = lerp(full * 0.3, full, e);
    tab.scale.setScalar(s);
    // a tela fica um pouco abaixo do centro do tablet (botão de início embaixo): compensa
    tab.position.set(lerp(vw * 0.34, 0, e), lerp(-vh * 0.62, 0.07 * 0.2 * s, e), -TABLET_DIST);
    tab.rotation.set(lerp(-1.05, 0, e), lerp(-0.35, 0, e), lerp(0.28, 0, e));
  }

  /** Desenha o mapa na textura da tela do tablet (antes do quadro principal). */
  render(): void {
    if (this.state === 'closed') return;
    this.map.render(this.d.renderer, this.dt, this.d.camera.fov);
  }
}
