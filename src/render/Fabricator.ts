// Bancada de fabricação: modelo e animação do laser (docs/design/BASE.md).
// A peça é "impressa" de baixo para cima: um plano de corte sobe, a parte de baixo já aparece sólida,
// o holograma em linhas mostra o que falta, e dois lasers num pórtico varrem a camada atual soltando faíscas.
// Quem decide quando começa e termina é o BaseDirector (a partir do sistema Crafting).
// O corpo da bancada e o vaivém do carro vêm do Blender (tools/models/workbench.py, animação em laço tocada enquanto
// imprime); os lasers saem dos pontos emitter_0/1 presos ao carro. Sem o .glb, a bancada é montada aqui em código.
import * as THREE from 'three';
import { model, modelClip } from './gltfModels';

const lam = (hex: THREE.ColorRepresentation, extra: THREE.MeshLambertMaterialParameters = {}): THREE.MeshLambertMaterial =>
  new THREE.MeshLambertMaterial({ color: hex, flatShading: true, ...extra });
const additive = (r: number, g: number, b: number, opacity = 1): THREE.MeshBasicMaterial =>
  new THREE.MeshBasicMaterial({
    color: new THREE.Color(r, g, b), transparent: true, opacity, blending: THREE.AdditiveBlending,
    depthWrite: false, toneMapped: false, fog: false,
  });

/** altura do tampo da bancada (local) */
const BED_Y = 0.9;
/** altura dos emissores */
const HEAD_Y = 1.86;

type Phase = 'idle' | 'printing' | 'done';

