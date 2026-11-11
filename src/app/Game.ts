// O jogo: cria os sistemas, liga tudo pelo barramento de eventos e roda o laço principal.
// Estados: carregando → menu → jogando ⇄ pausa.
import * as THREE from 'three';
import { Sfx, type Voice } from '../audio/Sfx';
import { applyOrientation, enterFullscreen, exitFullscreen, fullscreenSupported, isFullscreen, onFullscreenChange } from '../core/fullscreen';
import { Haptics } from '../core/haptics';
import { Input } from '../core/Input';
import { SHAKE_SCALE, loadPrefs, savePrefs, type Prefs } from '../core/prefs';
import { clearSave, defaultStore, loadSave, writeSave, type SaveData } from '../core/save';
import { BASALT, ICE, REGOLITH } from '../data/blocks';
import { ITEMS, ITEM_ORDER, type ItemId } from '../data/items';
import { Debris } from '../entities/Debris';
import { ItemDrops } from '../entities/ItemDrops';
import { LootPiles } from '../entities/LootPiles';
import { Meteors } from '../entities/Meteors';
import { Player } from '../entities/Player';
import { t } from '../i18n';
import { BlockFx } from '../render/BlockFx';
import { Footprints } from '../render/Footprints';
import { renderIcon } from '../render/icons';
import { IsoRig } from '../render/IsoRig';
import { ItemModels } from '../render/itemModels';
import { Lights } from '../render/lights';
import { U, createMaterials } from '../render/materials';
import { PropFactory, createLander, createWaypoint, type Lander, type Waypoint } from '../render/models';
import { Particles, createMotes, type Motes } from '../render/particles';
import { Post, QUALITY, type QualityName } from '../render/post';
import { createBackdrop } from '../render/sky';
import { Interaction } from '../systems/Interaction';
import { Inventory } from '../systems/Inventory';
import { Missions } from '../systems/Missions';
import { Survival } from '../systems/Survival';
import { el, maybeEl } from '../ui/dom';
import { Bag } from '../ui/Bag';
import { Hud } from '../ui/Hud';
import { PauseMenu } from '../ui/PauseMenu';
import { LANDER, SPAWN } from '../world/terrain';
import { World } from '../world/World';
import { AUTOSAVE_MS, FIXED_STEP, MAX_STEPS_PER_FRAME, SEED, TOUCH_AIM_OFFSET, VERSION } from './config';
import { createBus, type GameBus, type GameState, type Vec3Like } from './events';
import { FixedStep } from './FixedStep';
import { SurvivalDirector } from './SurvivalDirector';
import { BaseDirector } from './BaseDirector';
import { HAB_MODULE } from '../data/base';
import { EQUIP_SLOTS, type EquipId } from '../data/equipment';
import { BaseModel } from '../render/baseModel';
import { IndoorView, showIndoors } from '../render/indoors';
import { createEquipModel } from '../render/equipModels';
import { Crafting } from '../systems/Crafting';
import { Equipment } from '../systems/Equipment';
import { BaseHud } from '../ui/BaseHud';
import { CraftPanel } from '../ui/CraftPanel';
import { layoutModule } from '../world/baseLayout';

export class Game {
  state: GameState = 'loading';
  readonly events: GameBus = createBus();

  private readonly store = defaultStore();
  private readonly prefs: Prefs;
  private readonly save: SaveData | null;

  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(30, 1, 1, 400);
  private readonly fog = new THREE.Fog(0x000000, 40, 80); // cor vem do gradiente do céu (shader)
  private readonly lights: Lights;
  private readonly post: Post;
  private qualityName: QualityName;

  readonly world: World;
  readonly inventory: Inventory;
  readonly player: Player;
  private readonly rig: IsoRig;
  private readonly particles: Particles;
  private readonly motes: Motes;
  private readonly input: Input;
  private readonly debris: Debris;
  private readonly drops: ItemDrops;
  private readonly footprints: Footprints;
  private readonly itemModels: ItemModels;
  private readonly interaction: Interaction;
  private readonly meteors: Meteors;
  private readonly missions: Missions;
  private readonly waypoint: Waypoint;
  private readonly lootMarker: Waypoint;
  private readonly lander: Lander;
  readonly survival: Survival;
  readonly loot: LootPiles;
  private readonly blockFx: BlockFx;
  private readonly director: SurvivalDirector;

