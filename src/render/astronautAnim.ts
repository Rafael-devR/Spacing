// Animação procedural do astronauta (docs/design/PERSONAGEM.md, ADR 0017). Sem Three.js: recebe o estado do jogador e devolve
// o ângulo de cada junta, o que deixa testar a animação sem navegador (tests/astronautAnim.test.ts).
//
// Cada animação é uma pose calculada na hora, e o que muda de uma para outra são pesos suavizados: parado → andando → correndo
// pela velocidade, chão → ar pelo pulo, subir → cair pela velocidade vertical, mais camadas por cima (minerar, segurar item,
// gestos, pouso, morte). Assim nunca há corte seco entre animações.
//
// Convenção dos ângulos (radianos, Euler XYZ local da junta, com o modelo de frente para +z):
//   membro pendurado (braço, perna): x > 0 joga para trás, x < 0 para frente
//   joelho: x > 0 dobra; cotovelo: x < 0 dobra; pé: x < 0 levanta a ponta
//   tronco e cabeça: x > 0 inclina para a frente; y gira; z tomba de lado
//   braço esquerdo para fora: z < 0; braço direito para fora: z > 0

export const JOINTS = [
  'hips', 'torso', 'head', 'pack',
  'armL', 'foreL', 'handL', 'armR', 'foreR', 'handR',
  'legL', 'shinL', 'footL', 'legR', 'shinR', 'footR',
] as const;
export type JointName = (typeof JOINTS)[number];

export interface JointAngles {
  x: number;
  y: number;
  z: number;
}

export interface Pose {
  j: Record<JointName, JointAngles>;
  /** deslocamento do quadril (blocos): balanço do passo, agachar ao pousar */
  hipY: number;
  /** achatamento (pouso) e esticada (pulo): escala y do corpo inteiro; xz compensa */
  stretch: number;
}

export interface AnimState {
  /** velocidade horizontal (blocos/s) */
  speed: number;
  /** velocidade máxima de corrida (blocos/s) */
  maxSpeed: number;
  onGround: boolean;
  /** velocidade vertical (blocos/s; positiva sobe) */
  vy: number;
  /** quanto o corpo está virando (rad/s; para inclinar nas curvas) */
  turn: number;
  mining: boolean;
  /** segura um item na luva direita */
  holding: boolean;
  dead: boolean;
}

export type Gesture = 'place' | 'eat' | 'hurt' | 'pickup';

/** quanto dura cada gesto (s) */
export const GESTURE_TIME: Record<Gesture, number> = { place: 0.38, eat: 1.1, hurt: 0.45, pickup: 0.45 };

/** números da animação (ajuste fino aqui) */
export const ANIM = {
  /** radianos de passo por bloco andado: uma passada inteira (dois passos) a cada ~2,6 blocos */
  strideWalk: 2.5,
  strideRun: 2.25,
  /** a partir de que velocidade o andar vira corrida */
  runFrom: 2.2,
  runFull: 4.0,
  /** segundos parado até o primeiro gesto à toa (olhar em volta, espreguiçar) */
  idleFidget: 6,
} as const;

const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
const smooth = (a: number, b: number, v: number): number => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
/** aproxima `cur` de `to` com rapidez `rate` (1/s), independente do quadro */
const approach = (cur: number, to: number, rate: number, dt: number): number => cur + (to - cur) * (1 - Math.exp(-rate * dt));

export function emptyPose(): Pose {
  const j = {} as Record<JointName, JointAngles>;
  for (const n of JOINTS) j[n] = { x: 0, y: 0, z: 0 };
  return { j, hipY: 0, stretch: 1 };
}

type Fidget = 'look' | 'stretch' | 'tap';

