// O astronauta do jogador (docs/design/PERSONAGEM.md, ADR 0017). O modelo vem do Blender (tools/models/astronaut.py) com um
// nó por articulação, todos soltos na raiz e cada um com o pivô no lugar da junta. Aqui eles viram um esqueleto de verdade
// (quadril → tronco → cabeça, braços...; quadril → pernas), sem mexer em onde as peças estão, e o render/astronautAnim.ts
// gira as juntas por código. Se o .glb não carregar, o modelo antigo feito em código (render/models.ts) assume, com as juntas
// que ele tiver.
import * as THREE from 'three';
import type { JointName, Pose } from './astronautAnim';
import { model } from './gltfModels';
import { showIndoors } from './indoors';
import { patchMaterial } from './materials';
import { createAstronaut as createCodeAstronaut } from './models';

export interface AstronautModel {
  root: THREE.Group;
  /** as juntas que o modelo tem (o modelo em código não tem todas) */
  joints: Partial<Record<JointName, THREE.Object3D>>;
  /** a broca de mão: vai para a luva ao minerar e para o cinto no resto do tempo */
  drill: THREE.Object3D | null;
  /** ponta da broca (cor e tamanho pela broca equipada) */
  bit: THREE.Mesh | null;
  /** onde a luva direita segura as coisas */
  grip: THREE.Object3D | null;
  /** onde a broca fica pendurada no cinto */
  holster: THREE.Object3D | null;
  /** luz que pisca (só o modelo em código tem) */
  beacon: THREE.Mesh | null;
  /** material do traje, só do astronauta (pisca vermelho ao levar dano) */
  suitMat: THREE.MeshLambertMaterial;
  /** altura do quadril em repouso (o balanço soma a ela) */
  hipRestY: number;
}

/** nome do nó no arquivo → junta */
const NODE: Record<JointName, string> = {
  hips: 'pelvis', torso: 'torso', head: 'head', pack: 'pack',
  armL: 'arm_l', foreL: 'fore_l', handL: 'hand_l', armR: 'arm_r', foreR: 'fore_r', handR: 'hand_r',
  legL: 'leg_l', shinL: 'shin_l', footL: 'foot_l', legR: 'leg_r', shinR: 'shin_r', footR: 'foot_r',
};
/** quem pendura em quem */
const PARENT: Partial<Record<JointName, JointName>> = {
  torso: 'hips', head: 'torso', pack: 'torso',
  armL: 'torso', foreL: 'armL', handL: 'foreL', armR: 'torso', foreR: 'armR', handR: 'foreR',
  legL: 'hips', shinL: 'legL', footL: 'shinL', legR: 'hips', shinR: 'legR', footR: 'shinR',
};
/** ordem para pendurar (pai antes do filho) */
const ORDER: JointName[] = [
  'torso', 'head', 'pack', 'armL', 'foreL', 'handL', 'armR', 'foreR', 'handR', 'legL', 'shinL', 'footL', 'legR', 'shinR', 'footR',
];

function suitMaterial(): THREE.MeshLambertMaterial {
  return patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), { glow: true, name: 'astronaut' });
}

/** Monta o astronauta do Blender, ou null se o arquivo não carregou. */
export function createBlenderAstronaut(): AstronautModel | null {
  const src = model('astronaut');
  if (!src) return null;
  const root = new THREE.Group();
  root.name = 'astronaut';
  root.add(src);
  src.updateMatrixWorld(true);
  const joints: Partial<Record<JointName, THREE.Object3D>> = {};
  for (const j of Object.keys(NODE) as JointName[]) {
    const o = src.getObjectByName(NODE[j]);
    if (o) joints[j] = o;
  }
  const hips = joints.hips;
  if (!hips) return null;
  // os pontos e a broca, antes de os nós mudarem de pai (o ponto da luva vem pendurado na mão)
  const drill = src.getObjectByName('drill') ?? null;
  const grip = src.getObjectByName('grip_r') ?? null;
  const holster = src.getObjectByName('holster') ?? null;
  // `attach` mantém a posição no mundo: o pivô de cada junta fica onde o Blender pôs
  root.attach(hips);
  for (const j of ORDER) {
    const o = joints[j], p = joints[PARENT[j] as JointName];
    if (o && p) p.attach(o);
  }
  const suitMat = suitMaterial();
  // visor quase preto, com um reflexo azul bem leve (o vidro brilhante das máquinas ficaria azul demais no rosto)
  const visorMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive: new THREE.Color('#070b1e') });
  let bit: THREE.Mesh | null = null;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if (m.name === 'fx_bit') {
      m.material = new THREE.MeshLambertMaterial({ color: '#ffb03a', flatShading: true });
      m.castShadow = true;
      bit = m;
    } else if (/^glow_visor/i.test(m.name)) m.material = visorMat;
    else if (!/^(glow|lit|fx)/i.test(m.name)) m.material = suitMat;
    // sombra própria no boneco pequeno só faz serrilhado
    m.receiveShadow = false;
  });
  if (grip && joints.handR) joints.handR.attach(grip);
  if (holster) hips.attach(holster);
  if (drill) drill.position.set(0, 0, 0);
  root.remove(src);
  const out: AstronautModel = { root, joints, drill, bit, grip, holster, beacon: null, suitMat, hipRestY: hips.position.y };
  holdDrill(out, false);
  return out;
}

