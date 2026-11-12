// Efeitos visuais dos meteoros (docs/design/METEOROS.md): a rocha em voo com o brilho e o rastro, o aviso no chão e as
// camadas do impacto (clarão, bola de fogo, bolha da onda de choque, anel de poeira, coluna de fumaça, brasa da cratera).
// A lógica (quando cai, onde, cratera, dano) fica em entities/Meteors.ts; a distorção da imagem, em render/shockwave.ts;
// a câmera, o tempo e o som, em app/MeteorDirector.ts. Aqui só se desenha, com os números de data/meteors.ts.
import * as THREE from 'three';
import { FLIGHT_FX, IMPACT_FX, RADIUS_REF, WARN_FX } from '../data/meteors';
import type { Debris } from '../entities/Debris';
import { modelPart } from './gltfModels';
import type { Particles } from './particles';
import type { Puffs } from './puffs';

/** o que existe na cena enquanto um meteoro está vivo (do aviso ao impacto) */
export interface MeteorVisual {
  /** cabeça: a rocha, o brilho e a linha de brilho do rastro; anda do céu até o alvo */
  group: THREE.Group;
  rock: THREE.Object3D;
  core: THREE.Mesh;
  /** aviso no chão (mira que gira e encolhe) */
  ring: THREE.Mesh;
  ringMat: THREE.MeshBasicMaterial;
  /** de onde ele vem (do alvo para trás): o rastro fica nesse sentido */
  tail: THREE.Vector3;
  /** posição no quadro anterior e quanto ainda falta andar para a próxima baforada */
  last: THREE.Vector3;
  fireAcc: number;
  smokeAcc: number;
  /** giro da rocha */
  spin: THREE.Vector3;
  k: number;
}

const rnd = (a: number, b: number): number => a + Math.random() * (b - a);
const up = new THREE.Vector3(0, -1, 0);

/** disco macio: brilho em volta da cabeça */
function radialTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** de branco (cabeça) a preto (ponta): vira a transparência da linha de brilho do rastro */
function fadeTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 64;
  const x = c.getContext('2d')!;
  const g = x.createLinearGradient(0, 0, 0, 64);
  g.addColorStop(0, '#fff');
  g.addColorStop(1, '#000');
  x.fillStyle = g;
  x.fillRect(0, 0, 4, 64);
  return new THREE.CanvasTexture(c);
}

/** a mira do aviso: dois anéis, quatro traços para dentro e pontos entre eles */
function warningTexture(): THREE.Texture {
  const S = 256, h = S / 2;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d')!;
  x.strokeStyle = '#fff';
  x.fillStyle = '#fff';
  x.lineWidth = 7;
  x.beginPath();
  x.arc(h, h, h - 8, 0, Math.PI * 2);
  x.stroke();
  x.lineWidth = 3;
  x.beginPath();
  x.arc(h, h, h * 0.62, 0, Math.PI * 2);
  x.stroke();
  x.lineWidth = 8;
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    x.beginPath();
    x.moveTo(h + Math.cos(a) * (h - 8), h + Math.sin(a) * (h - 8));
    x.lineTo(h + Math.cos(a) * h * 0.38, h + Math.sin(a) * h * 0.38);
    x.stroke();
  }
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4 + Math.PI / 8;
    x.beginPath();
    x.arc(h + Math.cos(a) * h * 0.8, h + Math.sin(a) * h * 0.8, 5, 0, Math.PI * 2);
    x.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** a bolha da onda de choque: só a borda brilha (a silhueta da esfera) */
