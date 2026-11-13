// Modelos feitos no Blender (docs/design/MODELOS.md, ADR 0013). Os .glb saem dos scripts de tools/models/ e trazem só
// geometria, cor por vértice (com a oclusão assada), pontos marcados (vazios) e, nas máquinas, uma animação em laço feita
// no Blender. O material é sempre o nosso: o modelo fica com a mesma luz, sombra, brilho e névoa que o resto do mundo.
// Nomes das peças:
//   glow*  brilham de leve (vidro escuro)          lit*   acesas de verdade (cor acima de 1, o bloom pega)
//   glass* vidro transparente                      fx*    o código troca o material e acende como quiser
// Se um arquivo não carregar, `model()` devolve null e o jogo usa o modelo feito em código.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import electrolyzerUrl from '../assets/models/electrolyzer.glb?url';
import farmUrl from '../assets/models/farm.glb?url';
import furnaceUrl from '../assets/models/furnace.glb?url';
import furnitureUrl from '../assets/models/furniture.glb?url';
import greenhouseUrl from '../assets/models/greenhouse.glb?url';
import habitatUrl from '../assets/models/habitat.glb?url';
import habitatInteriorUrl from '../assets/models/habitat_interior.glb?url';
import landerUrl from '../assets/models/lander.glb?url';
import meteorUrl from '../assets/models/meteor.glb?url';
import workbenchUrl from '../assets/models/workbench.glb?url';
import { separateCoplanar } from './coplanar';
import { patchMaterial } from './materials';

export type ModelId =
  | 'lander' | 'habitat' | 'habitat_interior' | 'furniture' | 'workbench' | 'furnace' | 'electrolyzer' | 'meteor' | 'greenhouse' | 'farm';

const URLS: Record<ModelId, string> = {
  lander: landerUrl, habitat: habitatUrl, habitat_interior: habitatInteriorUrl, furniture: furnitureUrl,
  workbench: workbenchUrl, furnace: furnaceUrl, electrolyzer: electrolyzerUrl, meteor: meteorUrl,
  greenhouse: greenhouseUrl, farm: farmUrl,
};
const loaded = new Map<ModelId, { scene: THREE.Object3D; clips: THREE.AnimationClip[] }>();

interface Mats {
  body: THREE.MeshLambertMaterial;
  glow: THREE.MeshLambertMaterial;
  lit: THREE.MeshBasicMaterial;
  glass: THREE.MeshLambertMaterial;
}
let mats: Mats | null = null;

function materials(): Mats {
  mats ??= {
    body: patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), { glow: true, name: 'models' }),
    glow: new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive: new THREE.Color('#1b2a6a') }),
    lit: new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(1.7, 1.7, 1.7), toneMapped: false }),
    glass: new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.28, depthWrite: false }),
  };
  return mats;
}

/** Troca os materiais do arquivo pelos do jogo e liga as sombras. */
export function prepareModel(root: THREE.Object3D): THREE.Object3D {
  const m = materials();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const old = mesh.material as THREE.Material | THREE.Material[];
    for (const x of Array.isArray(old) ? old : [old]) x.dispose();
    const n = mesh.name;
    const lights = /^(lit|fx)/i.test(n), glows = /^glow/i.test(n), glass = /^glass/i.test(n);
    mesh.material = lights ? m.lit : glows ? m.glow : glass ? m.glass : m.body;
    mesh.castShadow = !lights && !glows && !glass;
    mesh.receiveShadow = !lights;
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
        separateCoplanar(gltf.scene);
        loaded.set(id, { scene: prepareModel(gltf.scene), clips: gltf.animations });
      } catch (err) {
        console.warn(`modelo ${id} não carregou; usando o modelo em código`, err);
      }
    }),
  );
}

/** Uma cópia do modelo (a geometria e o material são compartilhados), ou null se ele não carregou. */
export function model(id: ModelId): THREE.Object3D | null {
  return loaded.get(id)?.scene.clone() ?? null;
}

/** Uma cópia de uma parte com nome (um nó do arquivo, como um tipo de móvel), na origem; null se não houver. */
export function modelPart(id: ModelId, name: string): THREE.Object3D | null {
  const part = loaded.get(id)?.scene.getObjectByName(name);
  if (!part) return null;
  const c = part.clone();
  c.position.set(0, 0, 0);
  return c;
}

/** A animação feita no Blender (o laço da máquina), ou null. */
export function modelClip(id: ModelId): THREE.AnimationClip | null {
  return loaded.get(id)?.clips[0] ?? null;
}

/** Posição de um ponto marcado no modelo (um vazio do Blender), relativa ao modelo. */
export function marker(root: THREE.Object3D, name: string): THREE.Vector3 | null {
  const o = root.getObjectByName(name);
  return o ? o.position.clone() : null;
}

/** Junta as peças de um modelo cujo nome passa no teste (para mover em grupo). */
export function partsNamed(root: THREE.Object3D, test: RegExp): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (o !== root && test.test(o.name)) out.push(o);
  });
  return out;
}

/** Só para testes: põe um modelo como se tivesse carregado. */
export function setModelForTest(id: ModelId, scene: THREE.Object3D | null, clips: THREE.AnimationClip[] = []): void {
  if (scene) loaded.set(id, { scene, clips });
  else loaded.delete(id);
}
