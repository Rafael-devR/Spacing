// Modelos das estações fabricáveis da base (docs/design/CRAFTING.md): forno solar e eletrolisador. Antes de
// construída, a estação é só um holograma do que vai ser; construída, a máquina mostra que está trabalhando
// (brilho, calor, bolhas) e acende a luz verde quando há algo para pegar. Quem decide o estado é o BaseDirector.
import * as THREE from 'three';
import type { StationId } from '../data/stations';

const lam = (hex: THREE.ColorRepresentation, extra: THREE.MeshLambertMaterialParameters = {}): THREE.MeshLambertMaterial =>
  new THREE.MeshLambertMaterial({ color: hex, flatShading: true, ...extra });
const glow = (r: number, g: number, b: number, opacity = 1): THREE.MeshBasicMaterial =>
  new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b), transparent: opacity < 1, opacity, toneMapped: false, fog: false });

const HULL = '#c3c7d2', DARK = '#4b4f60', METAL = '#8c90a0', ORANGE = '#ff7a2f';

export abstract class StationModel {
  /** partícula no mundo (o BaseDirector liga às partículas): posição, velocidade, cor linear e vida */
  onParticle: ((x: number, y: number, z: number, vx: number, vy: number, vz: number, color: [number, number, number], life: number) => void) | null = null;
  /** 0..1: quanto a máquina está trabalhando (suaviza sozinho até `working`) */
  protected work = 0;
  working = false;
  ready = false;
  /** 0..1 do trabalho atual */
  progress = 0;
  protected readonly machine = new THREE.Group();
  private holo: THREE.LineSegments | null = null;
  private readonly holoMat: THREE.LineBasicMaterial;
  protected readonly lamp: THREE.MeshBasicMaterial;
  private built = false;
  private pop = 1;
  private flash = 0;
  protected readonly tmp = new THREE.Vector3();

  constructor(
    protected readonly g: THREE.Group,
    accent: THREE.Color,
  ) {
    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.04, 0.92), lam(DARK));
    pad.position.y = 0.02;
    pad.receiveShadow = true;
    g.add(pad);
    g.add(this.machine);
    this.lamp = glow(0.5, 0.5, 0.5);
    this.holoMat = new THREE.LineBasicMaterial({
      color: accent.clone().multiplyScalar(1.6), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
  }

  /** As subclasses chamam no fim do construtor, depois de montar a máquina em `machine`: sombras e holograma. */
  protected finishSetup(): void {
    const g = this.g;
    this.machine.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !(m.material instanceof THREE.MeshBasicMaterial)) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
    // holograma: arestas da máquina inteira, na cor da estação
    this.machine.updateMatrixWorld(true);
    const pos: number[] = [];
    const inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
    this.machine.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const e = new THREE.EdgesGeometry(m.geometry, 30);
      const mat = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
      const a = e.getAttribute('position');
      for (let i = 0; i < a.count; i++) {
        this.tmp.fromBufferAttribute(a, i).applyMatrix4(mat);
        pos.push(this.tmp.x, this.tmp.y, this.tmp.z);
      }
      e.dispose();
    });
    const hg = new THREE.BufferGeometry();
    hg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.holo = new THREE.LineSegments(hg, this.holoMat);
    g.add(this.holo);
    this.setBuilt(false, false);
  }

  /** partes altas que não cabem num ícone (o tubo de luz até o teto) */
  protected readonly tall: THREE.Object3D[] = [];

  /** Para desenhar o ícone: máquina pronta, sem as partes que vão até o teto. */
  iconPose(): void {
    this.setBuilt(true, false);
    // fora do grupo (a caixa do ícone conta até o que está escondido)
    for (const o of this.tall) o.removeFromParent();
    this.holo?.removeFromParent();
  }

  /** animação de trabalho (`work` de 0 a 1) */
  protected abstract animate(dt: number, time: number, work: number): void;

  get isBuilt(): boolean {
    return this.built;
  }

  /** Construída ou não. `animate`: a máquina cresce com um clarão (acabou de ser fabricada). */
  setBuilt(on: boolean, animate: boolean): void {
    this.built = on;
    this.machine.visible = on;
    if (this.holo) this.holo.visible = !on;
    if (on && animate) {
      this.pop = 0;
      this.flash = 1;
    } else this.pop = 1;
  }

  /** ponto do mundo no alto da máquina (som, partículas, peça que sai) */
  topPosition(out: THREE.Vector3): THREE.Vector3 {
    return this.g.localToWorld(out.set(0, 1.0, 0.1));
  }

  update(dt: number, time: number): void {
    const want = this.built && this.working && !this.ready ? 1 : 0;
    this.work += (want - this.work) * (1 - Math.exp(-dt * 3));
    if (!this.built) {
      this.holoMat.opacity = 0.28 + 0.18 * Math.sin(time * 2.2);
      return;
    }
    if (this.pop < 1) {
      this.pop = Math.min(1, this.pop + dt * 1.8);
      const k = this.pop;
      const s = 1 + Math.sin(k * Math.PI) * 0.18 - (1 - k) * 0.8;
      this.machine.scale.setScalar(Math.max(0.05, s));
    } else this.machine.scale.setScalar(1);
    this.flash = Math.max(0, this.flash - dt * 1.5);
    // luz de estado: verde = pronto (pisca), âmbar = trabalhando, azul fraco = livre
    const blink = Math.sin(time * 6) > 0 ? 1 : 0.35;
    if (this.ready) this.lamp.color.setRGB(0.3 * blink, 2.4 * blink, 0.8 * blink);
    else if (this.working) this.lamp.color.setRGB(2.4, 1.1, 0.25);
    else this.lamp.color.setRGB(0.25, 0.6, 0.9);
    this.animate(dt, time, this.work);
    if (this.flash > 0) this.lamp.color.addScalar(this.flash * 3);
  }
}