const SHELL_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const SHELL_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
varying vec3 vN;
varying vec3 vV;
void main() {
  float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 3.2);
  gl_FragColor = vec4(uColor, f * uAlpha);
}`;

interface Shell {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  age: number;
  life: number;
  radius: number;
}

interface Later {
  t: number;
  fn: () => void;
}

export class MeteorFx {
  private readonly glowMat: THREE.SpriteMaterial;
  private readonly coreGeo = new THREE.CylinderGeometry(1, 0.02, 1, 8, 1, true);
  private readonly coreMat: THREE.MeshBasicMaterial;
  private readonly ringGeo = new THREE.PlaneGeometry(1, 1);
  private readonly ringTex = warningTexture();
  private readonly fallbackGeo = new THREE.IcosahedronGeometry(0.55, 0);
  private readonly fallbackMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 1.1, 0.4), fog: false });
  private readonly shellGeo = new THREE.SphereGeometry(1, 28, 18);
  private readonly shells: Shell[] = [];
  private readonly later: Later[] = [];
  private readonly light = new THREE.PointLight('#ff9a4a', 0, 22, 1.6);
  /** clarão do impacto (1 no começo, cai até 0) e a luz do meteoro em voo neste quadro */
  private flash = 0;
  private flightLight = 0;
  private readonly flightPos = new THREE.Vector3();
  private readonly v = new THREE.Vector3();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly puffs: Puffs,
    private readonly particles: Particles,
  ) {
    this.coreGeo.translate(0, -0.5, 0); // largo na origem (a cabeça), fino na ponta, que aponta para -y
    this.coreMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(2.4, 1.3, 0.5), alphaMap: fadeTexture(), transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide,
    });
    this.glowMat = new THREE.SpriteMaterial({
      map: radialTexture(), color: new THREE.Color(...FLIGHT_FX.glowColor), transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    });
    scene.add(this.light);
  }

  /** Liga a fumaça e a quebra dos destroços (as de explosão pedem fumaça no voo e quebram ao bater). */
  attach(debris: Debris): void {
    debris.onTrail = (x, y, z, vx, vy, vz, size, heat) => {
      const hot = heat > 0.25;
      // quente: baforada laranja que escurece (mistura normal: aparece sobre o chão claro); frio: fumaça cinza
      this.puffs.spawn('smoke', {
        x, y, z, vx: vx * 0.05 + rnd(-0.3, 0.3), vy: vy * 0.05 + rnd(0, 0.5), vz: vz * 0.05 + rnd(-0.3, 0.3),
        size: size * (hot ? 2.4 : 2.8), growTo: hot ? 0.5 : 2.2, life: hot ? rnd(0.35, 0.6) : rnd(0.9, 1.5),
        from: hot ? [2.8, 1.0, 0.25] : [0.34, 0.31, 0.34], to: hot ? [0.25, 0.12, 0.09] : [0.2, 0.19, 0.22],
        alpha: hot ? 0.85 : 0.4, drag: 0.8,
      });
    };
    debris.onBreak = (x, y, z, size) => {
      for (let i = 0; i < 4; i++) {
        const a = Math.random() * Math.PI * 2;
        this.puffs.spawn('smoke', {
          x, y: y + 0.1, z, vx: Math.cos(a) * rnd(1, 2.5), vy: rnd(0.3, 1), vz: Math.sin(a) * rnd(1, 2.5),
          size: size * rnd(1.6, 2.6), growTo: 2.4, life: rnd(0.7, 1.3), from: [0.5, 0.46, 0.48], to: [0.4, 0.37, 0.4], alpha: 0.5, drag: 2.5,
        });
      }
      this.particles.burst(x, y + 0.1, z, [1.6, 0.8, 0.3], 6, 3);
    };
  }

  /** Cria o que fica na cena enquanto o meteoro existe: rocha, brilho, linha de brilho e o aviso no chão. */
  create(target: THREE.Vector3, start: THREE.Vector3, radius: number): MeteorVisual {
    const k = radius / RADIUS_REF;
    const group = new THREE.Group();
    const pick = ['rock_a', 'rock_b', 'rock_c'][Math.floor(Math.random() * 3)];
    const rock = modelPart('meteor', pick) ?? new THREE.Mesh(this.fallbackGeo, this.fallbackMat);
    rock.scale.setScalar(FLIGHT_FX.rockBase + FLIGHT_FX.rockPerRadius * radius);
    group.add(rock);
    const glow = new THREE.Sprite(this.glowMat);
    glow.scale.setScalar(FLIGHT_FX.glowSize * (0.7 + 0.3 * k));
    glow.name = 'glow';
    group.add(glow);
    const core = new THREE.Mesh(this.coreGeo, this.coreMat);
    const tail = start.clone().sub(target).normalize(); // do alvo para o céu
    core.quaternion.setFromUnitVectors(up, tail);
    core.scale.set(FLIGHT_FX.coreRadius * (0.8 + 0.4 * k), FLIGHT_FX.coreLength[0], FLIGHT_FX.coreRadius * (0.8 + 0.4 * k));
    group.add(core);
    group.visible = false;

    const ringMat = new THREE.MeshBasicMaterial({
      map: this.ringTex, color: new THREE.Color(...WARN_FX.color), transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    });
    const ring = new THREE.Mesh(this.ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(target.x, target.y + 0.06, target.z);
    this.scene.add(group, ring);
    return {
      group, rock, core, ring, ringMat, tail, last: start.clone(), fireAcc: 0, smokeAcc: 0, k,
      spin: new THREE.Vector3(rnd(0.6, 1.2), rnd(0.6, 1.2), rnd(0.2, 0.6)).multiplyScalar(FLIGHT_FX.spin),
    };
  }

  /** O aviso no chão: some e aparece pulsando, gira e encolhe até a hora do impacto. */
  warn(v: MeteorVisual, radius: number, warnK: number, flightK: number, t: number): void {
    v.ringMat.opacity = warnK * (0.5 + 0.4 * Math.sin(t * 14));
    const size = (WARN_FX.from + (WARN_FX.to - WARN_FX.from) * flightK) * radius * 2;
    v.ring.scale.setScalar(size);
    v.ring.rotation.z = t * WARN_FX.spin;
  }

  /** Um quadro de voo: posição, giro, brilho, linha de brilho e as baforadas do rastro. `k` = fração do voo (0 a 1). */
  fly(v: MeteorVisual, pos: THREE.Vector3, dt: number, k: number): void {
    v.group.visible = true;
    v.group.position.copy(pos);
    v.rock.rotation.x += v.spin.x * dt;
    v.rock.rotation.y += v.spin.y * dt;
    v.rock.rotation.z += v.spin.z * dt;
    const glow = v.group.getObjectByName('glow');
    if (glow) glow.scale.setScalar(FLIGHT_FX.glowSize * (0.7 + 0.3 * v.k) * (0.9 + 0.1 * Math.sin(k * 90)) * (0.6 + 0.6 * k));
    v.core.scale.y = FLIGHT_FX.coreLength[0] + (FLIGHT_FX.coreLength[1] - FLIGHT_FX.coreLength[0]) * k;

    // baforadas do rastro: uma a cada tanto de caminho andado, espalhadas entre o quadro anterior e este
    const dist = pos.distanceTo(v.last);
    const f = FLIGHT_FX.flame, h = FLIGHT_FX.fire, s = FLIGHT_FX.smoke;
    v.fireAcc += dist;
    v.smokeAcc += dist;
    const p = this.v;
    while (v.fireAcc >= f.spacing * v.k) {
      v.fireAcc -= f.spacing * v.k;
      const u = dist > 0 ? Math.min(1, v.fireAcc / dist) : 0; // 0 = aqui, 1 = quadro anterior
      p.lerpVectors(pos, v.last, u);
      const x = p.x + rnd(-0.12, 0.12), y = p.y + rnd(-0.12, 0.12), z = p.z + rnd(-0.12, 0.12);
      const vx = rnd(-0.6, 0.6), vy = rnd(-0.3, 0.9), vz = rnd(-0.6, 0.6);
      this.puffs.spawn('smoke', { x, y, z, vx, vy, vz, size: f.size * v.k * rnd(0.8, 1.15), growTo: f.growTo, life: f.life * rnd(0.8, 1.2), from: f.from, to: f.to, alpha: f.alpha });
      this.puffs.spawn('fire', { x, y, z, vx, vy, vz, size: h.size * v.k * rnd(0.8, 1.15), growTo: h.growTo, life: h.life * rnd(0.8, 1.2), from: h.from, to: h.to, alpha: h.alpha });
    }
    while (v.smokeAcc >= s.spacing * v.k) {
      v.smokeAcc -= s.spacing * v.k;
      const u = dist > 0 ? Math.min(1, v.smokeAcc / dist) : 0;
      p.lerpVectors(pos, v.last, u);
      this.puffs.spawn('smoke', {
        x: p.x, y: p.y, z: p.z, vx: rnd(-0.5, 0.5), vy: rnd(-0.2, 0.5), vz: rnd(-0.5, 0.5),
        size: s.size * v.k * rnd(0.8, 1.2), growTo: s.growTo, life: s.life * rnd(0.8, 1.2), from: s.from, to: s.to, alpha: s.alpha, drag: 0.5,
      });
    }
    v.last.copy(pos);
    // luz: o meteoro mais perto do chão manda
    const li = FLIGHT_FX.light * k;
    if (li > this.flightLight) {
      this.flightLight = li;
      this.flightPos.copy(pos);
    }
  }

  /** Tira do mundo o que o meteoro tinha (no impacto). */
  remove(v: MeteorVisual): void {
    this.scene.remove(v.group, v.ring);
    v.ringMat.dispose();
  }

  /** O impacto: tudo o que se vê do clarão até a brasa que fica. `target` = o ponto de queda; `radius` = o da cratera. */
  impact(target: THREE.Vector3, radius: number): void {
    const k = radius / RADIUS_REF;
    const f = IMPACT_FX;
    const T = target;
    const puffs = this.puffs;
    // 1. clarão branco-quente, bem curto
    puffs.spawn('fire', { x: T.x, y: T.y + 0.8, z: T.z, vx: 0, vy: 0.4, vz: 0, size: f.flash.size * k, growTo: 0.7, life: f.flash.life, from: f.flash.color, alpha: 1 });
    // 2. bola de fogo: baforadas que sobem e crescem, do amarelo ao vermelho-escuro
    for (let i = 0; i < f.fireball.count; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * radius * 0.45;
      const body = {
        x: T.x + Math.cos(a) * r, y: T.y + 0.5 + Math.random() * 1.2, z: T.z + Math.sin(a) * r,
        vx: Math.cos(a) * rnd(1, 4), vy: rnd(...f.fireball.up), vz: Math.sin(a) * rnd(1, 4),
        size: rnd(...f.fireball.size) * k, growTo: f.fireball.growTo, life: rnd(...f.fireball.life), from: f.fireball.from, to: f.fireball.to, alpha: 0.95, drag: 2.2, gravity: -0.5,
      };
      puffs.spawn('smoke', body);
      if (i % 2 === 0) {
        const c = f.fireball.core;
        puffs.spawn('fire', { ...body, size: body.size * c.size, life: body.life * c.life, from: c.from, to: c.to, alpha: 0.85 });
      }
    }
    // 3. anel de poeira rente ao chão, saindo do centro com a onda de choque
    const d = f.dustRing;
    for (let i = 0; i < d.count; i++) {
      const a = ((i + Math.random() * 0.8) / d.count) * Math.PI * 2, sp = rnd(...d.speed);
      puffs.spawn('smoke', {
        x: T.x + Math.cos(a) * radius * 0.5, y: T.y + 0.3, z: T.z + Math.sin(a) * radius * 0.5,
        vx: Math.cos(a) * sp, vy: rnd(0.2, 1.2), vz: Math.sin(a) * sp,
        size: rnd(...d.size) * k, growTo: d.growTo, life: rnd(...d.life), from: d.color, alpha: d.alpha, drag: 1.8, gravity: -0.15,
      });
    }
    // 4. bolha da onda de choque (só a borda brilha)
    this.shell(T, f.shell.radius * k);
    // 5. brasa do fundo da cratera e coluna de fumaça (em sequência)
    const e = f.embers;
    for (let i = 0; i < e.count; i++) {
      puffs.spawn('fire', {
        x: T.x + rnd(-0.6, 0.6), y: T.y - radius * 0.35 + 0.4, z: T.z + rnd(-0.6, 0.6), vx: 0, vy: rnd(0.05, 0.2), vz: 0,
        size: e.size * k * rnd(0.8, 1.2), growTo: 1.15, life: e.life * rnd(0.8, 1.1), from: e.from, to: e.to, alpha: e.alpha,
      });
    }
    const c = f.column;
    for (let i = 0; i < c.count; i++) {
      this.queue((i / c.count) * c.over, () => {
        const a = Math.random() * Math.PI * 2, r = Math.random() * radius * 0.4;
        puffs.spawn('smoke', {
          x: T.x + Math.cos(a) * r, y: T.y + 0.4, z: T.z + Math.sin(a) * r,
          vx: rnd(-0.5, 0.5), vy: rnd(...c.rise), vz: rnd(-0.5, 0.5),
          size: rnd(...c.size) * k, growTo: c.growTo, life: rnd(...c.life), from: c.from, to: c.to, alpha: c.alpha, drag: 0.35,
        });
      });
    }
    // 6. lascas de bloco e brasas (partículas de cubos)
    this.particles.burst(T.x, T.y + 0.3, T.z, [2.6, 1.0, 0.3], f.sparks.count, f.sparks.power);
    // 7. a luz do clarão
    this.flash = 1;
    this.light.position.set(T.x, T.y + 1.5, T.z);
  }

  private shell(T: THREE.Vector3, radius: number): void {
    let s = this.shells.find((x) => x.age >= x.life);
    if (!s) {
      const mat = new THREE.ShaderMaterial({
        vertexShader: SHELL_VERT, fragmentShader: SHELL_FRAG, transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, fog: false, uniforms: { uColor: { value: new THREE.Color() }, uAlpha: { value: 0 } },
      });
      const mesh = new THREE.Mesh(this.shellGeo, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 4;
      this.scene.add(mesh);
      s = { mesh, mat, age: 1, life: 1, radius: 1 };
      this.shells.push(s);
    }
    s.age = 0;
    s.life = IMPACT_FX.shell.life;
    s.radius = radius;
    s.mesh.position.set(T.x, T.y + 0.5, T.z);
    s.mesh.visible = true;
    s.mat.uniforms.uColor.value.setRGB(...IMPACT_FX.shell.color);
  }

  private queue(delay: number, fn: () => void): void {
    if (delay <= 0) fn();
    else this.later.push({ t: delay, fn });
  }

  /** Todo quadro: bolhas, o que está na fila, luz. */
  update(dt: number): void {
    for (const s of this.shells) {
      if (s.age >= s.life) {
        s.mesh.visible = false;
        continue;
      }
      s.age += dt;
      const u = Math.min(1, s.age / s.life);
      s.mesh.scale.setScalar(Math.max(0.01, s.radius * (1 - Math.pow(1 - u, 2.2))));
      s.mat.uniforms.uAlpha.value = 0.55 * Math.pow(1 - u, 1.5);
    }
    for (let i = this.later.length - 1; i >= 0; i--) {
      const l = this.later[i];
      l.t -= dt;
      if (l.t <= 0) {
        this.later.splice(i, 1);
        l.fn();
      }
    }
    this.flash = Math.max(0, this.flash - dt * IMPACT_FX.lightDecay);
    const hot = this.flash * IMPACT_FX.lightPeak;
    if (hot > this.flightLight) {
      this.light.intensity = hot;
      this.light.color.setRGB(1, 0.7 + 0.3 * this.flash * this.flash, 0.4 + 0.5 * this.flash * this.flash);
    } else {
      this.light.intensity = this.flightLight;
      this.light.color.setRGB(1, 0.6, 0.29);
      if (this.flightLight > 0) this.light.position.copy(this.flightPos);
    }
    this.flightLight = 0;
  }

  /** limpa o que estava esperando (nova partida) */
  clear(): void {
    this.later.length = 0;
    this.flash = 0;
    for (const s of this.shells) {
      s.age = s.life;
      s.mesh.visible = false;
    }
  }
}
