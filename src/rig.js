// Câmera isométrica em perspectiva estreita: segue o jogador, gira de 90° em 90° e tem zoom.
import * as THREE from 'three';

export class IsoRig {
  constructor(camera) {
    this.camera = camera;
    this.yaw = Math.PI / 4;
    this.yawTarget = this.yaw;
    this.pitch = 0.76;
    this.dist = 30;
    this.distTarget = 30;
    this.min = 16;
    this.max = 46;
    this.target = new THREE.Vector3();
    this._f = new THREE.Vector3();
    this._r = new THREE.Vector3();
  }
  rotate(dir) { this.yawTarget += (dir * Math.PI) / 2; }
  zoom(factor) { this.distTarget = THREE.MathUtils.clamp(this.distTarget * factor, this.min, this.max); }
  snap(focus) { this.target.copy(focus); this.update(0, focus, true); }

  update(dt, focus, instant = false) {
    const k = instant ? 1 : 1 - Math.exp(-7 * dt);
    this.target.lerp(focus, k);
    this.yaw += (this.yawTarget - this.yaw) * (instant ? 1 : 1 - Math.exp(-9 * dt));
    this.dist += (this.distTarget - this.dist) * (instant ? 1 : 1 - Math.exp(-8 * dt));
    const c = Math.cos(this.pitch);
    this.camera.position.set(
      this.target.x + Math.sin(this.yaw) * c * this.dist,
      this.target.y + Math.sin(this.pitch) * this.dist,
      this.target.z + Math.cos(this.yaw) * c * this.dist,
    );
    this.camera.lookAt(this.target);
    // tremor (trauma ao quadrado, ruído suave)
    if (this.trauma > 0) {
      this.time = (this.time || 0) + dt;
      const s = this.trauma * this.trauma * 0.9;
      const tt = this.time * 28;
      this.camera.position.x += Math.sin(tt * 1.1) * Math.sin(tt * 0.37) * s;
      this.camera.position.y += Math.sin(tt * 1.3 + 2) * Math.sin(tt * 0.51) * s;
      this.camera.position.z += Math.sin(tt * 0.9 + 4) * Math.sin(tt * 0.43) * s;
      this.camera.rotation.z += Math.sin(tt * 0.7) * s * 0.03;
      this.trauma = Math.max(0, this.trauma - dt * 1.4);
    }
  }
  shake(amount) { this.trauma = Math.min(1, (this.trauma || 0) + amount); }
  forward() { return this._f.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }
  right() { return this._r.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)); }
  // rumo em graus (0 = norte = -z)
  heading() {
    const f = this.forward();
    return (THREE.MathUtils.radToDeg(Math.atan2(f.x, -f.z)) + 360) % 360;
  }
}
