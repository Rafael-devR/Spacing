// O jogo: cria os sistemas, liga tudo pelo barramento de eventos e roda o laço principal.
// Estados: carregando → menu → jogando ⇄ pausa.
import * as THREE from 'three';
import { Sfx } from '../audio/Sfx';
import { Haptics } from '../core/haptics';
import { Input } from '../core/Input';
import { SHAKE_SCALE, loadPrefs, savePrefs, type Prefs } from '../core/prefs';
import { clearSave, defaultStore, loadSave, writeSave, type SaveData } from '../core/save';
import { BASALT, ICE, REGOLITH } from '../data/blocks';
import { ITEMS, ITEM_ORDER, type ItemId } from '../data/items';
import { Debris } from '../entities/Debris';
import { ItemDrops } from '../entities/ItemDrops';
import { Meteors } from '../entities/Meteors';
import { Player } from '../entities/Player';
import { t } from '../i18n';
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
import { el, maybeEl } from '../ui/dom';
import { Hud } from '../ui/Hud';
import { PauseMenu } from '../ui/PauseMenu';
import { LANDER } from '../world/terrain';
import { World } from '../world/World';
import { AUTOSAVE_MS, FIXED_STEP, MAX_STEPS_PER_FRAME, SEED, VERSION } from './config';
import { createBus, type GameBus, type GameState } from './events';
import { FixedStep } from './FixedStep';

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
  private readonly lander: Lander;

  private readonly hud = new Hud();
  private readonly pauseMenu: PauseMenu;
  private readonly sfx = new Sfx();
  private readonly haptics = new Haptics();

  private readonly fixed = new FixedStep(FIXED_STEP, MAX_STEPS_PER_FRAME);
  private readonly focus = new THREE.Vector3();
  private last = performance.now();
  private time = 0;
  private hudTimer = 0;
  private stepSide = 1;
  /** apagando o progresso: não salvar mais nada */
  private resetting = false;
  private readonly perf = { frames: 0, time: 0, checked: false };
  private readonly baseY: number;

  constructor(
    private readonly container: HTMLElement,
    private readonly renderer: THREE.WebGLRenderer,
  ) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
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
    this.inventory = new Inventory(events, this.save?.inventory);
    this.player = new Player(scene, this.world, events);
    this.rig = new IsoRig(this.camera);
    this.particles = new Particles(scene);
    this.motes = createMotes(scene);
    this.input = new Input(renderer.domElement, { base: maybeEl('#joystick'), knob: maybeEl('#knob') });
    this.debris = new Debris(scene, this.world, materials.debris, events);
    this.itemModels = new ItemModels(materials, propFactory);
    this.drops = new ItemDrops(scene, this.itemModels, this.inventory);
    this.footprints = new Footprints(scene);
    this.interaction = new Interaction({
      scene, camera: this.camera, canvas: renderer.domElement, world: this.world, player: this.player, rig: this.rig,
      particles: this.particles, debris: this.debris, drops: this.drops, inventory: this.inventory, events,
    });
    this.meteors = new Meteors({ scene, world: this.world, debris: this.debris, particles: this.particles, player: this.player, events });
    this.waypoint = createWaypoint();
    scene.add(this.waypoint.group);
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

    this.sfx.muted = this.prefs.muted;
    this.haptics.enabled = this.prefs.vibration;
    this.rig.shakeScale = SHAKE_SCALE[this.prefs.shake];
    document.body.classList.toggle('touch', this.input.touch);

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
        onControls: () => (el('#help').hidden = false),
        onNewGame: () => this.newGame(),
      },
      VERSION,
    );

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
    const saved = this.save?.player;
    if (saved) {
      player.pos.set(saved.x, saved.y + 0.05, saved.z);
      // garante que não nasce dentro de um bloco
      while (player.collides(player.pos.x, player.pos.y, player.pos.z) && player.pos.y < 60) player.pos.y += 1;
      player.prevPos.copy(player.pos);
    } else player.spawn(1.5, 1.5);
    player.animate(0);
    this.rig.snap(new THREE.Vector3(player.pos.x, player.pos.y + 0.8, player.pos.z));

    const icons = {} as Record<ItemId, string>;
    for (const k of ITEM_ORDER) icons[k] = renderIcon(this.renderer, this.itemModels.create(k));
    this.hud.buildHotbar(icons, this.inventory);
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
    const hint = this.missions.current.hint;
    this.hud.toast(hint ?? t(this.input.touch ? 'hint.mineTouch' : 'hint.mineMouse'));
    this.perf.frames = this.perf.time = 0;
    this.perf.checked = false;
  }

  pause(): void {
    if (this.state !== 'playing') return;
    this.setState('paused');
    this.input.reset();
    this.interaction.cancel();
    this.hud.setProgress(null);
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
      sfx.play('step');
      particles.dust(p.x, p.y, p.z, 2);
      this.footstep(false);
    });
    e.on('player:land', (p) => {
      sfx.play('land');
      particles.dust(p.x, p.y, p.z, 10, 0.4);
      this.footstep(true);
      rig.shake(0.12);
    });
    e.on('player:jump', (p) => {
      sfx.play('jump');
      particles.dust(p.x, p.y, p.z, 4);
    });
    e.on('debris:clink', () => sfx.play('clink'));
    e.on('debris:kick', () => sfx.play('kick'));
    e.on('mine:hit', () => {
      sfx.play('hit');
      rig.shake(0.1);
    });
    const broke = (): void => {
      sfx.play('break');
      rig.shake(0.18);
      haptics.play('tap');
    };
    e.on('block:broken', broke);
    e.on('prop:broken', broke);
    e.on('block:placed', () => sfx.play('place'));
    e.on('action:denied', ({ reason, item }) => {
      sfx.play('deny');
      if (reason === 'notBlock') hud.toast(t('deny.notBlock'), true);
      else if (reason === 'noItems' && item) hud.toast(t('deny.noItems', { item: ITEMS[item].name.toLowerCase() }), true);
    });
    e.on('item:collected', ({ item, amount }) => {
      sfx.play('pop');
      hud.pickup(item, amount);
    });
    e.on('inventory:changed', ({ item }) => hud.renderCounts(inventory, item));
    e.on('inventory:selected', ({ index }) => {
      hud.select(index);
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
    e.on('meteor:incoming', () => sfx.play('whoosh'));
    e.on('meteor:impact', ({ distance }) => {
      sfx.play('boom');
      rig.shake(Math.max(0.15, 1.1 - distance / 30));
      if (distance < 30) haptics.play('heavy');
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
    el('#help').addEventListener('pointerdown', () => (el('#help').hidden = true));

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
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    // na pausa o canvas mantém o último quadro
    if (this.state === 'loading' || this.state === 'paused') return;
    this.time += dt;
    const time = this.time;
    const playing = this.state === 'playing';
    const { input, rig, player, world, interaction, hud } = this;

    input.update();
    if (!playing) {
      input.moveX = input.moveY = 0;
      input.jump = false;
      rig.yaw += dt * 0.06;
      rig.yawTarget = rig.yaw;
    }

    // simulação em passo fixo
    const steps = this.fixed.advance(dt);
    for (let i = 0; i < steps; i++) {
      if (playing) interaction.steer(input, FIXED_STEP);
      player.step(FIXED_STEP, input, rig);
      this.debris.update(FIXED_STEP, player);
    }
    player.animate(dt, this.fixed.alpha);

    this.drops.update(dt, player);
    this.footprints.update(dt);
    if (playing) {
      this.meteors.update(dt, time);
      this.missions.update(dt);
    }
    this.waypoint.update(time);
    this.lander.update(time);

    const rp = player.model.root.position;
    this.focus.set(rp.x, rp.y + 0.8, rp.z);
    rig.update(dt, this.focus);

    world.radius = THREE.MathUtils.clamp(Math.ceil((1.05 * rig.distTarget + 10) / 16), 2, 5);
    world.update(player.pos.x, player.pos.z, 2, dt);

    if (playing) {
      interaction.update(dt, input);
      hud.setProgress(interaction.progress);
    }
    this.particles.update(dt);
    this.motes.update(dt, rig.target, time);

    const extent = Math.max(14, rig.dist * 0.8);
    if (Math.abs(this.lights.extent - extent) > 2) this.lights.setShadowSize(QUALITY[this.qualityName].shadow, extent);
    this.lights.follow(rig.target);
    this.fog.near = rig.dist * 1.15;
    this.fog.far = rig.dist * 2.1;

    // marcador de objetivo
    const tp = playing ? this.missions.target() : null;
    this.waypoint.group.visible = !!tp;
    if (tp) this.waypoint.group.position.copy(tp);
    hud.setWaypoint(tp);

    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.08;
      hud.updateCompass(rig.heading());
      hud.updateCoords(player.pos, this.baseY);
    }
    if (playing) {
      hud.drawWaypoint(this.camera, this.renderer.domElement.getBoundingClientRect(), player.pos);
      this.perfTick(dt);
    }
    this.post.render(time);
  };
}