  private readonly hud = new Hud();
  private readonly pauseMenu: PauseMenu;
  private readonly bag: Bag;
  readonly equipment: Equipment;
  readonly crafting: Crafting;
  readonly base: BaseDirector;
  readonly baseModel: BaseModel;
  /** ambiente de dentro da base: câmera, luz e fundo (render/indoors.ts) */
  private readonly indoors: IndoorView;
  private readonly craftPanel: CraftPanel;
  private readonly baseHud = new BaseHud();
  /** último aviso de mochila cheia (para não repetir a cada item) */
  private fullWarnT = -99;
  private readonly sfx = new Sfx();
  private readonly haptics = new Haptics();
  /** som de cada meteoro em voo, que acompanha a posição dele */
  private readonly meteorVoices = new Map<number, Voice>();

  private readonly fixed = new FixedStep(FIXED_STEP, MAX_STEPS_PER_FRAME);
  private readonly focus = new THREE.Vector3();
  private last = performance.now();
  private time = 0;
  private hudTimer = 0;
  private stepSide = 1;
  /** apagando o progresso: não salvar mais nada */
  private resetting = false;
  private readonly perf = { frames: 0, time: 0, checked: false };
  /** pausa de impacto (s reais) e câmera lenta */
  private hitStop = 0;
  private slowMo = { t: 0, scale: 1 };
  /** coletas em sequência sobem de tom */
  private popCombo = { t: 0, n: 0 };
  private readonly baseY: number;

  constructor(
    private readonly container: HTMLElement,
    private readonly renderer: THREE.WebGLRenderer,
  ) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.localClippingEnabled = true; // impressão da bancada (render/Fabricator.ts)
    container.appendChild(renderer.domElement);

    const scene = this.scene;
    scene.fog = this.fog;
    scene.add(createBackdrop());
    this.lights = new Lights(scene);
    const materials = createMaterials();
    const propFactory = new PropFactory(materials.props);

    this.save = loadSave(this.store, SEED);
    this.prefs = loadPrefs(this.store);
    const events = this.events;
    events.debug = new URLSearchParams(location.search).has('eventos');

    this.world = new World(scene, SEED, materials.terrain, propFactory, events);
    this.world.load(this.save?.world);
    this.baseY = this.world.terrain.spawnH;
    // base: a estrutura entra no mundo antes de gerar os chunks (as pedras soltas respeitam a área)
    const baseLayout = layoutModule(HAB_MODULE, this.world.terrain);
    this.world.addStructure(baseLayout.structure);
    this.inventory = new Inventory(events, this.save?.inventory);
    this.bag = new Bag(this.inventory);
    this.equipment = new Equipment(events, this.save?.equipment);
    this.crafting = new Crafting({ inventory: this.inventory, equipment: this.equipment, events });
    this.craftPanel = new CraftPanel(this.crafting);
    this.player = new Player(scene, this.world, events);
    this.rig = new IsoRig(this.camera);
    this.particles = new Particles(scene);
    this.motes = createMotes(scene);
    this.input = new Input(renderer.domElement, { base: maybeEl('#joystick'), knob: maybeEl('#knob') });
    this.debris = new Debris(scene, this.world, materials.debris, events);
    this.itemModels = new ItemModels(materials, propFactory);
    this.drops = new ItemDrops(scene, this.itemModels, this.inventory);
    this.loot = new LootPiles(scene, this.itemModels, this.world, this.drops, events);
    // mochila cheia: o que não coube volta para o chão e espera ter espaço
    this.loot.canTake = (item, n) => this.inventory.canAdd(item, n);
    this.drops.onOverflow = (item, n, at) => this.loot.drop(at.clone(), { [item]: n });
    this.blockFx = new BlockFx(scene, this.itemModels);
    this.footprints = new Footprints(scene);
    this.interaction = new Interaction({
      scene, camera: this.camera, canvas: renderer.domElement, world: this.world, player: this.player, rig: this.rig,
      particles: this.particles, debris: this.debris, drops: this.drops, inventory: this.inventory, events,
      drillRate: () => this.survival.drillRate(),
    });
    this.meteors = new Meteors({ scene, world: this.world, debris: this.debris, particles: this.particles, player: this.player, events });
    this.waypoint = createWaypoint();
    scene.add(this.waypoint.group);
    this.lootMarker = createWaypoint([2.2, 0.85, 0.3]);
    scene.add(this.lootMarker.group);
    this.lander = createLander();
    scene.add(this.lander.group);
    U.uMistY.value = Math.floor(this.baseY) - 6;
    this.missions = new Missions(
      {
        events, inventory: this.inventory, player: this.player, world: this.world, meteors: this.meteors,
        landerY: () => this.lander.group.position.y,
      },
      this.save?.missions,
    );
    if (this.missions.current.kind === 'end') this.lander.setRepaired(true);
    this.survival = new Survival(
      {
        events,
        position: () => this.player.pos,
        moving: () => Math.hypot(this.player.vel.x, this.player.vel.z) > 0.3,
        mining: () => this.player.mining,
        pressureCenter: () => this.lander.group.position,
        sheltered: () => this.base.inside,
      },
      this.save?.suit,
    );

