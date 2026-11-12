// Experiência da base (docs/design/BASE.md): botão de ação perto da porta e dos móveis, sequência da câmara
// de pressurização (entrar e sair), estações de fabricação (bancada com laser, forno, eletrolisador; trabalham
// sozinhas e guardam o resultado: docs/design/CRAFTING.md), descanso no beliche e renascer na base.
// As regras ficam nos sistemas (Crafting, Equipment, Survival); o modelo e a animação em render/.
import * as THREE from 'three';
import type { Sfx, Voice } from '../audio/Sfx';
import type { Haptics } from '../core/haptics';
import type { Input } from '../core/Input';
import { BASE, STATION_FURNITURE } from '../data/base';
import { EQUIPMENT } from '../data/equipment';
import { ITEMS } from '../data/items';
import type { Recipe, RecipeOutput } from '../data/recipes';
import { STATIONS, type StationId } from '../data/stations';
import type { Player } from '../entities/Player';
import { t } from '../i18n';
import type { BaseModel } from '../render/baseModel';
import { createEquipModel } from '../render/equipModels';
import { showIndoors } from '../render/indoors';
import type { IsoRig } from '../render/IsoRig';
import type { ItemModels } from '../render/itemModels';
import type { Particles } from '../render/particles';
import type { Crafting } from '../systems/Crafting';
import type { Interaction } from '../systems/Interaction';
import type { Survival } from '../systems/Survival';
import type { BaseHud } from '../ui/BaseHud';
import type { CraftPanel } from '../ui/CraftPanel';
import { mmss } from '../ui/dom';
import type { Hud } from '../ui/Hud';
import type { ModuleLayout, Point } from '../world/baseLayout';
import type { World } from '../world/World';
import type { GameBus, GameState } from './events';

export type BaseMode = 'outside' | 'entering' | 'inside' | 'exiting' | 'resting';

export interface BaseSaveState {
  inside: boolean;
  respawn: 'lander' | 'base';
  visited: boolean;
}

export interface BaseDirectorDeps {
  events: GameBus;
  scene: THREE.Scene;
  world: World;
  layout: ModuleLayout;
  model: BaseModel;
  player: Player;
  rig: IsoRig;
  input: Input;
  interaction: Interaction;
  survival: Survival;
  crafting: Crafting;
  craftPanel: CraftPanel;
  hud: Hud;
  baseHud: BaseHud;
  sfx: Sfx;
  haptics: Haptics;
  particles: Particles;
  itemModels: ItemModels;
  getState(): GameState;
  persist(): void;
}

type UseKind = 'enter' | 'exit' | 'bed' | StationId;

const isStationUse = (k: UseKind): k is StationId => k in STATIONS;

/** nome curto do que a receita entrega (primeira saída) */
export function outputName(o: RecipeOutput): string {
  if (o.kind === 'item') return ITEMS[o.item].name;
  if (o.kind === 'equip') return EQUIPMENT[o.equip].name;
  return STATIONS[o.station].name;
}

interface Flying {
  obj: THREE.Object3D;
  t: number;
  from: THREE.Vector3;
  /** null = até o astronauta */
  to: THREE.Vector3 | null;
  done: () => void;
}

export class BaseDirector {
  mode: BaseMode = 'outside';
  /** onde o astronauta renasce */
  respawn: 'lander' | 'base' = 'lander';
  /** já viu a base (o aviso da IA aparece uma vez) */
  visited = false;
  /**
   * Câmera no ambiente de dentro (só a base, mundo de fora travado). Troca atrás das portas da câmara de
   * pressurização, um pouco depois de entrar e um pouco antes de sair (o Game aplica a troca).
   */
  indoorView = false;
  /** o teste de desempenho roda as cenas de entrar e sair da base com o jogo no estado 'benchmark' */
  benchRun = false;
  private seqT = 0;
  private step = 0;
  private outsideZoom = 30;
  private useKind: UseKind | null = null;
  private laser: Voice | null = null;
  private flying: Flying | null = null;
  private readonly v = new THREE.Vector3();