/** Forno solar: câmara de tijolo com janela de quartzo e o tubo de luz que desce dos espelhos do telhado. */
export class FurnaceModel extends StationModel {
  private readonly window: THREE.MeshBasicMaterial = glow(1.2, 0.35, 0.08);
  private readonly core: THREE.MeshBasicMaterial = glow(2.4, 1.6, 0.6, 0.85);
  private readonly ring: THREE.MeshBasicMaterial = glow(2.2, 0.9, 0.2);
  private puffT = 0;

  constructor(g: THREE.Group) {
    super(g, new THREE.Color('#ff8a3d'));
    this.buildMachine(this.machine, this.lamp);
    this.finishSetup();
  }

  /** local: frente para +z, piso em y = 0, cabe em 1×1 */
  private buildMachine(m: THREE.Group, lamp: THREE.MeshBasicMaterial): void {
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      m.add(mesh);
      return mesh;
    };
    const brick = lam('#b6a48e'), hull = lam(HULL), dark = lam(DARK), metal = lam(METAL);
    add(new THREE.BoxGeometry(0.84, 0.12, 0.8), dark, 0, 0.1, 0);
    add(new THREE.BoxGeometry(0.76, 0.86, 0.7), brick, 0, 0.59, -0.02);
    add(new THREE.BoxGeometry(0.8, 0.08, 0.74), hull, 0, 1.05, -0.02);
    // porta com janela
    add(new THREE.BoxGeometry(0.54, 0.5, 0.05), metal, 0, 0.6, 0.345);
    add(new THREE.PlaneGeometry(0.36, 0.26), this.window, 0, 0.64, 0.373);
    add(new THREE.BoxGeometry(0.4, 0.04, 0.06), dark, 0, 0.42, 0.38);
    // luz de estado
    add(new THREE.BoxGeometry(0.12, 0.05, 0.03), lamp, 0.27, 0.95, 0.335);
    add(new THREE.BoxGeometry(0.08, 0.2, 0.08), lam(ORANGE), -0.3, 0.95, 0.3);
    // tubo de luz até o teto (fibra que traz o sol concentrado)
    add(new THREE.CylinderGeometry(0.11, 0.13, 0.24, 8), metal, 0, 1.2, -0.12);
    this.tall.push(add(new THREE.CylinderGeometry(0.07, 0.07, 1.8, 8), hull, 0, 2.2, -0.12));
    this.tall.push(add(new THREE.CylinderGeometry(0.035, 0.035, 1.82, 6), this.core, 0, 2.2, -0.12));
    add(new THREE.TorusGeometry(0.09, 0.02, 4, 10), this.ring, 0, 1.36, -0.12).rotation.x = Math.PI / 2;
  }

  protected animate(dt: number, time: number, w: number): void {
    const flick = 0.85 + 0.15 * Math.sin(time * 23) * Math.sin(time * 7.3);
    const heat = 0.25 + w * 2.6 * flick;
    this.window.color.setRGB(heat * 1.3, heat * 0.5, heat * 0.12);
    const k = 0.2 + w * (0.9 + 0.1 * Math.sin(time * 9));
    this.core.color.setRGB(2.6 * k, 1.8 * k, 0.7 * k);
    this.core.opacity = 0.25 + 0.6 * w;
    this.ring.color.setRGB(2.2 * k, 0.9 * k, 0.2 * k);
    // brasas saindo do respiro de cima enquanto trabalha
    if (w > 0.4 && this.onParticle) {
      this.puffT -= dt;
      if (this.puffT <= 0) {
        this.puffT = 0.12;
        const p = this.g.localToWorld(this.tmp.set((Math.random() - 0.5) * 0.3, 0.68, 0.4));
        this.onParticle(p.x, p.y, p.z, (Math.random() - 0.5) * 0.4, 0.6 + Math.random() * 0.8, (Math.random() - 0.5) * 0.4, [2.6, 0.9, 0.2], 0.5);
      }
    }
  }
}