    // modelo e experiência da base
    const terrain = this.world.terrain;
    this.baseModel = new BaseModel(baseLayout, (x, z) => terrain.column(Math.floor(x), Math.floor(z)).h + 1);
    scene.add(this.baseModel.group);
    this.base = new BaseDirector(
      {
        events, scene, world: this.world, layout: baseLayout, model: this.baseModel, player: this.player, rig: this.rig,
        input: this.input, interaction: this.interaction, survival: this.survival, crafting: this.crafting,
        craftPanel: this.craftPanel, hud: this.hud, baseHud: this.baseHud, sfx: this.sfx, haptics: this.haptics,
        particles: this.particles, getState: () => this.state, persist: () => this.persist(),
      },
      this.save?.base ?? null,
    );

    this.sfx.muted = this.prefs.muted;
    this.haptics.enabled = this.prefs.vibration;
    this.rig.shakeScale = SHAKE_SCALE[this.prefs.shake];
    document.body.classList.toggle('touch', this.input.touch);
    this.input.aimOffset = this.prefs.touchAim === 'offset' ? TOUCH_AIM_OFFSET : 0;

    this.post = new Post(renderer, scene, this.camera);
    this.qualityName = this.prefs.quality ?? this.defaultQuality();
    this.pauseMenu = new PauseMenu(
      {
        onResume: () => this.resume(),
        onQuality: (q) => {
          this.prefs.quality = q;
          this.applyQuality(q ?? this.defaultQuality());
          this.changedPrefs();
        },
        onMuted: (muted) => {
          this.prefs.muted = muted;
          this.sfx.setMuted(muted);
          this.changedPrefs();
        },
        onShake: (level) => {
          this.prefs.shake = level;
          this.rig.shakeScale = SHAKE_SCALE[level];
          this.changedPrefs();
        },
        onVibration: (on) => {
          this.prefs.vibration = on;
          this.haptics.enabled = on;
          this.haptics.play('medium');
          this.changedPrefs();
        },
        onTouchAim: (aim) => {
          this.prefs.touchAim = aim;
          this.input.aimOffset = aim === 'offset' ? TOUCH_AIM_OFFSET : 0;
          this.changedPrefs();
        },
        onFullscreen: (on) => {
          this.prefs.fullscreen = on;
          void (on ? enterFullscreen(this.prefs.orientation === 'landscape') : exitFullscreen());
          this.changedPrefs();
        },
        onOrientation: (o) => {
          this.prefs.orientation = o;
          void applyOrientation(o === 'landscape');
          this.changedPrefs();
        },
        onControls: () => (el('#help').hidden = false),
        onNewGame: () => this.newGame(),
      },
      VERSION,
    );

    this.director = new SurvivalDirector({
      events, hud: this.hud, sfx: this.sfx, haptics: this.haptics, rig: this.rig, post: this.post,
      camera: this.camera, canvas: renderer.domElement, player: this.player, inventory: this.inventory,
      survival: this.survival, loot: this.loot, particles: this.particles, lander: this.lander,
      input: this.input, interaction: this.interaction,
      getState: () => this.state,
      setState: (s) => this.setState(s),
      slowMotion: (seconds, scale) => (this.slowMo = { t: seconds, scale }),
      teleported: () => {
        const p = this.player.pos;
        this.world.update(p.x, p.z, 999, 0);
        this.player.animate(0);
        this.rig.snap(new THREE.Vector3(p.x, p.y + 0.8, p.z));
      },
      placeRespawn: () => {
        if (this.base.respawn === 'base') this.base.placeInside();
        else this.player.spawn(SPAWN.x, SPAWN.z);
      },
      persist: () => this.persist(),
    });

