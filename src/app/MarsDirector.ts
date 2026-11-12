// Marte vivo (docs/design/MARTE.md): tempestades de poeira, redemoinhos, lava que queima o traje, brasas e erupções do
// vulcão. Só existe quando o planeta é Marte. A regra do clima fica em systems/Weather.ts; aqui é a experiência.
import * as THREE from 'three';
import type { Sfx } from '../audio/Sfx';
import { HOT_BLOCKS, LAVA } from '../data/blocks';
import type { Player } from '../entities/Player';
import { t } from '../i18n';
import type { IsoRig } from '../render/IsoRig';
import type { Lights } from '../render/lights';
import { DustDevils, DustStorm } from '../render/marsFx';
import { SKY, U } from '../render/materials';
import type { Particles } from '../render/particles';
import type { Survival } from '../systems/Survival';
import { Weather } from '../systems/Weather';
import type { Hud } from '../ui/Hud';
import { VOLCANO } from '../world/marsTerrain';
import type { World } from '../world/World';
import type { GameState } from './events';

export const MARS = {
  /** integridade perdida por segundo encostado na lava */
  lavaDps: 22,
  /** bateria que um redemoinho devolve (limpa os painéis) */
  devilBattery: 12,
  /** empurrão máximo do vento na tempestade (blocos/s) */
  stormPush: 0.9,
  /** distância do vulcão em que as erupções são sentidas */
  eruptionRange: 110,
  /** segundos entre erupções */
  eruptionEvery: [40, 75] as const,
  /**
   * Névoa na tempestade, em múltiplos da distância da câmera. O começo nunca chega no astronauta (que está a 1×):
   * só o que fica atrás dele some.
   */
  stormFog: { near: 1.05, far: 1.3 },
};

const STORM_TOP = new THREE.Color('#5e3a2a');
const STORM_BOTTOM = new THREE.Color('#9a6040');
const STORM_MIST = new THREE.Color('#a8714e');
const EMBER: [number, number, number] = [3.2, 1.1, 0.25];
const SMOKE: [number, number, number] = [0.09, 0.06, 0.05];

export interface MarsDeps {
  scene: THREE.Scene;
  world: World;
  player: Player;
  rig: IsoRig;
  particles: Particles;
  survival: Survival;
  hud: Hud;
  sfx: Sfx;
  lights: Lights;
  /** névoa da cena: em Marte, o que não usa o shader do terreno some na cor da poeira (e não no preto) */
  fog: THREE.Fog;
  getState(): GameState;
  /** dentro da base não há clima */
  indoors(): boolean;
}

export class MarsDirector {
  readonly weather = new Weather(20261112);
  private readonly storm: DustStorm;
  private readonly devils: DustDevils;
  private readonly baseTop = SKY.top.clone();
  private readonly baseBottom = SKY.bottom.clone();
  private readonly baseMist = (U.uMistColor.value as THREE.Color).clone();
  private readonly hemi0: number;
  private readonly sun0: number;
  /** colunas de lava perto do astronauta (refeito a cada segundo) */
  private lavaCells: [number, number, number][] = [];
  private scanIn = 0;
  private emberAcc = 0;
  private burnToast = 0;
  private sizzleIn = 0;
  private eruptionIn = 25;
  private fountain = 0;
  private welcomed = false;

  constructor(private readonly d: MarsDeps) {
    this.storm = new DustStorm(d.scene);
    this.devils = new DustDevils(d.scene, (x, z) => d.world.topY(Math.floor(x), Math.floor(z)) + 1);
    this.hemi0 = d.lights.hemi.intensity;
    this.sun0 = d.lights.sun.intensity;
  }

  /** poeira no ar agora (0..1): o Game encurta a névoa e as pegadas somem mais rápido */
  get dust(): number {
    return this.weather.level;
  }

  /** começo e fim da névoa em múltiplos da distância da câmera (o Game passa os de tempo bom) */
  fog(near: number, far: number): [number, number] {
    const L = this.d.indoors() ? 0 : this.weather.level;
    return [near + (MARS.stormFog.near - near) * L, far + (MARS.stormFog.far - far) * L];
  }

  update(dt: number, focus: THREE.Vector3): void {
    const { d } = this;
    const playing = d.getState() === 'playing';
    if (playing && !this.welcomed) {
      this.welcomed = true;
      d.hud.ai(t('mars.welcome'));
    }
    const inside = d.indoors();
    const w = this.weather;
    const changed = w.update(dt);
    if (changed && playing && !inside) {
      if (changed === 'coming') {
        d.hud.ai(t('mars.stormComing'), true);
        d.sfx.play('gust');
      } else if (changed === 'storm') d.hud.ai(t('mars.storm'), true);
      else if (changed === 'calm') d.hud.ai(t('mars.stormEnd'));
    }
    const L = inside ? 0 : w.level;

    // céu, névoa e luz escurecem com a poeira
    SKY.top.copy(this.baseTop).lerp(STORM_TOP, L);
    SKY.bottom.copy(this.baseBottom).lerp(STORM_BOTTOM, L);
    (U.uMistColor.value as THREE.Color).copy(this.baseMist).lerp(STORM_MIST, L);
    d.fog.color.copy(SKY.bottom).lerp(SKY.top, 0.35);
    d.lights.hemi.intensity = this.hemi0 * (1 - 0.25 * L);
    d.lights.sun.intensity = this.sun0 * (1 - 0.55 * L);
    this.storm.update(dt, L, w.windX, w.windZ, focus);
    d.sfx.setWind(L);

    // o vento empurra (pouco: o ar de Marte é ralo)
    const p = d.player;
    const k = playing && !inside ? (L * MARS.stormPush) / Math.max(1, w.windSpeed) : 0;
    p.push.set(w.windX * k, 0, w.windZ * k);

    // redemoinhos
    const hit = this.devils.update(dt, p.pos, w.windX, w.windZ, 1 - w.level);
    if (hit && playing && !inside) {
      const before = d.survival.battery;
      d.survival.battery = Math.min(100, before + MARS.devilBattery);
      d.hud.ai(t('mars.devil', { n: Math.round(d.survival.battery - before) }));
      d.rig.shake(0.35);
      d.sfx.play('gust');
      p.vel.x += hit.vx * 1.2;
      p.vel.z += hit.vz * 1.2;
      p.vel.y += 2.5;
    }

    this.lava(dt, playing);
    this.volcano(dt, playing);
  }