export class AstronautAnimator {
  readonly pose = emptyPose();
  /** fase do passo (rad) */
  private phase = 0;
  private time = 0;
  // pesos suavizados (0 a 1)
  private wMove = 0;
  private wRun = 0;
  private wAir = 0;
  private wFall = 0;
  private wMine = 0;
  private wHold = 0;
  private wDead = 0;
  private turnLean = 0;
  /** tempo no ar (os braços se agitam mais numa queda longa) */
  private airTime = 0;
  /** mola do pouso: agachar e voltar com um quique */
  private land = 0;
  private landV = 0;
  /** esticada do pulo (sai de 1 e volta) */
  private jumpStretch = 0;
  /** mola da mochila (atrasa o balanço do corpo) */
  private pack = 0;
  private packV = 0;
  private lastHipY = 0;
  private gesture: Gesture | null = null;
  private gestureT = 0;
  private idleT = 0;
  private fidget: Fidget | null = null;
  private fidgetT = 0;
  private fidgetN = 0;

  /** pulo: o corpo estica um instante */
  jump(): void {
    this.jumpStretch = 1;
  }

  /** pouso: `impact` de 0 a 1 (velocidade da queda) */
  landed(impact: number): void {
    this.landV += 3 + clamp(impact, 0, 1) * 12;
  }

  /** gesto curto por cima do que estiver fazendo (substitui um gesto em andamento) */
  play(g: Gesture): void {
    this.gesture = g;
    this.gestureT = 0;
  }

  get currentGesture(): Gesture | null {
    return this.gesture;
  }

  update(dt: number, s: AnimState): Pose {
    dt = Math.min(dt, 0.1);
    this.time += dt;
    const t = this.time;
    const sp = s.dead ? 0 : s.speed;

    // ---------- pesos ----------
    this.wMove = approach(this.wMove, smooth(0.15, 1.2, sp), 10, dt);
    this.wRun = approach(this.wRun, smooth(ANIM.runFrom, ANIM.runFull, sp), 6, dt);
    const air = !s.onGround && !s.dead;
    this.wAir = approach(this.wAir, air ? 1 : 0, air ? 9 : 16, dt);
    this.wFall = approach(this.wFall, smooth(1.5, -3.5, s.vy), 6, dt);
    this.airTime = air ? this.airTime + dt : 0;
    this.wMine = approach(this.wMine, s.mining && !s.dead ? 1 : 0, 12, dt);
    this.wHold = approach(this.wHold, s.holding && !s.dead ? 1 : 0, 8, dt);
    this.wDead = approach(this.wDead, s.dead ? 1 : 0, 5, dt);
    this.turnLean = approach(this.turnLean, clamp(s.turn, -6, 6) * clamp(sp / s.maxSpeed, 0, 1), 8, dt);

    // fase do passo: anda com a distância percorrida (o pé não escorrega), e devagar até parar no meio da passada
    if (s.onGround && sp > 0.05) {
      const k = ANIM.strideWalk + (ANIM.strideRun - ANIM.strideWalk) * this.wRun;
      this.phase += sp * dt * k;
    }

    // molas: pouso e mochila
    this.landV += (-140 * this.land - 13 * this.landV) * dt;
    this.land += this.landV * dt;
    this.jumpStretch = Math.max(0, this.jumpStretch - dt * 4);

    // à toa: depois de um tempo parado, um gesto de vez em quando
    const still = !air && !s.dead && !s.mining && sp < 0.2 && !this.gesture;
    this.idleT = still ? this.idleT + dt : 0;
    if (this.fidget) {
      this.fidgetT += dt;
      if (!still || this.fidgetT > 2.6) this.fidget = null;
    } else if (this.idleT > ANIM.idleFidget) {
      const order: Fidget[] = ['look', 'tap', 'stretch', 'look'];
      this.fidget = order[this.fidgetN++ % order.length];
      this.fidgetT = 0;
      this.idleT = ANIM.idleFidget - 4 - (this.fidgetN % 3);
    }

    if (this.gesture) {
      this.gestureT += dt;
      if (this.gestureT >= GESTURE_TIME[this.gesture]) this.gesture = null;
    }

    // ---------- pose ----------
    const P = this.pose;
    const j = P.j;
    for (const n of JOINTS) {
      const a = j[n];
      a.x = a.y = a.z = 0;
    }
    P.hipY = 0;

    this.idle(t, 1 - this.wMove);
    this.locomotion(this.wMove * (1 - this.wAir));
    this.airborne(t, this.wAir);
    this.landing();
    this.lean();
    this.holdItem(t, this.wHold * (1 - this.wMine));
    this.mine(t, this.wMine);
    if (this.gesture) this.gestureLayer(this.gesture, this.gestureT / GESTURE_TIME[this.gesture]);
    this.deadLayer(this.wDead);

    // mochila: atrasa o sobe-e-desce do quadril
    const hipVel = (P.hipY - this.lastHipY) / Math.max(dt, 1e-4);
    this.lastHipY = P.hipY;
    this.packV += (-90 * this.pack - 9 * this.packV - clamp(hipVel, -3, 3) * 4) * dt;
    this.pack += this.packV * dt;
    j.pack.x += clamp(this.pack, -0.35, 0.35) + this.wAir * (this.wFall - 0.5) * 0.25;

    // achatar ao pousar, esticar no pulo
    P.stretch = 1 - clamp(this.land, -0.12, 0.35) * 0.35 + this.jumpStretch * this.jumpStretch * 0.1 * (1 - this.wDead);
    return P;
  }

