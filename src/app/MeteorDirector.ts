// A experiência do meteoro (docs/design/METEOROS.md): o que o jogador sente, além do que o mundo mostra. Som que acompanha
// a queda, tremor, soco de zoom, pausa de impacto e câmera lenta, clarão de tela, vibração e as ondas de choque que
// entortam a imagem. O mundo (cratera, destroços) é de entities/Meteors.ts e o visual (rocha, fogo, fumaça), de
// render/meteorFx.ts; os números ficam em data/meteors.ts.
import type { Sfx, Voice } from '../audio/Sfx';
import type { Haptics } from '../core/haptics';
import { FLIGHT_FX, IMPACT_CAMERA, RADIUS_REF } from '../data/meteors';
import type { Meteors } from '../entities/Meteors';
import type { IsoRig } from '../render/IsoRig';
import type { Post } from '../render/post';
import { ShockWaves } from '../render/shockwave';
import type { GameBus } from './events';

export interface MeteorDirectorDeps {
  events: GameBus;
  rig: IsoRig;
  sfx: Sfx;
  haptics: Haptics;
  post: Post;
  meteors: Meteors;
  /** pausa de impacto e câmera lenta do laço do jogo */
  hitStop(seconds: number): void;
  slowMotion(seconds: number, scale: number): void;
  /** o astronauta está dentro da base? (lá o impacto é só um tremor grave pelo casco) */
  indoors(): boolean;
  /** só no jogo de verdade: na morte e no teste de desempenho, sem pausa nem câmera lenta */
  cinematic(): boolean;
}

export class MeteorDirector {
  /** as ondas de choque (a passada final entorta a imagem com elas) */
  readonly waves = new ShockWaves();
  /** som de cada meteoro em voo, que acompanha a posição dele */
  private readonly voices = new Map<number, Voice>();
  /** clarão de tela de agora (0 a 1) */
  private flash = 0;

  constructor(private readonly d: MeteorDirectorDeps) {
    d.post.setShockWaves(this.waves);
    d.events.on('meteor:incoming', (m) => {
      const v = d.sfx.play('whoosh', 1, m);
      if (v) this.voices.set(m.id, v);
    });
    d.events.on('meteor:impact', (e) => this.impact(e));
  }

  private impact(e: { id: number; x: number; y: number; z: number; distance: number; radius: number }): void {
    const { d } = this;
    const C = IMPACT_CAMERA;
    this.voices.delete(e.id);
    // dentro da base: um tremor grave que chega pelo casco (sem o que é de ver: a imagem de fora nem é desenhada)
    const indoors = d.indoors();
    d.sfx.play('boom', indoors ? 0.6 : 1, e);
    d.rig.shake(Math.max(C.shakeMin, C.shakeMax - e.distance / C.shakeRange) * (indoors ? C.shakeIndoors : 1));
    if (e.distance < C.hapticRange) d.haptics.play(indoors ? 'medium' : 'heavy');
    if (indoors) return;

    // a onda de choque nasce no ponto de queda e cresce; impacto maior, onda maior
    this.waves.add(e.x, e.y + 0.5, e.z, e.radius / RADIUS_REF);
    // soco de zoom e clarão de tela, mais fortes quanto mais perto
    if (e.distance < C.punchRange) d.rig.punch(C.punch * (1 - e.distance / C.punchRange));
    const f = C.flash;
    this.flash = Math.max(this.flash, f.max * Math.pow(Math.max(0, 1 - e.distance / f.range), 1.5));
    // perto: o tempo para um instante e depois corre devagar
    if (d.cinematic() && e.distance < C.nearRange) {
      d.hitStop(C.hitStop);
      d.slowMotion(C.slowMo.seconds, C.slowMo.scale);
    }
  }

  /** Todo quadro (com o tempo do jogo, que a câmera lenta estica): voz que segue o meteoro, ar tremendo, ondas, clarão. */
  update(dt: number): void {
    const { d } = this;
    for (const [id, v] of this.voices) {
      const h = d.meteors.headOf(id);
      if (h) v.at(h.x, h.y, h.z);
      else this.voices.delete(id);
    }
    if (d.indoors()) {
      this.waves.clear();
      this.flash = 0;
    } else {
      // o ar treme em volta de cada meteoro em voo (maior quanto maior ele é)
      const hz = FLIGHT_FX.haze;
      for (const m of d.meteors.active) {
        if (m.t < 0) continue;
        const h = m.head.position;
        const k = m.radius / RADIUS_REF;
        this.waves.haze(m.id, h.x, h.y, h.z, hz.radius * k, hz.width * k, hz.strength * Math.min(1, m.t / 0.4));
      }
      this.waves.update(dt);
      this.flash = Math.max(0, this.flash - dt * IMPACT_CAMERA.flash.decay);
    }
    d.post.setFlash(this.flash);
  }

  /** O astronauta entrou ou saiu da base: o que estava na tela some. */
  setIndoors(on: boolean): void {
    if (!on) return;
    this.waves.clear();
    this.flash = 0;
    this.d.post.setFlash(0);
  }
}
