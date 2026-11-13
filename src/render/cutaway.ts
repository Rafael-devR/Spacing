// Corte da caverna (docs/design/MUNDO.md): com o astronauta debaixo de um teto, a rocha que ficaria entre a câmera e ele
// não é desenhada. Some só o que está mais perto da câmera que o astronauta, dentro de um cilindro em volta do eixo da
// câmera, e que ou cobriria o astronauta (acima da linha dos pés, na tela) ou está acima da cabeça dele (o teto e o
// morro por cima). O chão, a parte de baixo das paredes e tudo o que fica atrás dele continuam.
// A mesma conta vale no shader (materials.ts, USE_CUT) e na mira (`skip`), para o toque não acertar rocha invisível.
import * as THREE from 'three';

/**
 * Liga o recorte. Desligado (2026-11-13): o dono pediu só a câmera de caverna, sem recorte, porque o recorte escondia blocos
 * que bloqueiam o caminho (o bloco some, mas a colisão continua). Com `false`, nada é cortado, a mira não pula e o material
 * de corte não entra nos chunks. Para voltar, troque para `true`.
 */
export const CUT_SWITCH = { enabled: false };
/** margem (blocos) na frente do astronauta que nunca é cortada */
export const CUT_MARGIN = 0.6;
/** tudo o que está acima disto (blocos acima dos pés) e na frente do astronauta é cortado: o teto e o que há sobre ele */
export const CUT_HEAD = 3.2;
/** raio do corte com a câmera de caverna toda aberta */
export const CUT_RADIUS = 13;

export const CUT = {
  /** ponto dos pés do astronauta */
  uCutF: { value: new THREE.Vector3() },
  /** para onde a câmera olha (unitário) */
  uCutV: { value: new THREE.Vector3(0, -1, 0) },
  /** o "para cima" da tela, no mundo (unitário) */
  uCutU: { value: new THREE.Vector3(0, 0, -1) },
  /** raio do cilindro; 0 = sem corte */
  uCutR: { value: 0 },
};

const _r = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _o = new THREE.Vector3();

/** Atualiza o corte: `feet` é a posição do astronauta, `k` (0..1) abre o corte aos poucos. */
export function setCut(camera: THREE.Camera, feet: THREE.Vector3, k: number): void {
  CUT.uCutR.value = CUT_SWITCH.enabled && k > 0.01 ? CUT_RADIUS * k : 0;
  CUT.uCutF.value.set(feet.x, feet.y + 0.15, feet.z);
  camera.getWorldDirection(CUT.uCutV.value);
  CUT.uCutU.value.set(0, 1, 0).applyQuaternion(camera.quaternion);
}

/** o ponto está na parte cortada? (a mesma regra do shader) */
export function isCut(p: THREE.Vector3): boolean {
  const R = CUT.uCutR.value;
  if (R <= 0) return false;
  _r.copy(p).sub(CUT.uCutF.value);
  const v = _r.dot(CUT.uCutV.value);
  if (v >= -CUT_MARGIN || (_r.dot(CUT.uCutU.value) <= 0 && _r.y <= CUT_HEAD)) return false;
  return _r.addScaledVector(CUT.uCutV.value, -v).lengthSq() < R * R;
}

/**
 * Quanto um raio que sai de `origin` deve avançar para sair da parte cortada (0 se não começa dentro dela). A parte
 * cortada é a união de duas formas convexas (acima da linha dos pés; acima da cabeça), então o raio sai em poucos passos.
 */
export function skip(origin: THREE.Vector3, dir: THREE.Vector3): number {
  const V = CUT.uCutV.value, U = CUT.uCutU.value, R = CUT.uCutR.value;
  if (!CUT_SWITCH.enabled || R <= 0) return 0;
  const dv = dir.dot(V), du = dir.dot(U);
  _q.copy(dir).addScaledVector(V, -dv);
  const a = _q.lengthSq();
  let t = 0;
  for (let i = 0; i < 6; i++) {
    _o.copy(origin).addScaledVector(dir, t);
    if (!isCut(_o)) return t;
    _r.copy(_o).sub(CUT.uCutF.value);
    // saída comum às duas formas: o plano na frente do astronauta e a parede do cilindro
    let out = dv > 1e-6 ? (-CUT_MARGIN - _r.dot(V)) / dv : Infinity;
    if (a > 1e-9) {
      _p.copy(_r).addScaledVector(V, -_r.dot(V));
      const b = _p.dot(_q), c = _p.lengthSq() - R * R;
      out = Math.min(out, (-b + Math.sqrt(Math.max(0, b * b - a * c))) / a);
    }
    // saída de cada forma (só conta a forma em que o ponto está)
    const feet = _r.dot(U) > 0 ? (du < -1e-6 ? -_r.dot(U) / du : Infinity) : 0;
    const head = _r.y > CUT_HEAD ? (dir.y < -1e-6 ? (CUT_HEAD - _r.y) / dir.y : Infinity) : 0;
    const step = Math.min(out, Math.max(feet, head));
    if (!Number.isFinite(step)) return t;
    t += step + 1e-3;
  }
  return t;
}
