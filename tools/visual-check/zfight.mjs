// Acha triângulos de modelos .glb que ficam no mesmo plano, do mesmo lado e se sobrepõem (z-fighting).
// Uso: node zfight.mjs [pasta-de-modelos]   (com `--corrigido`, aplica antes src/render/coplanar.ts e mostra o que sobra)   (roda com o Node do projeto; precisa de `npm i` na raiz)
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from '../../node_modules/three/build/three.module.js';
import { GLTFLoader } from '../../node_modules/three/examples/jsm/loaders/GLTFLoader.js';

const fix = process.argv.includes('--corrigido');
const { separateCoplanar } = fix ? await import('../../src/render/coplanar.ts') : {};
const dir = process.argv.find((a, i) => i > 1 && !a.startsWith('--')) ?? path.resolve(import.meta.dirname, '../../src/assets/models');
const EPS = process.argv.includes('--corrigido') ? 0.003 : 0.004, MINAREA = 1e-4;
const bin = (n, q) => Math.round(n / q);

function tris(root) {
  root.updateMatrixWorld(true);
  const out = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    const pos = o.geometry.attributes.position, idx = o.geometry.index;
    const n = idx ? idx.count : pos.count;
    const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    for (let i = 0; i < n; i += 3) {
      for (let k = 0; k < 3; k++) v[k].fromBufferAttribute(pos, idx ? idx.getX(i + k) : i + k).applyMatrix4(o.matrixWorld);
      const nrm = new THREE.Vector3().subVectors(v[1], v[0]).cross(new THREE.Vector3().subVectors(v[2], v[0]));
      const area = nrm.length() / 2;
      if (area < MINAREA) continue;
      nrm.normalize();
      out.push({ v: v.map((x) => x.clone()), n: nrm, d: nrm.dot(v[0]), mesh: o.name || o.parent?.name || '?', area });
    }
  });
  return out;
}

// sobreposição 2D de dois triângulos no mesmo plano (SAT), com folga negativa: só conta área de verdade
function overlap(a, b) {
  const n = a.n;
  const ax = Math.abs(n.x) > 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(n, ax).normalize(), w = new THREE.Vector3().crossVectors(n, u);
  const P = (t) => t.v.map((p) => [p.dot(u), p.dot(w)]);
  const A = P(a), B = P(b);
  for (const T of [A, B]) {
    for (let i = 0; i < 3; i++) {
      const p = T[i], q = T[(i + 1) % 3];
      const nx = -(q[1] - p[1]), ny = q[0] - p[0], l = Math.hypot(nx, ny) || 1;
      const proj = (S) => S.map((s) => (s[0] * nx + s[1] * ny) / l);
      const pa = proj(A), pb = proj(B);
      if (Math.max(...pa) <= Math.min(...pb) + 0.01 || Math.max(...pb) <= Math.min(...pa) + 0.01) return false;
    }
  }
  return true;
}

const loader = new GLTFLoader();
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.glb'))) {
  const buf = fs.readFileSync(path.join(dir, f));
  const gltf = await new Promise((res, rej) => loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', res, rej));
  const t0 = performance.now();
  const moved = fix ? separateCoplanar(gltf.scene) : 0;
  const ms = (performance.now() - t0).toFixed(0);
  const T = tris(gltf.scene);
  const buckets = new Map();
  for (const t of T) {
    // do mesmo lado: normal igual; plano igual: distância igual
    const key = `${bin(t.n.x, 0.02)},${bin(t.n.y, 0.02)},${bin(t.n.z, 0.02)}`;
    (buckets.get(key) ?? buckets.set(key, []).get(key)).push(t);
  }
  const pairs = new Map();
  for (const list of buckets.values()) {
    list.sort((a, b) => a.d - b.d);
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length && list[j].d - list[i].d < EPS; j++) {
      if (list[i].mesh === list[j].mesh && Math.abs(list[i].d - list[j].d) < 1e-6) { /* mesma malha, plano idêntico: ainda conta */ }
      if (overlap(list[i], list[j])) {
        const c = list[i].v[0];
        const k = `${list[i].mesh} × ${list[j].mesh}`;
        const e = pairs.get(k) ?? { n: 0, at: c.toArray().map((x) => +x.toFixed(2)), dir: list[i].n.toArray().map((x) => +x.toFixed(1)) };
        e.n++;
        pairs.set(k, e);
      }
    }
  }
  const total = [...pairs.values()].reduce((s, e) => s + e.n, 0);
  console.log(`${f}: ${T.length} triângulos, ${total} pares no mesmo plano${fix ? ` (subiram ${moved} faces em ${ms} ms)` : ''}`);
  for (const [k, e] of [...pairs].sort((a, b) => b[1].n - a[1].n).slice(0, 8)) console.log(`   ${e.n}  ${k}  em ${JSON.stringify(e.at)} normal ${JSON.stringify(e.dir)}`);
}
