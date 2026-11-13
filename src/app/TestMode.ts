// Executor do modo de teste (docs/design/TESTE.md): faz cada ação do catálogo (data/testmode.ts) direto nos sistemas do jogo,
// sem esperar nem jogar até lá. É a mesma porta para o painel do celular (ui/TestPanel.ts) e para o teste automatizado
// (`window.spacing.testMode.run('meteor.now')`). Cada ação devolve se deu certo e uma frase curta para mostrar.
import * as THREE from 'three';
import type { Sfx } from '../audio/Sfx';
import { leaveTestMode } from '../core/testmode';
import { CHEST, GH } from '../data/greenhouse';
import { METEOR } from '../data/meteors';
import { ITEMS, ITEM_ORDER, isItemId } from '../data/items';
import { PROPS, PROP_DEBRIS, PROP_TYPES, type PropType } from '../data/props';
import { STATION_ORDER } from '../data/stations';
import { TEST_SOUNDS } from '../data/testmode';
import type { EquipId } from '../data/equipment';
import type { Debris } from '../entities/Debris';
import type { ItemDrops } from '../entities/ItemDrops';
import type { LootPiles } from '../entities/LootPiles';
import type { Meteors } from '../entities/Meteors';
import type { Player } from '../entities/Player';
import type { IsoRig } from '../render/IsoRig';
import type { Crafting } from '../systems/Crafting';
import type { Equipment } from '../systems/Equipment';
import type { Exploration } from '../systems/Exploration';
import type { Inventory } from '../systems/Inventory';
import type { Missions } from '../systems/Missions';
import type { Power } from '../systems/Power';
import type { Greenhouse } from '../systems/Greenhouse';
import type { Survival } from '../systems/Survival';
import type { Hud } from '../ui/Hud';
import { LANDER } from '../world/terrain';
import type { World } from '../world/World';
import type { BaseDirector } from './BaseDirector';
import type { GreenhouseDirector } from './GreenhouseDirector';

export interface TestModeDeps {
  world: World;
  player: Player;
  rig: IsoRig;
  inventory: Inventory;
  equipment: Equipment;
  crafting: Crafting;
  power: Power;
  missions: Missions;
  survival: Survival;
  exploration: Exploration;
  meteors: Meteors;
  debris: Debris;
  loot: LootPiles;
  drops: ItemDrops;
  base: BaseDirector;
  greenhouse: GreenhouseDirector;
  greenhouseState: Greenhouse;
  hud: Hud;
  sfx: Sfx;
  /** escala do tempo do jogo (1 = normal, 0 = parado) */
  setTimeScale(k: number): void;
  hitStop(seconds: number): void;
  slowMotion(seconds: number, scale: number): void;
  /** apaga o salvamento de teste e recarrega */
  resetSave(): void;
}

export interface TestResult {
  ok: boolean;
  msg: string;
}

const ok = (msg: string): TestResult => ({ ok: true, msg });
const no = (msg: string): TestResult => ({ ok: false, msg });

export class TestMode {
  /** quantidade que os botões de item dão */
  qty = 10;
  /** escala do tempo de agora */
  timeScale = 1;

  constructor(private readonly d: TestModeDeps) {}