  /** respirar, balançar os braços de leve, e os gestos à toa */
  private idle(t: number, w: number): void {
    if (w <= 0.001) return;
    const j = this.pose.j;
    const br = Math.sin(t * 2.1);
    j.torso.x += -0.03 * br * w;
    j.head.x += 0.03 * Math.sin(t * 2.1 - 0.6) * w;
    j.head.z += 0.04 * Math.sin(t * 0.7) * w;
    j.armL.z += (-0.12 - 0.03 * br) * w;
    j.armR.z += (0.12 + 0.03 * br) * w;
    j.foreL.x += -0.18 * w;
    j.foreR.x += -0.18 * w;
    j.legL.z += -0.05 * w;
    j.legR.z += 0.05 * w;
    this.pose.hipY += -0.008 * (br + 1) * w;
    // peso trocando de perna devagar
    const sway = Math.sin(t * 0.45) * 0.035 * w;
    j.hips.z += sway;
    j.torso.z -= sway * 0.8;
    j.legL.z -= sway;
    j.legR.z -= sway;

    const f = this.fidget;
    if (!f) return;
    const u = this.fidgetT / 2.6;
    const env = smooth(0, 0.15, u) * (1 - smooth(0.82, 1, u)) * w;
    if (f === 'look') {
      // olha para um lado, depois para o outro
      const y = u < 0.5 ? 0.75 * smooth(0.05, 0.3, u) : 0.75 - 1.5 * smooth(0.45, 0.7, u);
      j.head.y += y * env;
      j.head.x += -0.12 * env;
      j.torso.y += y * 0.25 * env;
    } else if (f === 'stretch') {
      // espreguiça: braços para cima, corpo para trás
      j.armL.z += -2.4 * env;
      j.armR.z += 2.4 * env;
      j.foreL.x += 0.18 * env;
      j.foreR.x += 0.18 * env;
      j.torso.x += -0.18 * env;
      j.head.x += -0.3 * env;
      this.pose.hipY += 0.02 * env;
    } else {
      // bate o pé, impaciente, com as mãos na cintura
      const tap = Math.max(0, Math.sin(this.fidgetT * 11));
      j.legR.x += -0.25 * env;
      j.shinR.x += 0.15 * env;
      j.footR.x += -0.5 * tap * env;
      j.armL.z += -0.55 * env;
      j.armR.z += 0.55 * env;
      j.foreL.x += -1.2 * env;
      j.foreR.x += -1.2 * env;
      j.foreL.y += 0.9 * env;
      j.foreR.y += -0.9 * env;
      j.head.z += 0.1 * Math.sin(this.fidgetT * 5.5) * env;
    }
  }