export class Fabricator {
  /** faísca no mundo (o BaseDirector liga às partículas) */
  onSpark: ((x: number, y: number, z: number) => void) | null = null;
  /** 0..1 da impressão, definido de fora a cada quadro */
  progress = 0;
  private phase: Phase = 'idle';
  private t = 0;
  private readonly carriage: THREE.Object3D;
  /** `from`: ponto do modelo do Blender de onde o laser sai (anda com o carro); sem ele, `tip` relativo ao carro */
  private readonly beams: { core: THREE.Mesh; glow: THREE.Mesh; tip: THREE.Vector3; from: THREE.Object3D | null }[] = [];
  private readonly mixer: THREE.AnimationMixer | null = null;
  private readonly bedMat: THREE.MeshBasicMaterial;
  private readonly lampMat: THREE.MeshBasicMaterial;
  private readonly scanMat: THREE.MeshBasicMaterial;
  private readonly scan: THREE.Mesh;
  private readonly clip = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
  private piece: THREE.Object3D | null = null;
  private holo: THREE.LineSegments | null = null;
  private readonly holoMat = new THREE.LineBasicMaterial({
    color: new THREE.Color(0.5, 1.9, 2.3), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  });
  private pieceH = 0.4;
  private pieceY = 0;
  private pieceR = 0.3;
  private sparkT = 0;
  private flash = 0;
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(
    private readonly g: THREE.Group,
    w: number,
    d: number,
  ) {
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = g): THREE.Mesh => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      parent.add(m);
      return m;
    };
    this.bedMat = new THREE.MeshBasicMaterial({ map: gridTexture(), color: new THREE.Color(0.35, 0.9, 1.1), toneMapped: false, transparent: true });
    const bed = add(new THREE.PlaneGeometry(w * 0.58, d * 0.56), this.bedMat, 0, BED_Y + 0.003, 0);
    bed.rotation.x = -Math.PI / 2;
    bed.castShadow = false;
    this.lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 1.9, 2.3), toneMapped: false });
    const beam = (): { core: THREE.Mesh; glow: THREE.Mesh } => {
      const core = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 1, 6, 1, true), additive(3.4, 3.4, 3.6));
      const glowM = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 1, 8, 1, true), additive(0.5, 1.8, 2.8, 0.5));
      core.visible = glowM.visible = false;
      g.add(core, glowM);
      return { core, glow: glowM };
    };
    const body = model('workbench');
    if (body) {
      g.add(body);
      this.carriage = body.getObjectByName('carriage') ?? new THREE.Group();
      for (let i = 0; i < 2; i++) {
        const from = body.getObjectByName(`emitter_${i}`) ?? null;
        this.beams.push({ ...beam(), tip: new THREE.Vector3(), from });
      }
      const at = body.getObjectByName('lamp')?.position;
      if (at) add(new THREE.BoxGeometry(0.2, 0.04, 0.03), this.lampMat, at.x, at.y, at.z + 0.015, body).castShadow = false;
      const clip = modelClip('workbench');
      if (clip) {
        this.mixer = new THREE.AnimationMixer(body);
        this.mixer.clipAction(clip).play();
      }
    } else {
      const hull = lam('#c3c7d2'), dark = lam('#4b4f60'), metal = lam('#8c90a0'), orange = lam('#ff7a2f');
      // mesa
      add(new THREE.BoxGeometry(w * 0.94, 0.82, d * 0.78), hull, 0, 0.41, -d * 0.06);
      add(new THREE.BoxGeometry(w * 0.96, 0.07, d * 0.86), dark, 0, 0.855, -d * 0.04);
      add(new THREE.BoxGeometry(w * 0.94, 0.08, 0.04), orange, 0, 0.62, d * 0.34);
      // pórtico
      for (const sx of [-1, 1]) {
        add(new THREE.BoxGeometry(0.1, HEAD_Y + 0.24 - BED_Y, 0.12), metal, sx * w * 0.44, (BED_Y + HEAD_Y + 0.24) / 2, -d * 0.3);
        add(new THREE.BoxGeometry(0.08, 0.08, d * 0.36), metal, sx * w * 0.44, HEAD_Y + 0.2, -d * 0.13);
      }
      add(new THREE.BoxGeometry(w * 0.92, 0.09, 0.1), dark, 0, HEAD_Y + 0.2, 0);
      // carro com dois emissores
      const carriage = new THREE.Group();
      this.carriage = carriage;
      carriage.position.set(0, HEAD_Y + 0.2, 0);
      g.add(carriage);
      add(new THREE.BoxGeometry(0.3, 0.16, 0.24), hull, 0, -0.02, 0, this.carriage);
      add(new THREE.BoxGeometry(0.2, 0.03, 0.03), this.lampMat, 0, 0.07, 0.125, this.carriage);
      for (const sz of [-1, 1]) {
        const head = add(new THREE.ConeGeometry(0.05, 0.14, 6), dark, 0, -0.16, sz * 0.08, this.carriage);
        head.rotation.x = Math.PI;
        this.beams.push({ ...beam(), tip: new THREE.Vector3(0, -0.23, sz * 0.08), from: null });
      }
    }
    // camada atual (plano de varredura)
    this.scanMat = additive(0.4, 1.6, 2.2, 0);
    this.scan = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.scanMat);
    this.scan.rotation.x = -Math.PI / 2;
    this.scan.visible = false;
    g.add(this.scan);
  }

  get busy(): boolean {
    return this.phase === 'printing';
  }

  /** ponto do mundo onde a peça fica (para o BaseDirector) */
  piecePosition(out: THREE.Vector3): THREE.Vector3 {
    return this.g.localToWorld(out.set(0, BED_Y + this.pieceH / 2 + 0.05, 0));
  }

  /** Começa a imprimir `piece` (centrada na origem; a bancada não descarta). */
  start(piece: THREE.Object3D): void {
    this.clear();
    const box = new THREE.Box3().setFromObject(piece);
    const size = box.getSize(new THREE.Vector3());
    this.pieceH = Math.max(0.15, size.y);
    this.pieceR = Math.max(size.x, size.z) / 2;
    piece.position.set(0, BED_Y + 0.02 - box.min.y, 0);
    this.pieceY = piece.position.y;
    // materiais próprios com plano de corte (só aparece o que já foi "impresso")
    piece.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mats = (Array.isArray(m.material) ? m.material : [m.material]).map((mt) => {
        const c = mt.clone();
        c.clippingPlanes = [this.clip];
        return c;
      });
      m.material = Array.isArray(m.material) ? mats : mats[0];
    });
    this.g.add(piece);
    this.piece = piece;
    // holograma: contorno de todas as arestas
    piece.updateMatrixWorld(true);
    const pos: number[] = [];
    const inv = new THREE.Matrix4().copy(piece.matrixWorld).invert();
    piece.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const e = new THREE.EdgesGeometry(m.geometry, 25);
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
    this.holo.position.copy(piece.position);
    this.holo.scale.setScalar(1.015);
    this.g.add(this.holo);
    this.scan.scale.set(this.pieceR * 2.6, this.pieceR * 2.6, 1);
    this.phase = 'printing';
    this.t = 0;
    this.progress = 0;
  }

  /** Peça que já estava sendo impressa ao carregar o jogo: começa no ponto certo (e já pronta, se for o caso). */
  resume(piece: THREE.Object3D, progress: number, ready: boolean): void {
    this.start(piece);
    this.progress = progress;
    if (ready) {
      this.finish();
      this.flash = 0;
    }
  }

  /** tem uma peça pronta girando na bancada */
  get holding(): boolean {
    return this.phase === 'done' && this.piece !== null;
  }

  /** Terminou: peça inteira, lasers desligam, clarão. A peça fica girando até `takePiece`. */
  finish(): void {
    if (this.phase !== 'printing') return;
    this.phase = 'done';
    this.t = 0;
    this.progress = 1;
    this.flash = 1;
    this.clip.constant = 1e6;
  }

  /** Entrega a peça (para voar até o astronauta) e limpa a bancada. */
  takePiece(): THREE.Object3D | null {
    const p = this.piece;
    if (p) {
      p.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        for (const mt of Array.isArray(m.material) ? m.material : [m.material]) mt.clippingPlanes = null;
      });
      const world = p.getWorldPosition(new THREE.Vector3());
      this.g.remove(p);
      p.position.copy(world);
    }
    this.piece = null;
    this.clear();
    return p;
  }

  private clear(): void {
    if (this.holo) {
      this.g.remove(this.holo);
      this.holo.geometry.dispose();
      this.holo = null;
    }
    if (this.piece) this.g.remove(this.piece);
    this.piece = null;
    this.phase = 'idle';
    for (const b of this.beams) b.core.visible = b.glow.visible = false;
    this.scan.visible = false;
  }

  update(dt: number, time: number): void {
    this.t += dt;
    this.flash = Math.max(0, this.flash - dt * 2.2);
    const printing = this.phase === 'printing';
    const warm = printing ? Math.min(1, this.t / 0.4) : 0;
    // tampo e lâmpada
    const bedK = 0.35 + warm * (0.5 + 0.15 * Math.sin(time * 20)) + this.flash * 2.5;
    this.bedMat.color.setRGB(0.35 * bedK + this.flash, 0.9 * bedK + this.flash, 1.1 * bedK + this.flash);
    this.lampMat.color.setRGB(printing ? 2.4 : 0.5, printing ? 0.9 : 1.9, printing ? 0.3 : 2.3);

    // carro varre de um lado para o outro (no modelo do Blender, pela animação feita lá)
    if (this.mixer) this.mixer.update(dt * warm);
    else this.carriage.position.x = printing ? Math.sin(time * 5.2) * this.pieceR * 0.9 : this.carriage.position.x * Math.exp(-4 * dt);

    const layer = BED_Y + 0.02 + this.pieceH * Math.min(1, this.progress);
    if (this.piece && printing) {
      // plano de corte no mundo: mostra o que está abaixo da camada atual
      this.tmp.set(0, layer, 0);
      this.g.localToWorld(this.tmp);
      this.clip.constant = this.tmp.y;
    }
    if (this.piece) {
      const spin = this.phase === 'done' ? Math.min(1, this.t / 0.5) : 0;
      this.piece.rotation.y += dt * (0.4 + spin * 2.5);
      this.piece.position.y = this.pieceY + spin * (0.25 + 0.04 * Math.sin(time * 4));
      if (this.holo) {
        this.holo.rotation.y = this.piece.rotation.y;
        this.holo.position.y = this.piece.position.y;
      }
    }
    if (this.holo) {
      this.holoMat.opacity = printing ? 0.45 + 0.35 * Math.sin(time * 9) * 0.5 + 0.25 : Math.max(0, 0.8 - this.t * 2);
      this.holo.visible = this.holoMat.opacity > 0.01;
    }
    this.scan.visible = printing;
    this.scan.position.y = layer;
    this.scanMat.opacity = warm * (0.32 + 0.1 * Math.sin(time * 30));

    // lasers: dos emissores até um ponto que corre na camada atual
    for (let i = 0; i < this.beams.length; i++) {
      const b = this.beams[i];
      const on = printing && this.t > 0.15 && Math.sin(time * 60 + i * 2) > -0.85;
      b.core.visible = b.glow.visible = on;
      if (!on) continue;
      const from = b.from ? this.g.worldToLocal(b.from.getWorldPosition(this.tmp)) : this.tmp.copy(b.tip).add(this.carriage.position);
      const a = time * (7 + i * 2.3) + i * 1.7;
      const r = this.pieceR * (0.4 + 0.5 * Math.abs(Math.sin(time * 3.1 + i)));
      const to = this.tmp2.set(Math.cos(a) * r, layer, Math.sin(a * 1.3) * r * 0.8);
      const len = from.distanceTo(to);
      const mid = from.clone().add(to).multiplyScalar(0.5);
      const dir = to.clone().sub(from).normalize();
      for (const m of [b.core, b.glow]) {
        m.position.copy(mid);
        m.scale.set(1, len, 1);
        m.quaternion.setFromUnitVectors(this.up, dir);
      }
      (b.glow.material as THREE.MeshBasicMaterial).opacity = 0.4 + 0.3 * Math.random();
      // faíscas no ponto de contato
      this.sparkT -= dt;
      if (this.sparkT <= 0 && this.onSpark) {
        this.sparkT = 0.035;
        const w = this.g.localToWorld(to.clone());
        this.onSpark(w.x, w.y, w.z);
      }
    }
  }
}

function gridTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d')!;
  x.fillStyle = '#0b1834';
  x.fillRect(0, 0, 128, 128);
  x.strokeStyle = 'rgba(127,231,255,0.75)';
  x.lineWidth = 1;
  for (let i = 0; i <= 128; i += 16) {
    x.beginPath();
    x.moveTo(i + 0.5, 0);
    x.lineTo(i + 0.5, 128);
    x.moveTo(0, i + 0.5);
    x.lineTo(128, i + 0.5);
    x.stroke();
  }
  x.strokeStyle = 'rgba(127,231,255,1)';
  x.lineWidth = 3;
  x.strokeRect(2, 2, 124, 124);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
