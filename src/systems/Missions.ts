// Interpreta a cadeia de missões (data/missions.ts) a partir de eventos do jogo.
// Não desenha nada: expõe view() e target() e publica eventos de missão.
import * as THREE from 'three';
import type { GameBus } from '../app/events';
import type { ItemId } from '../data/items';
import { MISSION_01, type MissionStep } from '../data/missions';
import type { Meteors } from '../entities/Meteors';
import type { Player } from '../entities/Player';
import { LANDER } from '../world/terrain';
import type { World } from '../world/World';
import type { Inventory } from './Inventory';

/** pausa entre um objetivo concluído e o próximo */
const NEXT_DELAY = 1.6;
/** distância para "chegar" a um objeto */
const REACH_DIST = 3.6;
/** raio de entrega ao redor do módulo */
const DELIVER_DIST = 4.2;

export interface MissionView {
  index: number;
  total: number;
  step: MissionStep;
  /** 0..1, ou null se o objetivo não tem barra */
  progress: number | null;
  /** objetivo de coleta: quantos já foram coletados */
  collected: number | null;
  /** objetivo de entrega: quanto há e quanto falta de cada item */
  needs: { item: ItemId; have: number; need: number }[] | null;
  done: boolean;
}

export interface MissionsDeps {
  events: GameBus;
  inventory: Inventory;
  player: Player;
  world: World;
  meteors: Meteors;
  /** altura do chão no módulo de pouso */
  landerY: () => number;
}

export class Missions {
  private stepIndex: number;
  private count: number;
  private wait = 0;
  private meteorRetry = 0;
  private deliverWarned = false;
  private readonly landerPos = new THREE.Vector3(LANDER.x + 0.5, 0, LANDER.z + 0.5);
  private readonly steps: MissionStep[] = MISSION_01;

  constructor(
    private readonly d: MissionsDeps,
    saved?: { step: number; count: number },
  ) {
    this.stepIndex = Math.min(saved?.step ?? 0, this.steps.length - 1);
    this.count = saved?.count ?? 0;
    d.events.on('item:collected', ({ item, amount }) => this.onCollect(item, amount));
    d.events.on('prop:broken', ({ type }) => this.onPropBroken(type));
    d.events.on('inventory:changed', () => {
      if (this.current.kind === 'deliver') this.changed();
    });
  }

  get current(): MissionStep {
    return this.steps[this.stepIndex];
  }

  serialize(): { step: number; count: number } {
    return { step: this.stepIndex, count: this.count };
  }

  private changed(): void {
    this.d.events.emit('mission:updated', { step: this.stepIndex });
  }

  private begin(): void {
    const s = this.current;
    this.count = 0;
    this.deliverWarned = false;
    this.changed();
    this.d.events.emit('mission:started', { id: s.id, hint: s.hint });
  }

  private complete(): void {
    const s = this.current;
    this.d.events.emit('mission:completed', { id: s.id, title: s.title });
    this.stepIndex = Math.min(this.stepIndex + 1, this.steps.length - 1);
    this.wait = NEXT_DELAY;
    this.changed();
  }

  private onCollect(item: ItemId, n: number): void {
    const s = this.current;
    if (this.wait > 0 || s.kind !== 'collect' || s.item !== item) return;
    this.count += n;
    this.changed();
    if (this.count >= s.n) this.complete();
  }

  private onPropBroken(type: string): void {
    const s = this.current;
    if (this.wait > 0) return;
    if (s.kind === 'reach' && s.prop === type) {
      // minerou antes de "chegar": pula direto o passo de minerar
      this.stepIndex++;
      this.complete();
      return;
    }
    if (s.kind === 'prop' && s.prop === type) this.complete();
  }

  /** Ponto que o marcador de objetivo deve indicar, se houver. */
  target(): THREE.Vector3 | null {
    const s = this.current;
    if (this.wait > 0) return null;
    if (s.kind === 'reach' || s.kind === 'prop') {
      const m = this.d.world.findProp(s.prop);
      return m ? m.position : null;
    }
    if (s.kind === 'deliver') {
      this.landerPos.y = this.d.landerY();
      return this.landerPos;
    }
    return null;
  }

  view(): MissionView {
    const s = this.current;
    const inv = this.d.inventory;
    const v: MissionView = {
      index: this.stepIndex,
      total: this.steps.length - 1,
      step: s,
      progress: null,
      collected: null,
      needs: null,
      done: s.kind === 'end',
    };
    if (s.kind === 'collect') {
      v.collected = Math.min(this.count, s.n);
      v.progress = Math.min(1, this.count / s.n);
    } else if (s.kind === 'deliver') {
      v.needs = (Object.entries(s.needs) as [ItemId, number][]).map(([item, need]) => ({
        item, need, have: Math.min(need, inv.count(item)),
      }));
      const got = v.needs.reduce((a, n) => a + n.have, 0);
      const need = v.needs.reduce((a, n) => a + n.need, 0);
      v.progress = need ? got / need : 1;
    }
    return v;
  }

  update(dt: number): void {
    if (this.wait > 0) {
      this.wait -= dt;
      if (this.wait <= 0) this.begin();
      return;
    }
    const s = this.current;
    const p = this.d.player.pos;

    if (s.kind === 'reach') {
      const m = this.d.world.findProp(s.prop);
      if (!m && !this.d.meteors.active.length) {
        this.meteorRetry -= dt;
        if (this.meteorRetry <= 0) {
          this.meteorRetry = 2;
          this.d.meteors.launch(this.d.meteors.pickTarget(13, 19), { radius: 2.4, meteorite: true, delay: 1.2 });
        }
      } else if (m && m.position.distanceTo(p) < REACH_DIST) this.complete();
    }

    if (s.kind === 'deliver') {
      const dist = Math.hypot(p.x - this.landerPos.x, p.z - this.landerPos.z);
      if (dist < DELIVER_DIST) {
        const inv = this.d.inventory;
        const needs = Object.entries(s.needs) as [ItemId, number][];
        const missing = needs.filter(([k, n]) => !inv.has(k, n));
        if (!missing.length) {
          inv.removeAll(s.needs);
          this.complete();
        } else if (!this.deliverWarned) {
          this.deliverWarned = true;
          this.d.events.emit('mission:missing', {
            items: missing.map(([item, n]) => ({ item, missing: n - inv.count(item) })),
          });
        }
      } else if (dist > 6) this.deliverWarned = false;
    }
  }
}