  /** andar e correr (a corrida pesa mais com a velocidade): passada, joelhos, braços, balanço e torção */
  private locomotion(w: number): void {
    if (w <= 0.001) return;
    const j = this.pose.j;
    const r = this.wRun;
    const p = this.phase;
    const s = Math.sin(p), c = Math.cos(p);
    const thigh = 0.5 + 0.35 * r;
    // joelho dobra quando a perna volta para a frente (c > 0 na esquerda)
    const lift = (x: number): number => Math.pow(Math.max(0, x), 1.5);
    const kneeAmp = 0.7 + 0.8 * r;
    j.legL.x += -s * thigh * w;
    j.legR.x += s * thigh * w;
    j.shinL.x += (0.1 + lift(c) * kneeAmp) * w;
    j.shinR.x += (0.1 + lift(-c) * kneeAmp) * w;
    // pé acompanha: ponta para cima na frente, empurra o chão atrás
    j.footL.x += (s * 0.35 - lift(c) * 0.3) * w;
    j.footR.x += (-s * 0.35 - lift(-c) * 0.3) * w;
    // braços ao contrário das pernas; na corrida os cotovelos dobram e bombeiam
    const arm = 0.55 + 0.3 * r;
    j.armL.x += s * arm * w;
    j.armR.x += -s * arm * w;
    j.armL.z += -(0.12 + 0.1 * r) * w;
    j.armR.z += (0.12 + 0.1 * r) * w;
    j.foreL.x += (-0.25 - 0.95 * r + 0.2 * r * s) * w;
    j.foreR.x += (-0.25 - 0.95 * r - 0.2 * r * s) * w;
    // tronco: inclina para a frente na corrida, gira contra os quadris
    j.torso.x += (0.05 + 0.2 * r) * w;
    j.torso.y += -s * (0.1 + 0.08 * r) * w;
    j.hips.y += s * (0.12 + 0.05 * r) * w;
    j.hips.z += c * 0.04 * w;
    j.head.x += -(0.03 + 0.14 * r) * w;
    j.head.y += s * 0.06 * w;
    // sobe e desce duas vezes por passada; na Lua a corrida vira saltinhos
    const bob = 0.025 + 0.055 * r;
    this.pose.hipY += (Math.cos(2 * p) * 0.5 + 0.5) * bob * w - 0.015 * r * w;
  }

  /** no ar: subindo, encolhe uma perna e abre os braços; caindo, agita os braços e as pernas */
  private airborne(t: number, w: number): void {
    if (w <= 0.001) return;
    const j = this.pose.j;
    const f = this.wFall;
    const rise = (1 - f) * w;
    // subindo
    j.legL.x += -0.7 * rise;
    j.shinL.x += 1.1 * rise;
    j.footL.x += 0.2 * rise;
    j.legR.x += 0.25 * rise;
    j.shinR.x += 0.45 * rise;
    j.footR.x += 0.35 * rise;
    j.armL.x += 0.35 * rise;
    j.armR.x += -0.55 * rise;
    j.armL.z += -0.75 * rise;
    j.armR.z += 0.75 * rise;
    j.foreL.x += -0.45 * rise;
    j.foreR.x += -0.45 * rise;
    j.head.x += -0.12 * rise;
    j.torso.x += -0.06 * rise;
    // caindo: quanto mais tempo, mais desesperado (até ~1 s)
    const fall = f * w;
    const panic = 0.45 + 0.55 * smooth(0.25, 1.1, this.airTime);
    const fl = Math.sin(t * 13), fl2 = Math.sin(t * 11 + 1.3);
    j.armL.z += (-1.9 - 0.35 * fl * panic) * fall;
    j.armR.z += (1.9 + 0.35 * fl2 * panic) * fall;
    j.armL.x += 0.35 * fl2 * panic * fall;
    j.armR.x += -0.35 * fl * panic * fall;
    j.foreL.x += (-0.3 - 0.25 * fl * panic) * fall;
    j.foreR.x += (-0.3 - 0.25 * fl2 * panic) * fall;
    j.legL.x += (-0.25 + 0.4 * Math.sin(t * 9) * panic) * fall;
    j.legR.x += (-0.1 - 0.4 * Math.sin(t * 9) * panic) * fall;
    j.shinL.x += (0.4 + 0.25 * Math.max(0, Math.sin(t * 9))) * fall;
    j.shinR.x += (0.4 + 0.25 * Math.max(0, -Math.sin(t * 9))) * fall;
    j.legL.z += -0.15 * fall;
    j.legR.z += 0.15 * fall;
    j.footL.x += 0.3 * fall;
    j.footR.x += 0.3 * fall;
    j.head.x += 0.28 * fall; // olha para o chão que chega
    j.torso.x += 0.06 * fall;
  }