  constructor(private readonly d: BaseDirectorDeps, saved: BaseSaveState | null) {
    if (saved) {
      this.respawn = saved.respawn;
      this.visited = saved.visited;
    }
    const fab = d.model.fabricator;
    if (fab) {
      fab.onSpark = (x, y, z) => {
        const a = Math.random() * Math.PI * 2;
        d.particles.spawn(x, y, z, Math.cos(a) * 1.6, 1 + Math.random() * 2.2, Math.sin(a) * 1.6, 0.035, [2.6, 1.7, 0.7], 0.25 + Math.random() * 0.2, 9);
      };
    }
    for (const [id, st] of d.model.stations) {
      st.setBuilt(d.crafting.isBuilt(id), false);
      st.onParticle = (x, y, z, vx, vy, vz, color, life) => d.particles.spawn(x, y, z, vx, vy, vz, 0.03, color, life, 2);
    }
    // trabalho que já estava na bancada ao carregar: a peça volta para o ponto em que estava
    const job = d.crafting.job('workbench');
    if (fab && job) fab.resume(this.pieceFor(job.recipe), job.progress, job.ready);
    d.craftPanel.onCraft = (r) => this.craft(r);
    d.craftPanel.onTake = (station) => this.take(station);
    d.events.on('craft:ready', ({ station, recipe }) => this.ready(station, recipe));
  }

  /** dentro da base (abrigado: pressurizado e sem meteoros) */
  get inside(): boolean {
    return this.mode === 'inside' || this.mode === 'resting';
  }

  /** uma cena está acontecendo (o jogo ignora mineração e toques no mundo) */
  get busy(): boolean {
    return this.mode === 'entering' || this.mode === 'exiting' || this.mode === 'resting';
  }

  serialize(): BaseSaveState {
    return { inside: this.inside || this.mode === 'exiting', respawn: this.respawn, visited: this.visited };
  }

  /** Coloca o astronauta dentro, sem transição (carregar salvo, renascer na base). */
  placeInside(): void {
    const { d } = this;
    const bed = d.layout.furniture.find((f) => f.def.kind === 'bed');
    const p = bed?.use ?? d.layout.inside;
    d.player.pos.set(p.x, p.y + 0.02, p.z);
    d.player.prevPos.copy(d.player.pos);
    d.player.vel.set(0, 0, 0);
    if (this.mode !== 'inside') this.outsideZoom = d.rig.distTarget;
    this.setInsideView(true, true);
    this.mode = 'inside';
  }

  /** Teste de desempenho: começa a cena de entrar (só se estiver fora) ou de sair (só se estiver dentro). */
  benchCycle(): void {
    if (this.mode === 'outside') this.beginEnter();
    else if (this.mode === 'inside') this.beginExit();
  }

  /** Onde fica a porta da base, do lado de fora (ponto de partida do cenário "entrar e sair da base"). */
  get outsidePoint(): { x: number; z: number } {
    return this.d.layout.outside;
  }

  /** Coloca o astronauta fora da base na hora, sem cena (o teste de desempenho começa sempre do lado de fora). */
  leaveInstant(): void {
    const { d } = this;
    if (this.mode === 'outside') return;
    d.baseHud.airlockClosed(false);
    d.baseHud.setFade(false);
    d.player.frozen = false;
    d.craftPanel.close();
    d.model.doorTarget = 0;
    d.layout.structure.doorOpen = false;
    this.setInsideView(false, true);
    this.mode = 'outside';
  }

  /** Salvo de antes da base existir com o astronauta onde ela está agora: tira ele para fora. */
  ensureNotStuck(): void {
    const p = this.d.player.pos;
    const b = this.d.layout.structure.box;
    if (this.mode === 'inside') return;
    if (p.x >= b.x0 && p.x < b.x1 + 1 && p.z >= b.z0 && p.z < b.z1 + 1 && p.y < b.y1 + 2) {
      const o = this.d.layout.outside;
      this.d.player.pos.set(o.x, this.d.world.topY(Math.floor(o.x), Math.floor(o.z)) + 1.05, o.z);
      this.d.player.prevPos.copy(this.d.player.pos);
    }
  }

