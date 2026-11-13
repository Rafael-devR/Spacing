// Experiência da estufa (docs/design/ESTUFA.md): o holograma que acompanha a mira no modo construir, o assentamento no terreno,
// o botão de ação perto da obra (entregar a próxima peça, finalizar) e a etiqueta que diz o que falta. As regras ficam em
// systems/Greenhouse.ts, a colisão em world/greenhouseLayout.ts e o desenho em render/greenhouseModel.ts.
import * as THREE from 'three';
import type { Sfx } from '../audio/Sfx';
import type { Haptics } from '../core/haptics';
import { AIR, ICE, LAVA, MARS_DUST, REGOLITH, type BlockId } from '../data/blocks';
import { GH, PARTS } from '../data/greenhouse';
import type { ItemId } from '../data/items';
import { PLANET } from '../core/planet';
import { t, type MessageKey } from '../i18n';
import { GreenhouseModel } from '../render/greenhouseModel';
import type { Particles } from '../render/particles';
import { costText, doorApron, anchorAt, missingText, type Greenhouse } from '../systems/Greenhouse';
import type { Interaction } from '../systems/Interaction';
import type { Inventory } from '../systems/Inventory';
import type { Hud } from '../ui/Hud';
import { greenhouseStructure, applyParts } from '../world/greenhouseLayout';
import type { Structure } from '../world/Structure';
import type { World } from '../world/World';
import type { GameBus, GameState } from './events';

export interface GreenhouseDeps {
  scene: THREE.Scene;
  events: GameBus;
  world: World;
  state: Greenhouse;
  /** a estrutura de uma obra que já estava salva (registrada no mundo antes de gerar os chunks) */
  structure: Structure | null;
  inventory: Inventory;
  interaction: Interaction;
  hud: Hud;
  sfx: Sfx;
  haptics: Haptics;
  particles: Particles;
  /** a caixa da base (a estufa fica longe dela) */
  baseBox: { x0: number; z0: number; x1: number; z1: number; y0: number; y1: number };
  player: () => { x: number; y: number; z: number };
  getState(): GameState;
  persist(): void;
}

export interface UseOption {
  label: string;
  /** distância até a borda da obra (menor ganha do resto) */
  dist: number;
}

export class GreenhouseDirector {
  private model: GreenhouseModel | null = null;
  private structure: Structure | null;
  private readonly ghost: GreenhouseModel;
  private labelDirty = true;
  private readonly groundColor = PLANET.id === 'marte' ? '#7a4a38' : '#8f877b';

  constructor(private readonly d: GreenhouseDeps) {
    this.structure = d.structure;
    this.ghost = new GreenhouseModel(this.groundColor, true);
    this.ghost.group.visible = false;
    d.scene.add(this.ghost.group);
    if (d.state.site) this.buildModel();
    d.interaction.onSite = (x, _y, z) => this.tryPlace(x, z);
    d.events.on('inventory:changed', () => (this.labelDirty = true));
  }

  get site(): Greenhouse['site'] {
    return this.d.state.site;
  }

  private buildModel(): void {
    const site = this.d.state.site;
    if (!site) return;
    this.model = new GreenhouseModel(this.groundColor);
    this.model.moveTo(site.x, site.floorY, site.z);
    this.model.setState(site.parts, site.done);
    this.d.scene.add(this.model.group);
    this.labelDirty = true;
  }

  // ---------- assentar ----------

  /** Tenta assentar o holograma com o centro no bloco mirado. true = assentou. */
  private tryPlace(tx: number, tz: number): boolean {
    const { d } = this;
    const a = anchorAt(tx, tz);
    const chk = d.state.check(d.world, d.baseBox, a.x, a.z, d.player());
    if (!chk.ok) {
      d.sfx.play('deny');
      d.hud.toast(t(`gh.bad.${chk.reason ?? 'uneven'}` as MessageKey), true);
      return false;
    }
    this.commit(chk.x, chk.z, chk.floorY);
    d.inventory.removeSelected(1);
    return true;
  }

  /** Nivela o chão, registra a obra e mostra o holograma. */
  private commit(x: number, z: number, floorY: number): void {
    const { d } = this;
    this.level(x, z, floorY);
    d.state.placeSite(x, z, floorY);
    const site = d.state.site;
    if (site) {
      this.structure = greenhouseStructure(site);
      d.world.addStructure(this.structure);
    }
    this.buildModel();
    const c = { x: x + GH.size / 2, y: floorY + 1, z: z + GH.size / 2 };
    d.particles.dust(c.x, c.y, c.z, 14, GH.size / 2);
    d.sfx.play('place', 0.8, c);
    d.haptics.play('success');
    d.hud.ai(t('gh.placed'));
    d.persist();
  }

