// Câmera isométrica em perspectiva estreita: segue o jogador, gira de 90° em 90° e tem zoom.
// Dentro de uma caverna (docs/design/MUNDO.md) ela chega mais perto do astronauta, numa transição suave.
import * as THREE from 'three';

export class IsoRig {
  yaw = Math.PI / 4;
  yawTarget = this.yaw;
  readonly pitch = 0.76;
  /** 0 = ao ar livre, 1 = dentro de caverna; `caveTarget` é para onde vai (quanto teto há sobre o astronauta) */
  cave = 0;
  caveTarget = 0;
  /** distância real da câmera ao astronauta neste quadro (menor que `dist` dentro de caverna) */
  eye = 30;
  dist = 30;
  distTarget = 30;
  /** dentro de caverna: fração do zoom do jogador e limites da distância */
  static readonly CAVE_ZOOM = 0.5;
  static readonly CAVE_MIN = 12;
  static readonly CAVE_MAX = 20;
  readonly min = 16;
  readonly max = 46;
  readonly target = new THREE.Vector3();
  /** multiplicador do tremor (configuração do jogador: 0 desliga) */
  shakeScale = 1;
  private trauma = 0;
  private time = 0;
  private readonly _f = new THREE.Vector3();
  private readonly _r = new THREE.Vector3();

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  rotate(dir: number): void {
    this.yawTarget += (dir * Math.PI) / 2;
  }

  zoom(factor: number): void {
    this.distTarget = THREE.MathUtils.clamp(this.distTarget * factor, this.min, this.max);
  }

  snap(focus: THREE.Vector3): void {
    this.target.copy(focus);
    this.update(0, focus, true);
  }

  update(dt: number, focus: THREE.Vector3, instant = false): void {
    const k = instant ? 1 : 1 - Math.exp(-7 * dt);
    this.target.lerp(focus, k);
    this.yaw += (this.yawTarget - this.yaw) * (instant ? 1 : 1 - Math.exp(-9 * dt));
    this.dist += (this.distTarget - this.dist) * (instant ? 1 : 1 - Math.exp(-8 * dt));
    this.cave += (this.caveTarget - this.cave) * (instant ? 1 : 1 - Math.exp(-3.2 * dt));
    // em caverna a câmera chega perto (o zoom do jogador ainda vale, em escala); a rocha na frente é cortada (cutaway.ts)
    const near = THREE.MathUtils.clamp(this.distTarget * IsoRig.CAVE_ZOOM, IsoRig.CAVE_MIN, IsoRig.CAVE_MAX);
    this.eye = this.dist + (Math.min(this.dist, near) - this.dist) * this.cave;
    const c = Math.cos(this.pitch);
    this.camera.position.set(
      this.target.x + Math.sin(this.yaw) * c * this.eye,
      this.target.y + Math.sin(this.pitch) * this.eye,
      this.target.z + Math.cos(this.yaw) * c * this.eye,
    );
    this.camera.lookAt(this.target);
    // tremor (trauma ao quadrado, ruído suave)
    if (this.trauma > 0) {
      this.time += dt;
      const s = this.trauma * this.trauma * 0.9 * this.shakeScale;
      const tt = this.time * 28;
      this.camera.position.x += Math.sin(tt * 1.1) * Math.sin(tt * 0.37) * s;
      this.camera.position.y += Math.sin(tt * 1.3 + 2) * Math.sin(tt * 0.51) * s;
      this.camera.position.z += Math.sin(tt * 0.9 + 4) * Math.sin(tt * 0.43) * s;
      this.camera.rotation.z += Math.sin(tt * 0.7) * s * 0.03;
      this.trauma = Math.max(0, this.trauma - dt * 1.4);
    }
  }

  /** Tremor que soma (pouso, meteoro, dano): golpes seguidos crescem até o máximo. */
  shake(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /**
   * Tremor que não soma: garante pelo menos este nível, sem passar dele. Para o que se repete rápido
   * (golpes da broca, blocos quebrando em sequência), que com `shake` acumularia sem parar.
   */
  kick(level: number): void {
    this.trauma = Math.max(this.trauma, Math.min(1, level));
  }

  /** nível atual do tremor (0..1) */
  get shaking(): number {
    return this.trauma;
  }

  forward(): THREE.Vector3 {
    return this._f.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  right(): THREE.Vector3 {
    return this._r.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }

  /** rumo em graus (0 = norte = -z) */
  heading(): number {
    const f = this.forward();
    return (THREE.MathUtils.radToDeg(Math.atan2(f.x, -f.z)) + 360) % 360;
  }
}
