// Partículas sem colisão (faíscas, poeira, brasas) e poeira flutuando perto da câmera.
import * as THREE from 'three';
import type { RGB } from '../core/color';

interface Particle {
  life: number;
  max: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  size: number;
  gravity: number;
  grow: boolean;
  rx: number;
  ry: number;
  spin: number;
}

export class Particles {
  readonly mesh: THREE.InstancedMesh;
  private readonly p: Particle[] = [];
  private readonly free: number[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly c = new THREE.Color();

  constructor(
    scene: THREE.Scene,
    private readonly max = 320,
  ) {
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    const white = new THREE.Color(1, 1, 1);
    for (let i = 0; i < max; i++) {
      this.mesh.setMatrixAt(i, zero);
      this.mesh.setColorAt(i, white);
      this.p.push({ life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, size: 0, gravity: 0, grow: false, rx: 0, ry: 0, spin: 0 });
      this.free.push(i);
    }
    scene.add(this.mesh);
  }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, rgb: RGB, life = 1, gravity = 7, grow = false): void {
    const i = this.free.pop();
    if (i === undefined) return;
    Object.assign(this.p[i], {
      x, y, z, vx, vy, vz, size, life, max: life, gravity, grow,
      rx: Math.random() * 6, ry: Math.random() * 6, spin: (Math.random() - 0.5) * 10,
    });
    this.c.setRGB(rgb[0], rgb[1], rgb[2]);
    this.mesh.setColorAt(i, this.c);
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  burst(x: number, y: number, z: number, rgb: RGB, n = 10, power = 3): void {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (0.4 + Math.random()) * power;
      const shade = 0.8 + Math.random() * 0.35;
      this.spawn(x, y, z, Math.cos(a) * sp, 1.5 + Math.random() * power, Math.sin(a) * sp,
        0.09 + Math.random() * 0.12, [rgb[0] * shade, rgb[1] * shade, rgb[2] * shade], 0.9 + Math.random() * 0.7);
    }
  }

  dust(x: number, y: number, z: number, n = 3, spread = 0.25): void {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      this.spawn(x + Math.cos(a) * spread, y + 0.05, z + Math.sin(a) * spread,
        Math.cos(a) * 0.8, 0.4 + Math.random() * 0.6, Math.sin(a) * 0.8, 0.12 + Math.random() * 0.1,
        [0.62, 0.58, 0.56], 0.6 + Math.random() * 0.4, -0.2, true);
    }
  }

  update(dt: number): void {
    let changed = false;
    for (let i = 0; i < this.max; i++) {
      const p = this.p[i];
      if (p.life <= 0) continue;
      changed = true;
      p.life -= dt;
      if (p.life <= 0) {
        this.mesh.setMatrixAt(i, this.m.makeScale(0, 0, 0));
        this.free.push(i);
        continue;
      }
      p.vy -= p.gravity * dt;
      p.vx *= 1 - dt * 1.2;
      p.vz *= 1 - dt * 1.2;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.rx += p.spin * dt;
      p.ry += p.spin * dt;
      const t = p.life / p.max;
      const sc = p.grow ? p.size * (1 + (1 - t) * 1.6) * Math.min(1, t * 3) : p.size * Math.min(1, t * 2.5);
      this.q.setFromEuler(this.e.set(p.rx, p.ry, 0));
      this.m.compose(this.v.set(p.x, p.y, p.z), this.q, this.s.set(sc, sc, sc));
      this.mesh.setMatrixAt(i, this.m);
    }
    if (changed) this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export interface Motes {
  update(dt: number, center: THREE.Vector3, t: number): void;
}

// Poeira flutuando perto da câmera
export function createMotes(scene: THREE.Scene): Motes {
  const n = 140;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 40;
    pos[i * 3 + 1] = Math.random() * 10;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 40;
  }
  const geo = new THREE.BufferGeometry();
  const attr = new THREE.BufferAttribute(pos, 3);
  geo.setAttribute('position', attr);
  const cv = document.createElement('canvas');
  cv.width = cv.height = 32;
  const g = cv.getContext('2d');
  if (g) {
    const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 32, 32);
  }
  const mat = new THREE.PointsMaterial({
    size: 0.16, map: new THREE.CanvasTexture(cv), transparent: true, opacity: 0.55,
    depthWrite: false, color: '#ffe9c8', fog: false, blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  scene.add(pts);
  return {
    update(dt, center, t) {
      const a = pos;
      for (let i = 0; i < n; i++) {
        let x = a[i * 3], y = a[i * 3 + 1], z = a[i * 3 + 2];
        x += Math.sin(t * 0.3 + i) * dt * 0.25;
        y += dt * 0.12;
        z += Math.cos(t * 0.27 + i * 1.7) * dt * 0.25;
        if (x - center.x > 20) x -= 40;
        else if (x - center.x < -20) x += 40;
        if (z - center.z > 20) z -= 40;
        else if (z - center.z < -20) z += 40;
        if (y - center.y > 9) y -= 11;
        else if (y - center.y < -2) y += 11;
        a[i * 3] = x;
        a[i * 3 + 1] = y;
        a[i * 3 + 2] = z;
      }
      attr.needsUpdate = true;
    },
  };
}