/** O modelo antigo feito em código, com as juntas que ele tem. */
function codeAstronaut(): AstronautModel {
  const m = createCodeAstronaut();
  return {
    root: m.root,
    joints: { hips: m.body, head: m.head, armL: m.armL, armR: m.armR, legL: m.legL, legR: m.legR },
    drill: null, bit: m.bit, grip: null, holster: null, beacon: m.beacon, suitMat: m.suitMat, hipRestY: 0,
  };
}

export function createAstronaut(): AstronautModel {
  return createBlenderAstronaut() ?? codeAstronaut();
}

/**
 * Põe a pose nas juntas. `hipY` sobe e desce o quadril; `stretch` achata e estica o boneco a partir dos pés. No modelo em
 * código a broca e o resto já vivem no braço, então só os ângulos valem.
 */
export function applyPose(m: AstronautModel, p: Pose): void {
  for (const k in m.joints) {
    const j = k as JointName;
    const o = m.joints[j] as THREE.Object3D;
    const a = p.j[j];
    o.rotation.set(a.x, a.y, a.z);
  }
  const hips = m.joints.hips;
  if (hips) hips.position.y = m.hipRestY + p.hipY;
  const s = p.stretch, w = 1 + (1 - s) * 0.6;
  m.root.scale.set(w, s, w);
}

/** Broca na mão (minerando) ou no cinto. */
export function holdDrill(m: AstronautModel, inHand: boolean): void {
  const d = m.drill;
  if (!d) return;
  const to = inHand ? m.grip : m.holster;
  if (!to || d.parent === to) return;
  to.add(d);
  if (inHand) {
    // a broca aponta para onde o braço aponta (o braço esticado deixa o -y da luva para a frente)
    d.position.set(0, 0.03, 0.02);
    d.rotation.set(Math.PI / 2 - 0.25, 0, 0);
    d.scale.setScalar(1);
  } else {
    // pendurada no cinto, de ponta para baixo
    d.position.set(-0.02, 0, 0);
    d.rotation.set(Math.PI / 2 + 0.15, 0, 0.1);
    d.scale.setScalar(0.85);
  }
}

/** Item na luva direita (ou nada). A malha é do chamador; o tamanho é ajustado aqui. */
export function holdItem(m: AstronautModel, mesh: THREE.Object3D | null, size = 0.2): void {
  const g = m.grip;
  if (!g) return;
  for (const c of [...g.children]) if (c !== m.drill) g.remove(c);
  if (!mesh) return;
  mesh.position.set(0, -0.02, 0.06);
  mesh.rotation.set(0.3, 0.5, 0);
  mesh.scale.setScalar(size);
  mesh.traverse((o) => {
    o.castShadow = true;
    o.receiveShadow = false;
  });
  showIndoors(mesh);
  g.add(mesh);
}

/** Ponta da broca do astronauta: cor, brilho e tamanho da broca em uso (data/drills.ts). */
export function setDrillLook(model: AstronautModel, look: { bit: string; glow?: string; bitScale: number }): void {
  const bit = model.bit;
  if (!bit) return;
  const mat = bit.material as THREE.MeshLambertMaterial;
  mat.color.set(look.bit);
  mat.emissive.set(look.glow ?? '#000000');
  bit.scale.set(look.bitScale, look.bitScale, look.bitScale);
}