  /** Faz uma ação. `id` é o do catálogo; `arg` é o valor de uma escolha (`qty`, `time`). Os de item, objeto e som são `nome:valor`. */
  run(id: string, arg?: number): TestResult {
    try {
      const [name, param] = id.split(':');
      switch (name) {
        case 'qty': return this.setQty(arg ?? this.qty);
        case 'time': return this.setTime(arg ?? 1);
        case 'item': return this.give(param);
        case 'prop': return this.prop(param);
        case 'sound': return this.sound(param);
        case 'items.all': return this.giveAll();
        case 'items.clear': return this.clearBag();
        case 'gear.map': return this.equip('map');
        case 'gear.drill_iron': return this.equip('drill_iron');
        case 'gear.drill_crystal': return this.equip('drill_crystal');
        case 'gear.stations': return this.stations();
        case 'gear.craft': return this.finishCrafts();
        case 'gear.power': return this.power();
        case 'player.fill': return this.fill();
        case 'player.immortal': return this.immortal();
        case 'player.hurt': return this.hurt(30);
        case 'player.kill': return this.kill();
        case 'gh.chest': return this.ghChest();
        case 'gh.kit': return this.ghKit();
        case 'gh.site': return this.ghSite();
        case 'gh.step': return this.ghStep();
        case 'gh.build': return this.ghBuild();
        case 'gh.farm': { const m = this.d.greenhouse.testFarm(); return /plantados/.test(m) ? ok(m) : no(m); }
        case 'gh.grow': { const m = this.d.greenhouse.testGrow(0.25); return /cresceram/.test(m) ? ok(m) : no(m); }
        case 'gh.ripe': { const m = this.d.greenhouse.testGrow(1); return /cresceram/.test(m) ? ok(m) : no(m); }
        case 'gh.hungry': this.d.survival.energy = 20; return ok('Energia em 20');
        case 'gh.remove': return this.d.greenhouse.testRemove() ? ok('Obra desmontada') : no('Não há obra');
        case 'tp.greenhouse': return this.tpGreenhouse();
        case 'tp.lander': return this.tpLander();
        case 'tp.door': return this.tpDoor();
        case 'tp.inside': return this.tpInside();
        case 'tp.outside': return this.tpOutside();
        case 'tp.forward': return this.tpForward(30);
        case 'tp.up': return this.tpUp(25);
        case 'meteor.now': return this.meteor({ radius: 2.2 }, 'Meteoro a caminho');
        case 'meteor.instant': return this.meteor({ radius: 2.3, instant: true }, 'Impacto');
        case 'meteor.big': return this.meteor({ radius: 3.4 }, 'Meteoro grande a caminho');
        case 'meteor.small': return this.meteor({ radius: 1.4 }, 'Meteoro pequeno a caminho');
        case 'meteor.rain': return this.rain();
        case 'meteor.close': return this.meteor({ radius: 2.2, min: 4.5, max: 5.5 }, 'Meteoro perto a caminho');
        case 'meteor.auto': return this.auto();
        case 'world.debris': return this.debris();
        case 'world.loot': return this.lootPile();
        case 'world.drops': return this.dropItems();
        case 'world.reveal': return this.reveal();
        case 'world.clearDebris': return this.clearDebris();
        case 'fx.shake': this.d.rig.shake(0.7); return ok('Tremor');
        case 'fx.punch': this.d.rig.punch(1.8); return ok('Soco de zoom');
        case 'fx.hitstop': this.d.hitStop(0.2); return ok('Pausa de impacto');
        case 'fx.slowmo': this.d.slowMotion(1.5, 0.25); return ok('Câmera lenta');
        case 'fx.toast': this.d.hud.toast('Aviso de teste'); return ok('Aviso mostrado');
        case 'fx.ai': this.d.hud.ai('Mensagem de teste da IA do traje.'); return ok('Mensagem da IA');
        case 'mission.skip': this.d.missions.skip(); return ok('Missão cumprida');
        case 'test.reset': this.d.resetSave(); return ok('Recomeçando…');
        case 'test.exit': leaveTestMode(); return ok('Voltando…');
        default: return no(`Ação desconhecida: ${id}`);
      }
    } catch (err) {
      return no(`Erro em ${id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ---------- ajudantes ----------

  /**
   * O ponto no chão a `dist` blocos à frente da câmera (o que se vê no meio da tela). Se ali fica a base, tenta outras
   * direções ao redor (para a frente, depois para os lados e para trás): nada é solto dentro das paredes.
   */
  private ahead(dist: number): THREE.Vector3 {
    const f = this.d.rig.forward(), p = this.d.player.pos;
    const free = (x: number, z: number): boolean =>
      !this.d.world.structures.some((st) => x >= st.box.x0 - 1 && x <= st.box.x1 + 1 && z >= st.box.z0 - 1 && z <= st.box.z1 + 1);
    let x = 0, z = 0;
    for (const a of [0, 0.6, -0.6, 1.2, -1.2, 1.9, -1.9, Math.PI]) {
      const c = Math.cos(a), s = Math.sin(a);
      x = Math.floor(p.x + (f.x * c - f.z * s) * dist);
      z = Math.floor(p.z + (f.x * s + f.z * c) * dist);
      if (free(x, z)) break;
    }
    return new THREE.Vector3(x + 0.5, this.d.world.topY(x, z) + 1, z + 0.5);
  }

  private teleport(x: number, y: number, z: number): void {
    const { player, rig } = this.d;
    player.pos.set(x, y, z);
    player.prevPos.copy(player.pos);
    player.vel.set(0, 0, 0);
    rig.snap(new THREE.Vector3(x, y + 0.8, z));
  }

  /** só deixa agir fora da base (as ações de mundo não valem lá dentro) */
  private ensureOutside(): void {
    if (this.d.base.mode !== 'outside') this.d.base.leaveInstant();
  }

  // ---------- estufa ----------

  private ghChest(): TestResult {
    const before = this.d.inventory.count('greenhouse_plan');
    this.d.greenhouse.openChest();
    return this.d.inventory.count('greenhouse_plan') > before ? ok('Baú aberto') : no('Baú já aberto (ou mochila cheia)');
  }

  private ghKit(): TestResult {
    for (const c of CHEST) this.d.inventory.add(c.item, c.n, false);
    return ok('Projeto e material na mochila');
  }

  private ghSite(): TestResult {
    this.ensureOutside();
    const p = this.ahead(10);
    const msg = this.d.greenhouse.testPlace(Math.floor(p.x), Math.floor(p.z));
    return this.d.greenhouse.site ? ok(msg) : no(msg);
  }

  private ghStep(): TestResult {
    const msg = this.d.greenhouse.testStep();
    return /Entregue|finalizada/.test(msg) ? ok(msg) : no(msg);
  }

  private ghBuild(): TestResult {
    if (!this.d.greenhouse.site) return no('Sem obra: assente uma primeiro');
    for (let i = 0; i < 12 && !this.d.greenhouseState.done; i++) this.d.greenhouse.testStep();
    return this.d.greenhouseState.done ? ok('Estufa finalizada') : no('Não terminou');
  }

  private tpGreenhouse(): TestResult {
    const s = this.d.greenhouse.site;
    if (!s) return no('Sem obra');
    this.ensureOutside();
    const x = s.x + GH.doorAt + 0.5, z = s.z + GH.size + 2.5;
    this.teleport(x, this.d.world.topY(Math.floor(x), Math.floor(z)) + 1.05, z);
    return ok('Na porta da estufa');
  }

  // ---------- itens e equipamento ----------

  private setQty(n: number): TestResult {
    this.qty = n;
    return ok(`Quantidade: ${n}`);
  }

  private give(item: string): TestResult {
    if (!isItemId(item)) return no(`Item desconhecido: ${item}`);
    const left = this.d.inventory.add(item, this.qty, false);
    const added = this.qty - left;
    return added > 0 ? ok(`+${added} ${ITEMS[item].name}${left > 0 ? ` (mochila cheia: ${left} não couberam)` : ''}`) : no('Mochila cheia');
  }

  private giveAll(): TestResult {
    let kinds = 0;
    for (const id of ITEM_ORDER) if (this.d.inventory.add(id, this.qty, false) < this.qty) kinds++;
    return ok(`${kinds} tipos de item (×${this.qty})`);
  }

  private clearBag(): TestResult {
    this.d.inventory.takeEverything();
    return ok('Mochila vazia');
  }

  private equip(id: EquipId): TestResult {
    this.d.equipment.equip(id);
    return ok(`Equipado: ${id}`);
  }

  private stations(): TestResult {
    for (const s of STATION_ORDER) this.d.crafting.unlock(s);
    return ok('Estações instaladas');
  }

  private finishCrafts(): TestResult {
    const n = this.d.crafting.activeJobs().length;
    this.d.crafting.update(3600);
    return ok(n > 0 ? `${n} fabricação(ões) concluída(s)` : 'Nenhuma fabricação andando');
  }

  private power(): TestResult {
    this.d.power.battery = this.d.power.capacity;
    return ok('Bateria da base cheia');
  }

  // ---------- astronauta ----------

  private fill(): TestResult {
    const s = this.d.survival;
    s.o2 = s.battery = s.integrity = 100;
    return ok('Traje cheio');
  }

  private immortal(): TestResult {
    const s = this.d.survival;
    s.immortal = !s.immortal;
    return ok(s.immortal ? 'Imortal: ligado' : 'Imortal: desligado');
  }

  private hurt(n: number): TestResult {
    this.d.survival.invulnerable = 0;
    this.d.survival.damage(n, 'fall');
    return ok(`Dano de ${n}`);
  }

  private kill(): TestResult {
    const s = this.d.survival;
    const imm = s.immortal;
    s.immortal = false;
    s.invulnerable = 0;
    s.damage(999, 'fall');
    s.immortal = imm;
    return ok('Morreu');
  }

  private tpLander(): TestResult {
    this.ensureOutside();
    const x = Math.floor(LANDER.x + 4), z = Math.floor(LANDER.z);
    this.teleport(x + 0.5, this.d.world.topY(x, z) + 1.05, z + 0.5);
    return ok('No módulo de pouso');
  }

  private tpDoor(): TestResult {
    this.ensureOutside();
    const o = this.d.base.outsidePoint;
    this.teleport(o.x, this.d.world.topY(Math.floor(o.x), Math.floor(o.z)) + 1.05, o.z);
    return ok('Na porta da base');
  }

  private tpInside(): TestResult {
    if (this.d.base.mode === 'inside') return ok('Já está dentro');
    this.d.base.placeInside();
    return ok('Dentro da base');
  }

  private tpOutside(): TestResult {
    return this.tpDoor();
  }

  private tpForward(dist: number): TestResult {
    this.ensureOutside();
    const p = this.ahead(dist);
    this.teleport(p.x, p.y + 0.05, p.z);
    return ok(`${dist} blocos à frente`);
  }

  private tpUp(h: number): TestResult {
    this.ensureOutside();
    const p = this.d.player.pos;
    this.teleport(p.x, p.y + h, p.z);
    return ok(`${h} blocos acima`);
  }

  // ---------- meteoros ----------

  private meteor(o: { radius: number; instant?: boolean; min?: number; max?: number }, msg: string, delay = 0): TestResult {
    this.ensureOutside();
    let t: THREE.Vector3 | null = null;
    for (let i = 0; i < 20 && !t; i++) t = this.d.meteors.pickTarget(o.min ?? METEOR.pickMin, o.max ?? METEOR.pickMax);
    if (!t) return no('Sem lugar carregado para o meteoro');
    const m = this.d.meteors.launch(t, { radius: o.radius, meteorite: true, delay });
    if (!m) return no('Meteoro não lançado');
    if (o.instant) m.t = METEOR.flight - 0.03;
    return ok(msg);
  }

  private rain(): TestResult {
    let n = 0;
    for (const delay of [0, 0.4, 0.9, 1.5, 2.2]) if (this.meteor({ radius: 1.8 + Math.random() * 0.8 }, '', delay).ok) n++;
    return n > 0 ? ok(`Chuva de ${n} meteoros`) : no('Sem lugar carregado para os meteoros');
  }

  private auto(): TestResult {
    const m = this.d.meteors;
    m.autoSpawn = !m.autoSpawn;
    return ok(m.autoSpawn ? 'Sorteio automático: ligado' : 'Sorteio automático: desligado');
  }

  // ---------- mundo ----------

  private prop(type: string): TestResult {
    if (!(PROP_TYPES as string[]).includes(type)) return no(`Objeto desconhecido: ${type}`);
    this.ensureOutside();
    const p = this.ahead(6);
    const mesh = this.d.world.addExtraProp({ wx: Math.floor(p.x), wz: Math.floor(p.z), type: type as PropType, rot: Math.random() * 6.28, scale: 1 });
    return mesh ? ok(`${PROPS[type as PropType].name} a 6 blocos`) : no('Não coube aqui (já tem um igual neste lugar)');
  }

  private debris(): TestResult {
    this.ensureOutside();
    const p = this.ahead(6).add(new THREE.Vector3(0, 0.6, 0));
    this.d.debris.burst(p, 40, PROP_DEBRIS.boulder, { power: 3, up: 2.6 });
    return ok('Destroços soltos');
  }

  private lootPile(): TestResult {
    this.ensureOutside();
    this.d.loot.drop(this.ahead(4), { iron: 5, regolith: 8, crystal: 3 });
    return ok('Pilha de itens no chão');
  }

  private dropItems(): TestResult {
    this.ensureOutside();
    const p = this.ahead(3);
    for (const [item, n] of [['regolith', 3], ['iron', 2], ['crystal', 2]] as const) this.d.drops.spawn(item, p.clone().add(new THREE.Vector3(0, 1, 0)), n);
    return ok('Itens saltando');
  }

  private reveal(): TestResult {
    const p = this.d.player.pos;
    const n = this.d.exploration.revealAround(p.x, p.z, 60);
    return ok(`Mapa revelado (${n} lugares novos)`);
  }

  private clearDebris(): TestResult {
    this.d.debris.clear();
    return ok('Destroços limpos');
  }

  // ---------- tempo e som ----------

  private setTime(k: number): TestResult {
    this.timeScale = k;
    this.d.setTimeScale(k);
    return ok(k === 0 ? 'Jogo parado' : `Velocidade ${k}×`);
  }

  private sound(name: string): TestResult {
    if (!(name in TEST_SOUNDS)) return no(`Som desconhecido: ${name}`);
    this.d.sfx.play(name as keyof typeof TEST_SOUNDS);
    return ok(`Som: ${TEST_SOUNDS[name as keyof typeof TEST_SOUNDS]}`);
  }
}