    // dentro da base a câmera só vê a camada do interior: o astronauta e as faíscas também estão nela
    showIndoors(this.player.model.root);
    showIndoors(this.particles.mesh);
    this.indoors = new IndoorView(scene, this.camera, this.lights); // depois de todas as luzes existirem

    this.wireEvents();
    this.wireControls();
    this.applyQuality(this.qualityName);
    this.resize();
    addEventListener('resize', () => this.resize());
    new ResizeObserver(() => this.resize()).observe(container);
    setInterval(() => {
      if (this.state === 'playing') this.persist();
    }, AUTOSAVE_MS);
  }

  // ---------- inicialização ----------

  /** Gera o mundo inicial, posiciona tudo e libera o botão de começar. */
  boot(): void {
    const { world, player, lander } = this;
    world.radius = 3;
    world.update(0, 0, 999, 0);
    lander.group.position.set(LANDER.x + 0.5, world.topY(LANDER.x, LANDER.z) + 1, LANDER.z + 0.5);
    // zumbido do módulo: começa quando o áudio liberar (primeiro toque) e ajuda a achar o caminho de volta
    const lp = lander.group.position;
    this.sfx.onReady = () => this.sfx.hum({ x: lp.x, y: lp.y + 1.2, z: lp.z });
    const saved = this.save?.player;
    if (saved) {
      player.pos.set(saved.x, saved.y + 0.05, saved.z);
      // garante que não nasce dentro de um bloco
      while (player.collides(player.pos.x, player.pos.y, player.pos.z) && player.pos.y < 60) player.pos.y += 1;
      player.prevPos.copy(player.pos);
    } else player.spawn(SPAWN.x, SPAWN.z);
    // salvo dentro da base: volta dentro, sem transição; salvo onde a base agora está: sai para fora
    if (this.save?.base.inside) this.base.placeInside();
    else this.base.ensureNotStuck();
    player.animate(0);
    this.loot.load(this.save?.loot ?? []);
    this.rig.snap(new THREE.Vector3(player.pos.x, player.pos.y + 0.8, player.pos.z));

    const icons = {} as Record<ItemId, string>;
    for (const k of ITEM_ORDER) icons[k] = renderIcon(this.renderer, this.itemModels.create(k));
    this.hud.buildHotbar(icons, this.inventory);
    this.bag.setIcons(icons);
    const equipIcons = {} as Record<EquipId, string>;
    for (const slot of EQUIP_SLOTS) equipIcons[slot] = renderIcon(this.renderer, createEquipModel(slot));
    this.bag.setEquipment(this.equipment, equipIcons);
    this.craftPanel.setIcons(icons, equipIcons);
    this.hud.setMission(this.missions.view());

    el('#loading').hidden = true;
    const startBtn = el<HTMLButtonElement>('#btn-start');
    startBtn.disabled = false;
    startBtn.textContent = t(this.save ? 'menu.continue' : 'menu.start');
    el('#btn-reset').hidden = !this.save;
    this.setState('menu');
  }

  run(): void {
    requestAnimationFrame(this.frame);
  }

  // ---------- estados ----------

  private setState(to: GameState): void {
    const from = this.state;
    if (from === to) return;
    this.state = to;
    document.body.dataset.state = to;
    this.events.emit('game:stateChanged', { from, to });
  }

  start(): void {
    if (this.state !== 'menu') return;
    this.setState('playing');
    this.sfx.init();
    this.sfx.setMuted(this.prefs.muted);
    const startEl = el('#start');
    startEl.classList.add('gone');
    setTimeout(() => (startEl.hidden = true), 500);
    // volta para um ângulo isométrico "limpo"
    const rig = this.rig;
    rig.yawTarget = Math.round((rig.yaw - Math.PI / 4) / (Math.PI / 2)) * (Math.PI / 2) + Math.PI / 4;
    navigator.wakeLock?.request?.('screen').catch(() => {});
    this.hud.peekMission();
    const hint = this.missions.current.hint;
    this.hud.toast(hint ?? t(this.input.touch ? 'hint.mineTouch' : 'hint.mineMouse'));
    this.perf.frames = this.perf.time = 0;
    this.perf.checked = false;
  }

  pause(): void {
    if (this.state !== 'playing') return; // morto não pausa: a tela de morte já espera
    this.setState('paused');
    this.input.reset();
    this.interaction.cancel();
    this.hud.setProgress(null);
    this.hud.setAim(null);
    this.bag.close();
    this.craftPanel.close();
    this.sfx.setPaused(true);
    this.pauseMenu.show(this.prefs);
    this.persist();
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.pauseMenu.hide();
    el('#help').hidden = true;
    this.sfx.setPaused(false);
    this.fixed.reset();
    this.last = performance.now();
    this.setState('playing');
  }

  private togglePause(): void {
    const help = el('#help');
    if (!help.hidden) {
      help.hidden = true;
      return;
    }
    if (this.bag.open) {
      this.bag.close();
      return;
    }
    if (this.craftPanel.open) {
      this.craftPanel.close();
      return;
    }
    if (this.state === 'playing') this.pause();
    else if (this.state === 'paused') this.resume();
  }

  private newGame(): void {
    this.resetting = true;
    clearSave(this.store);
    location.reload();
  }

  // ---------- eventos ----------

  private wireEvents(): void {
    const { events: e, sfx, particles, rig, hud, haptics, inventory, footprints, debris, missions, lander } = this;
    e.on('player:step', (p) => {
      sfx.play('step', 1, p);
      particles.dust(p.x, p.y, p.z, 2);
      this.footstep(false);
    });
    e.on('player:land', (p) => {
      sfx.play('land', 1, p);
      particles.dust(p.x, p.y, p.z, 10, 0.4);
      this.footstep(true);
      rig.shake(0.12);
    });
    e.on('player:jump', (p) => {
      sfx.play('jump', 1, p);
      particles.dust(p.x, p.y, p.z, 4);
    });
    e.on('debris:clink', (p) => sfx.play('clink', 1, p));
    e.on('debris:kick', (p) => sfx.play('kick', 1, p));
    e.on('mine:hit', (p) => {
      sfx.play('hit', 1, p);
      rig.shake(0.1);
      if (this.input.touch) haptics.play('tick');
    });
    const broke = (p: Vec3Like): void => {
      sfx.play('break', 1, p);
      rig.shake(0.18);
      haptics.play('tap');
    };
    e.on('block:broken', (b) => {
      broke({ x: b.x + 0.5, y: b.y + 0.5, z: b.z + 0.5 });
      this.blockFx.broke(b.x, b.y, b.z, b.id);
      this.hitStop = 0.045;
    });
    e.on('prop:broken', (p) => {
      broke(p);
      this.hitStop = 0.06;
    });
    e.on('block:placed', (b) => {
      sfx.play('place', 1, { x: b.x + 0.5, y: b.y + 0.5, z: b.z + 0.5 });
      this.blockFx.placed(b.x, b.y, b.z, b.id);
      rig.shake(0.05);
    });
    e.on('action:denied', ({ reason, item }) => {
      sfx.play('deny');
      if (reason === 'notBlock') hud.toast(t('deny.notBlock'), true);
      else if (reason === 'emptySlot') hud.toast(t('deny.emptySlot'), true);
      else if (reason === 'noItems' && item) hud.toast(t('deny.noItems', { item: ITEMS[item].name.toLowerCase() }), true);
    });
    e.on('item:collected', ({ item, amount }) => {
      const combo = this.popCombo;
      combo.n = this.time - combo.t < 0.7 ? Math.min(combo.n + 1, 10) : 0;
      combo.t = this.time;
      sfx.play('pop', 1 + combo.n * 0.06);
      hud.pickup(item, amount);
    });
    e.on('inventory:changed', ({ item }) => {
      hud.renderCounts(inventory, item);
      this.bag.render();
      this.craftPanel.render();
    });
    e.on('player:died', () => {
      this.bag.close();
      this.craftPanel.close();
    });
    e.on('equipment:changed', () => this.bag.render());
    e.on('inventory:full', ({ item }) => {
      if (this.time - this.fullWarnT < 2.5) return;
      this.fullWarnT = this.time;
      hud.ai(t('inventory.full', { item: ITEMS[item].name.toLowerCase() }), true);
      sfx.play('deny');
    });
    e.on('inventory:selected', ({ index }) => {
      hud.select(index, inventory);
      sfx.play('ui');
    });
    e.on('build:mode', ({ on }) => {
      hud.setBuildMode(on);
      sfx.play('ui');
    });
    e.on('world:blockChanged', ({ x, y, z }) => {
      footprints.clearAt(x, y, z);
      debris.disturb(x, y, z);
    });
    e.on('meteor:incoming', (m) => {
      const v = sfx.play('whoosh', 1, m);
      if (v) this.meteorVoices.set(m.id, v);
    });
    e.on('meteor:impact', ({ id, x, y, z, distance }) => {
      this.meteorVoices.delete(id);
      // dentro da base: um tremor grave que chega pelo casco
      const indoors = this.indoors.on;
      sfx.play('boom', indoors ? 0.6 : 1, { x, y, z });
      rig.shake(Math.max(0.15, 1.1 - distance / 30) * (indoors ? 0.35 : 1));
      if (distance < 30) haptics.play(indoors ? 'medium' : 'heavy');
    });
    e.on('mission:updated', () => hud.setMission(missions.view()));
    e.on('mission:started', ({ hint }) => {
      if (hint) hud.toast(hint);
      if (missions.current.kind === 'end') lander.setRepaired(true);
    });
    e.on('mission:completed', ({ title }) => {
      sfx.play('chime');
      hud.banner(t('mission.completed'), title);
      haptics.play('success');
    });
    e.on('mission:missing', ({ items }) => {
      const list = items.map((i) => `${i.missing} ${ITEMS[i.item].name.toLowerCase()}`).join(', ');
      hud.toast(t('mission.missing', { list }), true);
    });
  }

  private wireControls(): void {
    const { input, rig, interaction, inventory, sfx } = this;
    el('#btn-start').addEventListener('click', () => this.start());
    const reset = el<HTMLButtonElement>('#btn-reset');
    reset.addEventListener('click', () => {
      if (reset.dataset.confirm) this.newGame();
      else {
        reset.dataset.confirm = '1';
        reset.textContent = t('menu.confirmReset');
      }
    });
    const press = (sel: string, fn: () => void): void => {
      el(sel).addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        sfx.init();
        fn();
      });
    };
    press('#btn-jump', () => (input.jump = true));
    press('#btn-rot-l', () => rig.rotate(-1));
    press('#btn-rot-r', () => rig.rotate(1));
    press('#btn-build', () => interaction.setBuildMode(!interaction.buildMode));
    press('#btn-zoom-in', () => rig.zoom(1 / 1.2));
    press('#btn-zoom-out', () => rig.zoom(1.2));
    press('#btn-pause', () => this.togglePause());
    press('#btn-bag', () => {
      if (this.state === 'playing') this.bag.toggle();
    });
    input.onBag = () => {
      if (this.state === 'playing') this.bag.toggle();
    };
    this.bag.onToggle = (open) => {
      input.reset();
      interaction.cancel();
      this.hud.setProgress(null);
      this.hud.setAim(null);
      sfx.play('ui');
      this.events.emit('bag:toggled', { open });
    };
    el('#help').addEventListener('pointerdown', () => (el('#help').hidden = true));

    // base: botão de ação do lugar e tela da bancada
    this.baseHud.onUse = () => {
      sfx.init();
      this.base.use();
    };
    input.onUse = () => this.base.use();
    this.craftPanel.onToggle = (open) => {
      input.reset();
      interaction.cancel();
      this.hud.setProgress(null);
      this.hud.setAim(null);
      if (!open) sfx.play('ui');
    };

    // tela cheia: botão no canto e, no celular, ao tocar na tela (o navegador exige um gesto: toque solto)
    const fsBtn = el<HTMLButtonElement>('#btn-fullscreen');
    fsBtn.hidden = !fullscreenSupported;
    fsBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    fsBtn.addEventListener('click', () => {
      if (isFullscreen()) {
        this.prefs.fullscreen = false;
        void exitFullscreen();
      } else {
        this.prefs.fullscreen = true;
        void enterFullscreen(this.prefs.orientation === 'landscape');
      }
      this.changedPrefs();
    });
    onFullscreenChange((on) => {
      fsBtn.classList.toggle('on', on);
      fsBtn.setAttribute('aria-pressed', String(on));
      this.resize();
    });
    document.addEventListener(
      'pointerup',
      (e) => {
        if (!input.touch || e.pointerType === 'mouse' || !this.prefs.fullscreen || isFullscreen()) return;
        if (this.state !== 'menu' && this.state !== 'playing') return;
        if ((e.target as Element | null)?.closest?.('#pause, #btn-fullscreen')) return;
        void enterFullscreen(this.prefs.orientation === 'landscape');
      },
      true,
    );

    input.onRotate = (d) => rig.rotate(d);
    input.onZoom = (f) => rig.zoom(f);
    input.onHotbar = (i) => inventory.select(i);
    input.onBuildToggle = () => {
      if (this.state === 'playing') interaction.setBuildMode(!interaction.buildMode);
    };
    input.onTap = (x, y, button) => {
      if (this.state === 'playing') interaction.tap(x, y, button);
    };
    input.onPause = () => this.togglePause();
    this.hud.onSelect = (i) => inventory.select(i);
    addEventListener('keydown', (e) => {
      if (this.state === 'menu' && e.key === 'Enter') this.start();
    });
    addEventListener('visibilitychange', () => {
      if (!document.hidden) return;
      this.persist();
      this.pause();
    });
    addEventListener('pagehide', () => this.persist());
  }

  // ---------- dentro e fora da base ----------

  /**
   * Troca entre o mundo de fora e o interior da base (docs/adr/0006-interior-da-base-como-camada-isolada.md):
   * câmera, luz e fundo; mundo de fora travado; sem novos meteoros; som de dentro; HUD sem os marcadores.
   */
  private setIndoors(on: boolean): void {
    this.indoors.set(on);
    this.interaction.lockWorld(on);
    this.meteors.holdSpawns = on;
    this.sfx.setIndoors(on);
    document.body.classList.toggle('in-base', on);
    this.hud.setProgress(null);
    this.hud.setAim(null);
    this.events.emit('base:view', { inside: on });
  }

  // ---------- qualidade e tela ----------

  private defaultQuality(): QualityName {
    return this.input.touch ? 'medio' : 'alto';
  }

  private size(): [number, number] {
    return [this.container.clientWidth || innerWidth, this.container.clientHeight || innerHeight];
  }

  private applyQuality(name: QualityName): void {
    this.qualityName = name;
    const [w, h] = this.size();
    this.post.build(QUALITY[name], w, h);
    this.lights.extent = 0; // força atualizar o tamanho do mapa de sombras
  }

  private changedPrefs(): void {
    savePrefs(this.store, this.prefs);
    this.pauseMenu.render(this.prefs);
  }

  private resize(): void {
    const [w, h] = this.size();
    const aspect = w / h;
    const camera = this.camera;
    camera.aspect = aspect;
    camera.fov = aspect >= 1
      ? 30
      : Math.min(50, THREE.MathUtils.radToDeg(2 * Math.atan((Math.tan(THREE.MathUtils.degToRad(15)) / aspect) * 0.72)));
    camera.updateProjectionMatrix();
    this.post.resize(w, h);
    if (this.state === 'paused') this.post.render(this.time);
  }

  // ---------- salvar ----------

  private persist(): void {
    if (this.resetting || this.state === 'loading' || this.state === 'menu') return;
    const p = this.player.pos;
    writeSave(this.store, {
      seed: SEED,
      world: this.world.serialize(),
      inventory: this.inventory.serialize(),
      player: { x: p.x, y: p.y, z: p.z },
      missions: this.missions.serialize(),
      suit: this.survival.serialize(),
      loot: this.loot.serialize(),
      equipment: this.equipment.serialize(),
      base: this.base.serialize(),
    });
  }

  // ---------- pegadas ----------

  private footstep(both: boolean): void {
    const p = this.player.pos;
    const under = this.world.peekBlock(Math.floor(p.x), Math.round(p.y) - 1, Math.floor(p.z));
    if (under !== REGOLITH && under !== BASALT && under !== ICE) return;
    if (Math.abs(p.y - Math.round(p.y)) > 0.05) return;
    const a = this.player.facing;
    const rx = Math.cos(a), rz = -Math.sin(a);
    const sides = both ? [-1, 1] : [(this.stepSide = -this.stepSide)];
    for (const side of sides) {
      this.footprints.place(p.x + rx * side * 0.13, Math.round(p.y), p.z + rz * side * 0.13, a + Math.PI);
    }
  }

  // ---------- desempenho: reduz qualidade se ficar lento ----------

  private perfTick(dt: number): void {
    const perf = this.perf;
    if (perf.checked) return;
    perf.frames++;
    perf.time += dt;
    if (perf.time < 5) return;
    perf.checked = true;
    const fps = perf.frames / perf.time;
    if (fps < 32 && this.qualityName !== 'baixo' && !this.prefs.quality) {
      this.applyQuality(this.qualityName === 'alto' ? 'medio' : 'baixo');
      this.hud.toast(t('quality.lowered', { quality: t(`quality.${this.qualityName}`), fps: Math.round(fps) }));
      perf.frames = perf.time = 0;
      perf.checked = false;
    }
  }

  // ---------- laço principal ----------

  private readonly frame = (now: number): void => {
    requestAnimationFrame(this.frame);
    const realDt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    // na pausa o canvas mantém o último quadro
    if (this.state === 'loading' || this.state === 'paused') return;
    const state = this.state;
    const playing = state === 'playing';
    const dead = state === 'dead';
    const { input, rig, player, world, interaction, hud } = this;

    // escala de tempo: pausa de impacto e câmera lenta (juice)
    let dt = realDt;
    if (this.hitStop > 0) {
      this.hitStop -= realDt;
      dt = realDt * 0.05;
    } else if (this.slowMo.t > 0) {
      this.slowMo.t -= realDt;
      dt = realDt * this.slowMo.scale;
    }
    this.time += dt;
    const time = this.time;

    input.update();
    if (!playing) {
      input.moveX = input.moveY = 0;
      input.jump = false;
    }
    if (state === 'menu') {
      rig.yaw += dt * 0.06;
      rig.yawTarget = rig.yaw;
    }

    // simulação em passo fixo
    const steps = this.fixed.advance(dt);
    for (let i = 0; i < steps; i++) {
      if (playing && !this.base.busy) interaction.steer(input, FIXED_STEP);
      player.step(FIXED_STEP, input, rig);
      if (playing) this.survival.step(FIXED_STEP);
      this.debris.update(FIXED_STEP, player);
    }
    player.animate(dt, this.fixed.alpha);

    this.drops.update(dt, player);
    this.loot.update(dt, time, player, playing);
    this.blockFx.update(dt);
    this.footprints.update(dt);
    if (playing || dead) this.meteors.update(dt, time);
    if (playing) this.missions.update(dt);
    this.waypoint.update(time);
    this.lootMarker.update(time);
    this.lander.update(time);
    if (playing) this.crafting.update(dt);
    this.base.update(dt);
    for (const [id, v] of this.meteorVoices) {
      const h = this.meteors.headOf(id);
      if (h) v.at(h.x, h.y, h.z);
      else this.meteorVoices.delete(id);
    }

    if (this.base.indoorView !== this.indoors.on) this.setIndoors(this.base.indoorView);

    const rp = player.model.root.position;
    this.focus.set(rp.x, rp.y + 0.8, rp.z);
    rig.update(dt, this.focus);
    this.sfx.setListener(player.model.root.position, rig.forward());
    this.baseModel.update(dt, time, this.camera.position);

    world.radius = THREE.MathUtils.clamp(Math.ceil((1.05 * rig.distTarget + 10) / 16), 2, 5);
    world.update(player.pos.x, player.pos.z, 2, dt);

    if (playing && !this.base.busy) {
      interaction.update(dt, input);
      hud.setProgress(interaction.progress);
      hud.setAim(interaction.aim);
    } else {
      hud.setAim(null);
      if (playing) hud.setProgress(null);
    }
    this.particles.update(dt);
    this.motes.update(dt, rig.target, time);
    this.director.update(realDt, time);

    const extent = Math.max(14, rig.dist * 0.8);
    if (Math.abs(this.lights.extent - extent) > 2) this.lights.setShadowSize(QUALITY[this.qualityName].shadow, extent);
    this.lights.follow(rig.target);
    // dentro da base não há neblina (desligar recompilaria os shaders: só fica longe)
    this.fog.near = this.indoors.on ? 1e4 : rig.dist * 1.15;
    this.fog.far = this.indoors.on ? 2e4 : rig.dist * 2.1;

    // marcadores: objetivo da missão e itens caídos
    const tp = playing && !this.indoors.on ? this.missions.target() : null;
    this.waypoint.group.visible = !!tp;
    if (tp) this.waypoint.group.position.copy(tp);
    hud.setWaypoint(tp);
    const lp = playing && !this.indoors.on ? this.loot.latest() : null;
    this.lootMarker.group.visible = !!lp;
    if (lp) this.lootMarker.group.position.copy(lp);
    hud.setLootMarker(lp);

    this.hudTimer -= realDt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.08;
      hud.updateCompass(rig.heading());
      hud.updateCoords(player.pos, this.baseY);
    }
    if (playing || dead) hud.drawWaypoint(this.camera, this.renderer.domElement.getBoundingClientRect(), player.pos);
    if (playing) this.perfTick(realDt);
    this.post.render(time);
  };
}
