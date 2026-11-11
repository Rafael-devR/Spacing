// Pegadas da bota no regolito (desenhadas por shader, somem com o tempo).
import * as THREE from 'three';

const MAX = 160;
const LIFE = 45;

export class Footprints {
  constructor(scene) {
    const geo = new THREE.PlaneGeometry(0.2, 0.32);
    geo.rotateX(-Math.PI / 2);
    this.fade = new Float32Array(MAX);
    geo.setAttribute('aFade', new THREE.InstancedBufferAttribute(this.fade, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
      uniforms: { uColor: { value: new THREE.Color(0.1, 0.085, 0.14) } },
      vertexShader: `
        attribute float aFade; varying float vFade; varying vec2 vUv;
        void main(){ vUv = uv; vFade = aFade; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        uniform vec3 uColor; varying float vFade; varying vec2 vUv;
        float ell(vec2 p, vec2 c, vec2 r){ return 1.0 - smoothstep(0.75, 1.0, length((p - c) / r)); }
        void main(){
          float sole = max(ell(vUv, vec2(0.5, 0.67), vec2(0.4, 0.3)), ell(vUv, vec2(0.5, 0.22), vec2(0.34, 0.2)));
          float tread = step(0.45, fract(vUv.y * 8.0));
          float a = sole * (0.5 + 0.5 * tread) * 0.45 * vFade;
          if (a < 0.01) discard;
          gl_FragColor = vec4(uColor, a);
        }`,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.life = new Float32Array(MAX);
    this.cells = new Array(MAX).fill(null);
    this.next = 0;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < MAX; i++) this.mesh.setMatrixAt(i, zero);
    scene.add(this.mesh);
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.up = new THREE.Vector3(0, 1, 0);
    this.p = new THREE.Vector3();
    this.one = new THREE.Vector3(1, 1, 1);
  }

  place(x, y, z, angle) {
    const i = this.next;
    this.next = (this.next + 1) % MAX;
    this.q.setFromAxisAngle(this.up, angle);
    this.m.compose(this.p.set(x, y + 0.012, z), this.q, this.one);
    this.mesh.setMatrixAt(i, this.m);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.life[i] = LIFE;
    this.fade[i] = 1;
    this.cells[i] = `${Math.floor(x)},${Math.round(y) - 1},${Math.floor(z)}`;
  }

  // apaga pegadas sobre um bloco alterado
  clearAt(x, y, z) {
    const k = `${x},${y},${z}`;
    for (let i = 0; i < MAX; i++) if (this.cells[i] === k) { this.life[i] = 0; this.fade[i] = 0; this.cells[i] = null; }
    this.mesh.geometry.attributes.aFade.needsUpdate = true;
  }

  update(dt) {
    let any = false;
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      this.fade[i] = Math.max(0, Math.min(1, this.life[i] / 10));
      any = true;
    }
    if (any) this.mesh.geometry.attributes.aFade.needsUpdate = true;
  }
}