  /** pouso: agacha (joelhos, quadril, braços para a frente) e volta com um quique */
  private landing(): void {
    const c = clamp(this.land, -0.15, 1);
    if (Math.abs(c) < 0.002) return;
    const j = this.pose.j;
    const k = Math.max(0, c);
    j.legL.x += -0.55 * k;
    j.legR.x += -0.55 * k;
    j.shinL.x += 1.1 * k;
    j.shinR.x += 1.1 * k;
    j.footL.x += -0.55 * k;
    j.footR.x += -0.55 * k;
    j.legL.z += -0.1 * k;
    j.legR.z += 0.1 * k;
    j.torso.x += 0.35 * k;
    j.head.x += -0.2 * k;
    j.armL.x += -0.5 * k;
    j.armR.x += -0.5 * k;
    j.armL.z += -0.4 * k;
    j.armR.z += 0.4 * k;
    // a perna (coxa + canela, ~0,3 bloco) dobrada baixa o quadril
    this.pose.hipY += -0.3 * (1 - Math.cos(0.55 * k)) * 2.2 - Math.min(0, c) * 0.06;
  }

  /** inclina para dentro da curva */
  private lean(): void {
    const j = this.pose.j;
    const l = clamp(this.turnLean * 0.05, -0.22, 0.22);
    j.hips.z += -l;
    j.head.z += l * 0.5;
    j.head.y += clamp(this.turnLean * 0.04, -0.3, 0.3);
  }

  /** segurando um item: braço direito dobrado, o item na frente do peito */
  private holdItem(t: number, w: number): void {
    if (w <= 0.001) return;
    const j = this.pose.j;
    // tira o braço do balanço do passo e põe na pose de carregar
    j.armR.x = j.armR.x * (1 - w * 0.85) + (-0.35 + Math.sin(t * 2.1) * 0.02) * w;
    j.armR.z = j.armR.z * (1 - w) + 0.12 * w;
    j.foreR.x = j.foreR.x * (1 - w) - 1.15 * w;
    j.foreR.y += -0.25 * w;
    j.handR.x += 0.25 * w;
  }

  /** minerando: braço direito esticado com a broca tremendo, braço esquerdo de apoio, base firme */
  private mine(t: number, w: number): void {
    if (w <= 0.001) return;
    const j = this.pose.j;
    const buzz = Math.sin(t * 47) * 0.045, buzz2 = Math.sin(t * 39 + 1) * 0.035;
    const lerp = (a: JointAngles, x: number, y: number, z: number): void => {
      a.x += (x - a.x) * w;
      a.y += (y - a.y) * w;
      a.z += (z - a.z) * w;
    };
    lerp(j.armR, -1.3 + buzz, 0, 0.08);
    lerp(j.foreR, -0.25 + buzz2, 0, 0);
    lerp(j.handR, 0.1, 0, 0);
    lerp(j.armL, -0.9 + buzz2 * 0.5, 0.3, -0.25);
    lerp(j.foreL, -0.9, 0.5, 0);
    j.torso.x += (0.08 + buzz * 0.4) * w;
    j.torso.y += -0.15 * w;
    j.head.x += 0.06 * w;
    j.head.y += 0.12 * w;
    // pernas firmes e abertas quando parado
    const planted = w * (1 - this.wMove);
    j.legL.z += -0.12 * planted;
    j.legR.z += 0.12 * planted;
    j.legL.x += -0.12 * planted;
    j.legR.x += 0.15 * planted;
    j.shinL.x += 0.12 * planted;
    j.shinR.x += 0.15 * planted;
    this.pose.hipY += (-0.02 + buzz * 0.08) * planted;
  }

