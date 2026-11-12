// Modelos feitos no Blender (docs/design/MODELOS.md, ADR 0013). Os .glb saem dos scripts de tools/models/ e trazem só
// geometria, cor por vértice (com a oclusão assada) e pontos marcados (vazios). O material é sempre o nosso: o modelo
// fica com a mesma luz, sombra, brilho e névoa que o resto do mundo. Peças com nome começando por "glow" brilham.
// Se um arquivo não carregar, `model()` devolve null e o jogo usa o modelo feito em código (render/models.ts).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import landerUrl from '../assets/models/lander.glb?url';
import { patchMaterial } from './materials';

export type ModelId = 'lander';

const URLS: Record<ModelId, string> = { lander: landerUrl };
const loaded = new Map<ModelId, THREE.Object3D>();

let body: THREE.MeshLambertMaterial | null = null;
let glow: THREE.MeshLambertMaterial | null = null;

function materials(): { body: THREE.MeshLambertMaterial; glow: THREE.MeshLambertMaterial } {
  body ??= patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), { glow: true, name: 'models' });
  glow ??= new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive: new THREE.Color('#1b2a6a') });
  return { body, glow };
}

/** Troca os materiais do arquivo pelos do jogo e liga as sombras. */
export function prepareModel(root: THREE.Object3D): THREE.Object3D {
  const m = materials();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const old = mesh.material as THREE.Material | THREE.Material[];
    for (const x of Array.isArray(old) ? old : [old]) x.dispose();
    const lit = /^glow/i.test(mesh.name);
    mesh.material = lit ? m.glow : m.body;
    mesh.castShadow = !lit;
    mesh.receiveShadow = true;
  });
  return root;
}

/** Carrega todos os modelos. Nunca falha: o que não carregar fica de fora e o jogo usa o modelo em código. */
export async function loadModels(): Promise<void> {
  const loader = new GLTFLoader();
  await Promise.all(
    (Object.keys(URLS) as ModelId[]).map(async (id) => {
      try {
        const gltf = await loader.loadAsync(URLS[id]);
        loaded.set(id, prepareModel(gltf.scene));
      } catch (err) {
        console.warn(`modelo ${id} não carregou; usando o modelo em código`, err);
      }
    }),
  );
}

/** Uma cópia do modelo (a geometria e o material são compartilhados), ou null se ele não carregou. */
export function model(id: ModelId): THREE.Object3D | null {
  return loaded.get(id)?.clone() ?? null;
}

/** Posição de um ponto marcado no modelo (um vazio do Blender), relativa ao modelo. */
export function marker(root: THREE.Object3D, name: string): THREE.Vector3 | null {
  const o = root.getObjectByName(name);
  return o ? o.position.clone() : null;
}