  private setInsideView(on: boolean, instant: boolean): void {
    const { model, layout, rig } = this.d;
    this.indoorView = on;
    model.insideTarget = on ? 1 : 0;
    model.doorGreen = on;
    layout.structure.cutaway = on;
    rig.distTarget = on ? BASE.insideZoom : this.outsideZoom;
    if (instant) {
      model.snap();
      rig.dist = rig.distTarget;
    }
  }

  private v3(p: Point, y?: number): THREE.Vector3 {
    return new THREE.Vector3(p.x, y ?? p.y, p.z);
  }

  /** ponto do mundo no centro da porta */
  private doorPoint(): THREE.Vector3 {
    const { door, floorY } = this.d.layout;
    return new THREE.Vector3(door.x + 0.5, floorY + 1.02, door.z + 0.5);
  }

  /** O jogador apertou o botão de ação. */
  use(): void {
    if (this.d.getState() !== 'playing' || this.busy || !this.useKind) return;
    const kind = this.useKind;
    this.d.sfx.play('ui');
    if (kind === 'enter') this.beginEnter();
    else if (kind === 'exit') this.beginExit();
    else if (kind === 'bed') this.beginRest();
    else if (isStationUse(kind)) this.d.craftPanel.show(kind);
  }

  // ---------- entrar e sair ----------

  private beginEnter(): void {
    const { d } = this;
    this.mode = 'entering';
    this.seqT = 0;
    this.step = 0;
    d.interaction.cancel();
    d.input.reset();
    this.outsideZoom = d.rig.distTarget;
    d.model.doorTarget = 1;
    d.layout.structure.doorOpen = true;
    d.sfx.play('door', 1, this.doorPoint());
    d.haptics.play('tap');
    // anda até a porta e depois para dentro da câmara
    const door = this.doorPoint();
    const dist = Math.hypot(d.player.pos.x - door.x, d.player.pos.z - door.z);
    d.player.walkTo(door, Math.max(0.35, dist / 3), () => {
      d.player.walkTo(this.v3(d.layout.inside, d.layout.floorY + 1.02), 0.5, () => (this.step = 1));
    });
  }

  private beginExit(): void {
    const { d } = this;
    this.mode = 'exiting';
    this.seqT = 0;
    this.step = 0;
    d.interaction.cancel();
    d.input.reset();
    d.craftPanel.close();
    const inside = this.v3(d.layout.inside, d.layout.floorY + 1.02);
    const dist = Math.hypot(d.player.pos.x - inside.x, d.player.pos.z - inside.z);
    d.player.walkTo(inside, Math.max(0.2, dist / 3), () => (this.step = 1));
  }

  private updateEnter(dt: number): void {
    const { d } = this;
    const A = BASE.airlockSeconds;
    if (this.step === 1) {
      // chegou na câmara: porta fecha, portas de bloqueio descem
      this.step = 2;
      this.seqT = 0;
      d.player.frozen = true;
      d.model.doorTarget = 0;
      d.layout.structure.doorOpen = false;
      d.sfx.play('door', 1, this.doorPoint());
      d.baseHud.airlockClosed(true, t('base.pressurizing'), t('base.equalizing'));
      d.baseHud.airlockProgress(0);
      window.setTimeout(() => d.sfx.play('pressurize'), 300);
      d.haptics.play('medium');
    } else if (this.step === 2) {
      this.seqT += dt;
      const f = Math.min(1, Math.max(0, (this.seqT - 0.4) / (A - 0.9)));
      d.baseHud.airlockProgress(f, f >= 1 ? t('base.ready') : undefined);
      if (this.seqT > 0.5 && this.seqT - dt <= 0.5) this.setInsideView(true, true); // troca atrás das portas
      if (this.seqT >= A) {
        this.step = 3;
        d.baseHud.airlockClosed(false);
        d.player.frozen = false;
        this.mode = 'inside';
        this.visited = true;
        d.hud.ai(t('base.welcome'));
        d.haptics.play('success');
        d.events.emit('base:entered', { module: d.layout.def.id });
        d.persist();
      }
    }
  }