  /** Só no modo de teste: assenta a obra perto de (x, z), no primeiro lugar que serve ou, se nenhum servir, à força. */
  testPlace(x: number, z: number): string {
    const { d } = this;
    if (d.state.site) return 'Já há uma obra';
    let best: { x: number; z: number; floorY: number; dist: number } | null = null;
    for (let dz = -14; dz <= 14; dz += 2)
      for (let dx = -14; dx <= 14; dx += 2) {
        const a = anchorAt(x + dx, z + dz);
        const c = d.state.check(d.world, d.baseBox, a.x, a.z, d.player());
        const dist = Math.hypot(dx, dz);
        if (c.ok && (!best || dist < best.dist)) best = { x: a.x, z: a.z, floorY: c.floorY, dist };
      }
    if (best) {
      this.commit(best.x, best.z, best.floorY);
      return 'Obra assentada em chão que serve';
    }
    const a = anchorAt(x, z);
    const c = d.state.check(d.world, null, a.x, a.z);
    this.commit(a.x, a.z, c.floorY);
    return 'Obra assentada à força (nivelando o chão)';
  }

  /** Só no modo de teste: tira a obra do mundo (o terreno nivelado fica) e devolve o projeto. */
  testRemove(): boolean {
    const { d } = this;
    const s = d.state.site;
    if (!s) return false;
    if (this.structure) {
      const i = d.world.structures.indexOf(this.structure);
      if (i >= 0) d.world.structures.splice(i, 1);
    }
    this.structure = null;
    if (this.model) {
      d.scene.remove(this.model.group);
      this.model.dispose();
      this.model = null;
    }
    d.state.site = null;
    d.inventory.add('greenhouse_plan', 1, false);
    d.persist();
    return true;
  }

  /** Só no modo de teste: entrega a próxima peça (ou finaliza) sem precisar do material nem estar perto. */
  testStep(): string {
    const { d } = this;
    if (!d.state.site) return 'Sem obra';
    const next = d.state.nextPart();
    if (next) for (const [k, n] of Object.entries(next.cost) as [ItemId, number][]) if (d.inventory.count(k) < n) d.inventory.add(k, n - d.inventory.count(k), false);
    const before = d.state.delivered + (d.state.done ? 1 : 0);
    this.use();
    return d.state.delivered + (d.state.done ? 1 : 0) > before ? (next ? `Entregue: ${next.name}` : 'Estufa finalizada') : 'Nada a fazer';
  }

  /** Nivela o chão: a pegada fica rente ao piso e a faixa de fora da porta fica rente ao piso de dentro. */
  private level(x: number, z: number, floorY: number): void {
    const { world } = this.d;
    const fallback: BlockId = PLANET.id === 'marte' ? MARS_DUST : REGOLITH;
    const edits: [number, number, number, number][] = [];
    const fix = (wx: number, wz: number, targetTop: number): void => {
      const top = world.topY(wx, wz);
      let ground = world.getBlock(wx, top, wz);
      if (ground === AIR || ground === LAVA || ground === ICE) ground = fallback;
      for (let y = top; y > targetTop; y--) edits.push([wx, y, wz, AIR]);
      for (let y = top + 1; y <= targetTop; y++) edits.push([wx, y, wz, ground]);
      const p = world.propAt(wx, wz);
      if (p) world.removeProp(p);
    };
    // sob a estufa o terreno chega a floorY - 1; a célula do piso é da estrutura
    for (let dz = 0; dz < GH.size; dz++) for (let dx = 0; dx < GH.size; dx++) fix(x + dx, z + dz, floorY - 1);
    for (const [ax, az] of doorApron(x, z)) fix(ax, az, floorY);
    world.setBlocks(edits);
  }

  // ---------- a cada quadro ----------

  update(dt: number, time: number): void {
    const { d } = this;
    this.model?.update(dt, time);
    // o fantasma: só com o projeto na mão, no modo construir, mirando o chão
    const tg = d.interaction.target;
    const holding = d.inventory.selectedItem() === 'greenhouse_plan' && d.interaction.buildMode && !d.state.site;
    if (holding && tg && tg.kind === 'block') {
      const a = anchorAt(tg.x, tg.z);
      const chk = d.state.check(d.world, d.baseBox, a.x, a.z, d.player());
      this.ghost.moveTo(a.x, chk.floorY, a.z);
      this.ghost.setValid(chk.ok);
      this.ghost.group.visible = true;
    } else this.ghost.group.visible = false;
    this.ghost.update(dt, time);

    if (this.model) {
      const p = d.player();
      const s = d.state.site;
      const near = !!s && Math.hypot(p.x - (s.x + GH.size / 2), p.z - (s.z + GH.size / 2)) < 15 && d.getState() === 'playing';
      this.model.showLabel(near && !!s && !s.done);
      if (this.labelDirty && near) this.writeLabel();
    }
  }