/** Eletrolisador: cuba de vidro com bolhas e dois tanques (o de H₂ tem o dobro do tamanho do de O₂). */
export class ElectrolyzerModel extends StationModel {
  private readonly bubbles: THREE.Mesh[] = [];
  private readonly bubbleMat = glow(1.6, 2.2, 2.6, 0.8);
  private readonly liquid = glow(0.15, 0.55, 0.9, 0.75);
  private readonly arc = glow(0.6, 1.8, 2.6);

  constructor(g: THREE.Group) {
    super(g, new THREE.Color('#5fd0ff'));
    this.buildMachine(this.machine, this.lamp);
    this.finishSetup();
  }

  /** local: frente para +z, piso em y = 0, cabe em 1×1 */
  private buildMachine(m: THREE.Group, lamp: THREE.MeshBasicMaterial): void {
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      m.add(mesh);
      return mesh;
    };
    const hull = lam(HULL), dark = lam(DARK), metal = lam(METAL);
    add(new THREE.BoxGeometry(0.86, 0.14, 0.8), dark, 0, 0.11, 0);
    // tanques atrás: H₂ (alto, faixa laranja) e O₂ (baixo, faixa azul)
    add(new THREE.CylinderGeometry(0.17, 0.17, 1.2, 10), hull, -0.2, 0.78, -0.22);
    add(new THREE.CylinderGeometry(0.175, 0.175, 0.12, 10), lam('#ff8a3d'), -0.2, 1.05, -0.22);
    add(new THREE.SphereGeometry(0.17, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), hull, -0.2, 1.38, -0.22);
    add(new THREE.CylinderGeometry(0.15, 0.15, 0.62, 10), hull, 0.22, 0.49, -0.22);
    add(new THREE.CylinderGeometry(0.155, 0.155, 0.1, 10), lam('#4fb8ff'), 0.22, 0.62, -0.22);
    add(new THREE.SphereGeometry(0.15, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), hull, 0.22, 0.8, -0.22);
    // cuba de vidro na frente, com água e dois eletrodos
    add(new THREE.BoxGeometry(0.58, 0.3, 0.26), this.liquid, 0, 0.36, 0.17);
    add(new THREE.BoxGeometry(0.62, 0.42, 0.3), new THREE.MeshLambertMaterial({ color: '#bff4ff', transparent: true, opacity: 0.25, depthWrite: false }), 0, 0.4, 0.17);
    for (const sx of [-1, 1]) {
      add(new THREE.BoxGeometry(0.05, 0.4, 0.05), metal, sx * 0.15, 0.48, 0.17);
      // cano do eletrodo até o tanque do seu gás
      add(new THREE.CylinderGeometry(0.025, 0.025, 0.3, 5), metal, sx * 0.15, 0.78, 0.0).rotation.x = 0.9;
    }
    add(new THREE.BoxGeometry(0.3, 0.015, 0.015), this.arc, 0, 0.67, 0.17);
    add(new THREE.BoxGeometry(0.12, 0.05, 0.03), lamp, 0.3, 0.2, 0.41);
    for (let i = 0; i < 10; i++) {
      const b = add(new THREE.OctahedronGeometry(0.018 + (i % 3) * 0.006), this.bubbleMat, 0, 0.25, 0.17);
      b.userData.seed = i * 0.37;
      this.bubbles.push(b);
    }
  }

  protected animate(_dt: number, time: number, w: number): void {
    this.liquid.color.setRGB(0.15 + w * 0.2, 0.55 + w * 0.5, 0.9 + w * 0.8);
    const k = w * (0.6 + 0.4 * Math.abs(Math.sin(time * 31)));
    this.arc.color.setRGB(0.6 * k, 1.8 * k, 2.6 * k);
    this.bubbleMat.opacity = 0.85 * w;
    for (let i = 0; i < this.bubbles.length; i++) {
      const b = this.bubbles[i];
      // metade sobe do eletrodo de H₂ (esquerda, mais bolhas) e metade do de O₂
      const side = i < 7 ? -1 : 1;
      const f = (time * (0.7 + (i % 4) * 0.12) + (b.userData.seed as number)) % 1;
      b.visible = w > 0.05;
      b.position.set(side * 0.15 + Math.sin(f * 12 + i) * 0.03, 0.22 + f * 0.28, 0.17 + Math.cos(i * 1.7) * 0.07);
    }
  }
}

export function createStationModel(id: StationId, g: THREE.Group): StationModel | null {
  if (id === 'furnace') return new FurnaceModel(g);
  if (id === 'electrolyzer') return new ElectrolyzerModel(g);
  return null;
}