  private updateExit(dt: number): void {
    const { d } = this;
    const A = BASE.airlockSeconds;
    if (this.step === 1) {
      this.step = 2;
      this.seqT = 0;
      d.player.frozen = true;
      d.baseHud.airlockClosed(true, t('base.depressurizing'), t('base.venting'));
      d.baseHud.airlockProgress(1);
      window.setTimeout(() => d.sfx.play('depressurize'), 300);
      d.haptics.play('medium');
    } else if (this.step === 2) {
      this.seqT += dt;
      const f = 1 - Math.min(1, Math.max(0, (this.seqT - 0.4) / (A - 0.9)));
      d.baseHud.airlockProgress(f, f <= 0 ? t('base.outside') : undefined);
      if (this.seqT >= A - 0.35 && this.seqT - dt < A - 0.35) this.setInsideView(false, true);
      if (this.seqT >= A) {
        // portas de bloqueio sobem, a porta abre e o astronauta sai
        this.step = 3;
        d.baseHud.airlockClosed(false);
        d.player.frozen = false;
        d.model.doorTarget = 1;
        d.layout.structure.doorOpen = true;
        d.sfx.play('door', 1, this.doorPoint());
        const o = d.layout.outside;
        const out = new THREE.Vector3(o.x, d.world.topY(Math.floor(o.x), Math.floor(o.z)) + 1.02, o.z);
        d.player.walkTo(this.doorPoint(), 0.45, () =>
          d.player.walkTo(out, 0.55, () => {
            d.model.doorTarget = 0;
            d.layout.structure.doorOpen = false;
            d.sfx.play('door', 1, this.doorPoint());
            this.mode = 'outside';
            d.hud.ai(t('base.left'));
            d.events.emit('base:exited', { module: d.layout.def.id });
            d.persist();
          }),
        );
      }
    }
  }

  // ---------- descanso ----------

  private beginRest(): void {
    const { d } = this;
    this.mode = 'resting';
    this.seqT = 0;
    d.interaction.cancel();
    d.input.reset();
    d.player.frozen = true;
    d.baseHud.setFade(true, t('base.resting'));
    d.sfx.play('rest');
  }

  private updateRest(dt: number): void {
    const { d } = this;
    this.seqT += dt;
    if (this.seqT >= 1.7 && this.seqT - dt < 1.7) {
      d.survival.rest();
      this.respawn = 'base';
      d.baseHud.setFade(false);
      d.player.frozen = false;
      this.mode = 'inside';
      d.hud.ai(t('base.rested'));
      d.haptics.play('success');
      const p = d.player.pos;
      d.events.emit('player:rested', { x: p.x, y: p.y, z: p.z });
      d.persist();
    }
  }

  // ---------- fabricação ----------