  /** queimadura, brasas e fumaça perto do astronauta */
  private lava(dt: number, playing: boolean): void {
    const { d } = this;
    const p = d.player.pos;
    // encostar: o bloco sob os pés ou ao lado, na altura dos pés
    const fx = Math.floor(p.x), fz = Math.floor(p.z), fy = Math.round(p.y);
    let hot = false;
    for (let dx = -1; dx <= 1 && !hot; dx++)
      for (let dz = -1; dz <= 1 && !hot; dz++) {
        const nx = p.x + dx * 0.45, nz = p.z + dz * 0.45;
        const bx = Math.floor(nx), bz = Math.floor(nz);
        if ((dx || dz) && bx === fx && bz === fz) continue;
        if (HOT_BLOCKS.has(d.world.peekBlock(bx, fy - 1, bz)) || HOT_BLOCKS.has(d.world.peekBlock(bx, fy, bz))) hot = true;
      }
    this.burnToast -= dt;
    this.sizzleIn -= dt;
    if (hot && playing && !d.player.dead) {
      d.survival.damage(MARS.lavaDps * dt, 'heat', true);
      if (this.burnToast <= 0) {
        this.burnToast = 4;
        d.hud.ai(t('mars.lava'), true);
        d.rig.shake(0.25);
      }
      if (this.sizzleIn <= 0) {
        this.sizzleIn = 0.35;
        d.sfx.play('sizzle');
      }
      d.particles.spawn(p.x, p.y + 0.2, p.z, (Math.random() - 0.5) * 0.6, 1.6, (Math.random() - 0.5) * 0.6, 0.18, SMOKE, 1.2, -0.6, true);
    }

    // onde há lava por perto (uma varredura por segundo)
    this.scanIn -= dt;
    if (this.scanIn <= 0) {
      this.scanIn = 1;
      this.lavaCells = [];
      const R = 18;
      for (let x = fx - R; x <= fx + R; x += 1)
        for (let z = fz - R; z <= fz + R; z += 1) {
          const y = d.world.topY(x, z);
          if (d.world.peekBlock(x, y, z) === LAVA) this.lavaCells.push([x, y, z]);
        }
    }
    if (!this.lavaCells.length) return;
    this.emberAcc += dt * Math.min(40, this.lavaCells.length * 0.8);
    while (this.emberAcc >= 1) {
      this.emberAcc -= 1;
      const [x, y, z] = this.lavaCells[Math.floor(Math.random() * this.lavaCells.length)];
      const ex = x + Math.random(), ez = z + Math.random();
      if (Math.random() < 0.75) {
        d.particles.spawn(ex, y + 1.05, ez, (Math.random() - 0.5) * 0.5, 1.2 + Math.random() * 1.8, (Math.random() - 0.5) * 0.5, 0.06 + Math.random() * 0.05, EMBER, 0.8 + Math.random() * 0.8, -0.4);
      } else {
        d.particles.spawn(ex, y + 1.1, ez, 0, 0.8 + Math.random() * 0.6, 0, 0.3, SMOKE, 2.2, -0.2, true);
      }
    }
  }

  /** erupções: tremor, ronco e um chafariz de lava saindo da caldeira */
  private volcano(dt: number, playing: boolean): void {
    const { d } = this;
    const p = d.player.pos;
    const dist = Math.hypot(p.x - VOLCANO.x, p.z - VOLCANO.z);
    this.eruptionIn -= dt;
    if (this.eruptionIn <= 0 && playing) {
      const [a, b] = MARS.eruptionEvery;
      this.eruptionIn = a + Math.random() * (b - a);
      if (dist < MARS.eruptionRange) {
        this.fountain = 5;
        const near = 1 - dist / MARS.eruptionRange;
        d.rig.shake(0.2 + near * 0.6);
        d.sfx.play('rumble');
        if (near > 0.25) d.hud.ai(t('mars.eruption'), true);
      }
    }
    if (this.fountain <= 0) return;
    this.fountain -= dt;
    if (dist > MARS.eruptionRange + 40) return;
    const top = d.world.topY(VOLCANO.x, VOLCANO.z) + 1;
    const n = Math.ceil(dt * 70);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = Math.random() * 3.2;
      d.particles.spawn(VOLCANO.x + Math.cos(a) * 1.5, top, VOLCANO.z + Math.sin(a) * 1.5, Math.cos(a) * s, 9 + Math.random() * 8, Math.sin(a) * s, 0.2 + Math.random() * 0.2, EMBER, 2.2, 9);
    }
    if (Math.random() < dt * 12) d.particles.spawn(VOLCANO.x, top + 2, VOLCANO.z, 0, 2.5, 0, 1.4, SMOKE, 5, -0.15, true);
  }
}