  private writeLabel(): void {
    const { d } = this;
    const s = d.state.site;
    if (!s || !this.model) return;
    this.labelDirty = false;
    const next = d.state.nextPart();
    const lack = d.state.missing(d.inventory);
    const foot = d.state.complete ? t('gh.finishHint') : Object.keys(lack).length ? t('gh.missing', { list: missingText(lack) }) : t('gh.ready');
    this.model.setLabel(t('gh.title'), PARTS.map((p) => s.parts.includes(p.id)), next ? { name: next.name, cost: costText(next.cost) } : null, foot);
  }

  // ---------- baú da base ----------

  /** Abre o baú de suprimentos da base (uma vez): o projeto e o material vão para a mochila. */
  openChest(): void {
    const { d } = this;
    const r = d.state.openChest(d.inventory);
    if (!r.ok) {
      if (r.reason === 'full') {
        d.sfx.play('deny');
        d.hud.toast(t('gh.chestFull'), true);
      }
      return;
    }
    d.sfx.play('equip');
    d.haptics.play('success');
    d.hud.ai(t('gh.chestOpened'));
    d.persist();
  }

  chestOpened(): boolean {
    return this.d.state.chestOpened;
  }

  // ---------- botão de ação ----------

  /** O botão de ação: o que dá para fazer na obra, se o astronauta estiver ao alcance dela. */
  useOption(): UseOption | null {
    const { d } = this;
    const s = d.state.site;
    if (!s || s.done) return null;
    const p = d.player();
    const cx = s.x + GH.size / 2, cz = s.z + GH.size / 2;
    const dx = Math.max(Math.abs(p.x - cx) - GH.size / 2, 0), dz = Math.max(Math.abs(p.z - cz) - GH.size / 2, 0);
    const dist = Math.hypot(dx, dz);
    if (dist > GH.reach || Math.abs(p.y - (s.floorY + 1)) > 3.5) return null;
    const next = d.state.nextPart();
    return { label: next ? t('gh.deliver', { name: next.name }) : t('gh.finish'), dist };
  }

  use(): void {
    const { d } = this;
    const s = d.state.site;
    if (!s || !this.model) return;
    const c = { x: s.x + GH.size / 2, y: s.floorY + 1.5, z: s.z + GH.size / 2 };
    if (d.state.complete) {
      if (!d.state.finish()) return;
      this.model.setState(s.parts, true);
      d.sfx.play('craftDone', 1, c);
      d.haptics.play('success');
      d.hud.banner(t('gh.doneTitle'), t('gh.doneSub'));
      for (let k = 0; k < 40; k++) {
        const a = (k / 40) * Math.PI * 2, r = GH.size / 2 + 0.4;
        d.particles.spawn(c.x + Math.cos(a) * r, c.y - 0.4, c.z + Math.sin(a) * r, 0, 2 + Math.random() * 2, 0, 0.05, [0.6, 2.0, 2.4], 0.9, 1);
      }
      d.persist();
      return;
    }
    const r = d.state.deliver(d.inventory);
    if (!r.ok) {
      d.sfx.play('deny');
      d.hud.toast(t('gh.missing', { list: missingText(r.missing) }), true);
      return;
    }
    if (this.structure) applyParts(this.structure, s);
    this.model.setState(s.parts, false);
    this.labelDirty = true;
    d.sfx.play('equip', 1, c);
    d.haptics.play('tap');
    d.particles.dust(c.x, c.y - 0.5, c.z, 10, GH.size / 2 - 0.4);
    for (let k = 0; k < 14; k++) {
      const a = Math.random() * Math.PI * 2;
      d.particles.spawn(c.x, c.y, c.z, Math.cos(a) * 2, 1 + Math.random() * 2, Math.sin(a) * 2, 0.04, [0.6, 2.0, 2.4], 0.5, 6);
    }
    d.hud.toast(t('gh.delivered', { name: r.part.name }));
    if (d.state.complete) d.hud.ai(t('gh.allParts'));
    d.persist();
  }
}