  /** modelo da peça que a bancada imprime: o equipamento, a máquina em miniatura ou o item */
  private pieceFor(r: Recipe): THREE.Object3D {
    const o = r.outputs[0];
    if (o.kind === 'equip') return createEquipModel(o.equip);
    if (o.kind === 'item') {
      const m = this.d.itemModels.create(o.item);
      m.scale.setScalar(0.42);
      return m;
    }
    // estação: um bloco de tijolo com uma luz (a máquina de verdade aparece no lugar dela)
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.32, 0.28), new THREE.MeshLambertMaterial({ color: '#b6a48e', flatShading: true }));
    body.position.y = 0.16;
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.02), new THREE.MeshBasicMaterial({ color: STATIONS[o.station].accent, toneMapped: false }));
    lamp.position.set(0, 0.2, 0.15);
    g.add(body, lamp);
    return g;
  }

  private stationPoint(station: StationId): THREE.Vector3 {
    if (station === 'workbench') return this.d.model.fabricator?.piecePosition(new THREE.Vector3()) ?? this.d.player.center();
    return this.d.model.stations.get(station)?.topPosition(new THREE.Vector3()) ?? this.d.player.center();
  }

  private craft(r: Recipe): void {
    const { d } = this;
    if (!d.crafting.start(r)) return;
    const st = STATIONS[r.station];
    if (r.station === 'workbench') {
      const fab = d.model.fabricator;
      fab?.start(this.pieceFor(r));
      this.laser?.stop();
      this.laser = fab ? d.sfx.laser(fab.piecePosition(this.v)) : null;
    } else d.sfx.play('pressurize', 1.4, this.stationPoint(r.station));
    d.haptics.play('tap');
    const secs = Math.round(d.crafting.job(r.station)?.duration ?? 0);
    d.hud.toast(t('craft.started', { station: st.name, name: outputName(r.outputs[0]), time: mmss(secs) }));
    d.craftPanel.render();
    d.persist();
  }

  /** a estação terminou: o resultado fica nela esperando */
  private ready(station: StationId, recipeId: string): void {
    const { d } = this;
    const job = d.crafting.job(station);
    const name = job ? outputName(job.recipe.outputs[0]) : recipeId;
    const at = this.stationPoint(station);
    if (station === 'workbench') {
      this.laser?.stop();
      this.laser = null;
      d.model.fabricator?.finish();
      for (let k = 0; k < 24; k++) {
        const a = Math.random() * Math.PI * 2;
        d.particles.spawn(at.x, at.y, at.z, Math.cos(a) * 2, 1 + Math.random() * 2, Math.sin(a) * 2, 0.05, [0.6, 2.0, 2.4], 0.5, 2);
      }
    }
    d.sfx.play('craftDone', 1, this.inside ? at : undefined);
    d.haptics.play('success');
    if (this.inside) d.hud.toast(t('craft.ready', { station: STATIONS[station].name, name }));
    else d.hud.ai(t('craft.readyAway', { station: STATIONS[station].name, name }));
    d.craftPanel.render();
    d.persist();
  }

  /** O jogador apertou "Pegar" na tela da estação. */
  private take(station: StationId): void {
    const { d } = this;
    const fab = d.model.fabricator;
    const res = d.crafting.take(station);
    if (!res) return;
    for (const o of res.delivered) {
      if (o.kind === 'equip') {
        const name = EQUIPMENT[o.equip].name;
        this.fly(station, null, () => {
          d.sfx.play('equip');
          d.hud.banner(t('craft.done'), t('craft.equipped', { name }));
        });
      } else if (o.kind === 'station') {
        const target = d.model.stations.get(o.station);
        const name = STATIONS[o.station].name;
        this.fly(station, target ? target.topPosition(new THREE.Vector3()) : null, () => {
          target?.setBuilt(true, true);
          d.sfx.play('craftDone', 0.8, target?.topPosition(new THREE.Vector3()));
          d.hud.banner(t('craft.installed'), name);
        });
      }
    }
    // itens da bancada: a peça voa até o astronauta (os do forno e do eletrolisador saem direto)
    if (station === 'workbench' && res.delivered.length === 0 && !res.partial) this.fly(station, null, () => d.sfx.play('equip'));
    if (station === 'workbench' && !res.partial && fab?.holding) fab.takePiece();
    d.haptics.play('success');
    d.craftPanel.render();
    d.persist();
  }

  /** a peça pronta sai da bancada e voa até o astronauta (ou até o lugar da estação nova) */
  private fly(station: StationId, to: THREE.Vector3 | null, done: () => void): void {
    const { d } = this;
    if (this.flying) {
      d.scene.remove(this.flying.obj);
      this.flying.done();
    }
    const fab = d.model.fabricator;
    const obj = station === 'workbench' ? fab?.takePiece() : null;
    if (!obj) {
      done();
      return;
    }
    showIndoors(obj);
    d.scene.add(obj);
    this.flying = { obj, t: 0, from: obj.position.clone(), to, done };
  }

  private updateFlying(dt: number): void {
    const { d } = this;
    const f = this.flying;
    if (!f) return;
    f.t += dt;
    const dur = f.to ? 0.9 : 0.55;
    const k = Math.min(1, f.t / dur);
    const to = f.to ?? d.player.center();
    f.obj.position.lerpVectors(f.from, to, k * k);
    f.obj.position.y += Math.sin(k * Math.PI) * (f.to ? 1.2 : 0.8);
    f.obj.scale.setScalar(1 - k * 0.7);
    f.obj.rotation.y += dt * 10;
    if (k >= 1) {
      d.scene.remove(f.obj);
      this.flying = null;
      d.haptics.play('success');
      f.done();
    }
  }

  // ---------- a cada quadro ----------

  update(dt: number): void {
    const { d } = this;
    const state = d.getState();
    if (state === 'playing' || (this.benchRun && state === 'benchmark')) {
      if (this.mode === 'entering') this.updateEnter(dt);
      else if (this.mode === 'exiting') this.updateExit(dt);
      else if (this.mode === 'resting') this.updateRest(dt);
    }
    this.updateFlying(dt);

    // as máquinas mostram o estado do sistema
    const fab = d.model.fabricator;
    const bench = d.crafting.job('workbench');
    if (fab && bench && !bench.ready) {
      fab.progress = bench.progress;
      // o som do laser só pode começar depois do primeiro toque (áudio do navegador)
      if (!this.laser && fab.busy) this.laser = d.sfx.laser(fab.piecePosition(this.v));
    }
    for (const [id, st] of d.model.stations) {
      const j = d.crafting.job(id);
      st.working = !!j && !j.ready;
      st.ready = !!j && j.ready;
      st.progress = j?.progress ?? 0;
    }

    // botão de ação: o que estiver mais perto
    const p = d.player.pos;
    let kind: UseKind | null = null;
    let label: string | null = null;
    if (state === 'playing' && !this.busy && !d.craftPanel.open) {
      const near = (q: Point, r = BASE.useRadius): number => {
        const dd = Math.hypot(p.x - q.x, p.z - q.z);
        return dd < r && Math.abs(p.y - q.y) < 2.2 ? dd : Infinity;
      };
      const options: [UseKind, number][] = [];
      if (this.mode === 'outside') options.push(['enter', near(d.layout.outside, 1.6)]);
      else if (this.mode === 'inside') {
        options.push(['exit', near(d.layout.inside)]);
        for (const f of d.layout.furniture) {
          const station = STATION_FURNITURE[f.def.kind];
          if (station) options.push([station, near(f.use)]);
          if (f.def.kind === 'bed') options.push(['bed', near(f.use)]);
        }
      }
      const best = options.filter(([, dd]) => dd < Infinity).sort((a, b) => a[1] - b[1])[0];
      if (best) {
        kind = best[0];
        if (isStationUse(kind)) {
          const j = d.crafting.job(kind);
          const name = STATIONS[kind].name;
          label = !d.crafting.isBuilt(kind)
            ? t('base.stationSpot', { name })
            : j?.ready
              ? t('base.stationReady', { name })
              : t('base.station', { name });
        } else label = t(kind === 'enter' ? 'base.enter' : kind === 'exit' ? 'base.exit' : 'base.bed');
      }
      // primeira vez perto da base: a IA explica
      if (!this.visited && this.mode === 'outside' && Math.hypot(p.x - d.layout.center.x, p.z - d.layout.center.z) < 11) {
        this.visited = true;
        d.hud.ai(t('base.firstSeen'));
      }
    }
    this.useKind = kind;
    d.baseHud.setUse(label);
    d.model.padHighlight += ((kind === 'enter' ? 1 : 0) - d.model.padHighlight) * Math.min(1, dt * 6);
  }
}
