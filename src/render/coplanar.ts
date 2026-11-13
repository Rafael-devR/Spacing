// Corrige z-fighting dos modelos (docs/design/MODELOS.md): faces do mesmo lado, no mesmo plano e que se sobrepõem disputam a
// profundidade e piscam. Ao carregar, cada face que fica por cima de outra (a que vem depois na ordem do arquivo) sobe uma fração
// de bloco, em escada se houver várias. As emendas ganham uma fresta de poucos milímetros, que ninguém vê.
import * as THREE from 'three';

/** quanto cada degrau sobe (blocos) */
export const COPLANAR_STEP = 0.006;
const PLANE_TOL = 0.004;
const NORMAL_Q = 0.02;
const MIN_AREA = 1e-4;

interface Tri {
  mesh: THREE.Mesh;
  /** posição do primeiro vértice no atributo (3 vértices seguidos) */
  at: number;
  v: THREE.Vector3[];
  n: THREE.Vector3;
  d: number;
  ord: number;
  level: number;
}

function overlap(a: Tri, b: Tri): boolean {
  const n = a.n;
  const ref = Math.abs(n.x) > 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(n, ref).normalize();
  const w = new THREE.Vector3().crossVectors(n, u);
  const P = (t: Tri): number[][] => t.v.map((p) => [p.dot(u), p.dot(w)]);
  const A = P(a), B = P(b);
  for (const T of [A, B]) {
    for (let i = 0; i < 3; i++) {
      const p = T[i], q = T[(i + 1) % 3];
      const nx = -(q[1] - p[1]), ny = q[0] - p[0], l = Math.hypot(nx, ny) || 1;
      let aMin = Infinity, aMax = -Infinity, bMin = Infinity, bMax = -Infinity;
      for (const s of A) { const x = (s[0] * nx + s[1] * ny) / l; aMin = Math.min(aMin, x); aMax = Math.max(aMax, x); }
      for (const s of B) { const x = (s[0] * nx + s[1] * ny) / l; bMin = Math.min(bMin, x); bMax = Math.max(bMax, x); }
      if (aMax <= bMin + 0.01 || bMax <= aMin + 0.01) return false;
    }
  }
  return true;
}

/** Separa as faces coplanares do modelo (muda a geometria; chame uma vez por modelo carregado). Devolve quantas faces subiram. */
export function separateCoplanar(root: THREE.Object3D): number {
  root.updateMatrixWorld(true);
  const tris: Tri[] = [];
  const seen = new Map<THREE.BufferGeometry, THREE.BufferGeometry>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    let g = seen.get(mesh.geometry);
    if (!g) {
      g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
      seen.set(mesh.geometry, g);
    }
    mesh.geometry = g;
    const pos = g.attributes.position;
    for (let i = 0; i + 2 < pos.count; i += 3) {
      const v = [0, 1, 2].map((k) => new THREE.Vector3().fromBufferAttribute(pos, i + k).applyMatrix4(mesh.matrixWorld));
      const n = new THREE.Vector3().subVectors(v[1], v[0]).cross(new THREE.Vector3().subVectors(v[2], v[0]));
      const area = n.length() / 2;
      if (area < MIN_AREA) continue;
      n.normalize();
      tris.push({ mesh, at: i, v, n, d: n.dot(v[0]), ord: tris.length, level: 0 });
    }
  });
  const buckets = new Map<string, Tri[]>();
  for (const t of tris) {
    const key = `${Math.round(t.n.x / NORMAL_Q)},${Math.round(t.n.y / NORMAL_Q)},${Math.round(t.n.z / NORMAL_Q)}`;
    const list = buckets.get(key);
    if (list) list.push(t);
    else buckets.set(key, [t]);
  }
  const pairs: [Tri, Tri][] = [];
  for (const list of buckets.values()) {
    list.sort((a, b) => a.d - b.d);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length && list[j].d - list[i].d < PLANE_TOL; j++) {
        if (!overlap(list[i], list[j])) continue;
        pairs.push(list[i].ord < list[j].ord ? [list[i], list[j]] : [list[j], list[i]]);
      }
    }
  }
  pairs.sort((x, y) => x[0].ord - y[0].ord);
  for (const [a, b] of pairs) b.level = Math.max(b.level, a.level + 1);
  let moved = 0;
  const inv = new THREE.Matrix4();
  const delta = new THREE.Vector3();
  for (const t of tris) {
    if (t.level === 0) continue;
    moved++;
    inv.copy(t.mesh.matrixWorld).invert().setPosition(0, 0, 0);
    delta.copy(t.n).multiplyScalar(Math.min(t.level, 8) * COPLANAR_STEP).applyMatrix4(inv);
    const pos = t.mesh.geometry.attributes.position;
    for (let k = 0; k < 3; k++) pos.setXYZ(t.at + k, pos.getX(t.at + k) + delta.x, pos.getY(t.at + k) + delta.y, pos.getZ(t.at + k) + delta.z);
    pos.needsUpdate = true;
  }
  return moved;
}