  private gestureLayer(g: Gesture, u: number): void {
    const j = this.pose.j;
    const env = smooth(0, 0.2, u) * (1 - smooth(0.65, 1, u));
    if (g === 'place') {
      // estica o braço e põe o bloco à frente
      const reach = Math.sin(Math.min(1, u * 1.4) * Math.PI);
      j.armR.x += (-1.1 * reach - j.armR.x * 0.6) * env;
      j.foreR.x += (-0.2 * reach) * env;
      j.torso.x += 0.18 * reach * env;
      j.torso.y += -0.15 * reach * env;
    } else if (g === 'pickup') {
      // abaixa e pega do chão
      const dip = Math.sin(u * Math.PI);
      j.torso.x += 0.45 * dip;
      j.head.x += 0.2 * dip;
      j.armR.x += -0.7 * dip;
      j.legL.x += -0.3 * dip;
      j.legR.x += -0.3 * dip;
      j.shinL.x += 0.6 * dip;
      j.shinR.x += 0.6 * dip;
      this.pose.hipY += -0.06 * dip;
    } else if (g === 'eat') {
      // leva a mão ao visor duas vezes (o tubo de comida do capacete)
      const bite = 0.65 + 0.35 * Math.abs(Math.sin(u * Math.PI * 3));
      j.armR.x += (-1.2 * bite - j.armR.x) * env;
      j.armR.z += (-0.25 - j.armR.z) * env;
      j.foreR.x += (-1.6 * bite - j.foreR.x) * env;
      j.head.x += -0.12 * env;
      j.head.z += 0.08 * Math.sin(u * Math.PI * 6) * env;
    } else {
      // dor: encolhe, cabeça para trás, braços para dentro
      const hit = Math.exp(-u * 5) * Math.sin(Math.min(1, u * 6) * Math.PI * 0.5) * 1.4;
      j.torso.x += -0.35 * hit;
      j.head.x += -0.4 * hit;
      j.armL.z += 0.25 * hit;
      j.armR.z += -0.25 * hit;
      j.foreL.x += -0.7 * hit;
      j.foreR.x += -0.7 * hit;
      j.shinL.x += 0.3 * hit;
      j.shinR.x += 0.3 * hit;
      this.pose.hipY += -0.03 * hit;
    }
  }

  /** morto: cai de costas, braços e pernas abertos */
  private deadLayer(w: number): void {
    if (w <= 0.001) return;
    const j = this.pose.j;
    const set = (a: JointAngles, x: number, y: number, z: number): void => {
      a.x += (x - a.x) * w;
      a.y += (y - a.y) * w;
      a.z += (z - a.z) * w;
    };
    set(j.hips, -1.3, 0, 0);
    set(j.torso, 0.15, 0, 0);
    set(j.head, -0.25, 0.4, 0.1);
    set(j.armL, -0.3, 0, -1.2);
    set(j.armR, -0.4, 0, 1.0);
    set(j.foreL, -0.4, 0, 0);
    set(j.foreR, -0.3, 0, 0);
    set(j.legL, -0.25, 0, -0.3);
    set(j.legR, -0.1, 0, 0.25);
    set(j.shinL, 0.35, 0, 0);
    set(j.shinR, 0.15, 0, 0);
    set(j.footL, 0, 0, 0);
    set(j.footR, 0, 0, 0);
    this.pose.hipY += (-0.08 - this.pose.hipY) * w;
  }
}
