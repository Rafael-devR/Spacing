// Spacing — base jogável: astronauta na Lua, mundo em chunks de blocos, mineração e construção.
import * as THREE from 'three';
import { World } from './world.js';
import { Player } from './player.js';
import { IsoRig } from './rig.js';
import { createMaterials, createBackdrop, createLights, Post, QUALITY, Particles, createMotes, renderIcon, U } from './graphics.js';
import { PropFactory, createLander, createWaypoint } from './models.js';
import { Debris } from './debris.js';
import { Footprints } from './footprints.js';
import { Meteors } from './meteors.js';
import { Missions } from './missions.js';
import { REGOLITH, BASALT, ICE } from './blocks.js';
import { Input } from './input.js';
import { Interaction } from './interaction.js';
import { UI } from './ui.js';
import { Sfx } from './audio.js';
import { ITEM_ORDER } from './blocks.js';
import { LANDER } from './terrain.js';

const SAVE_KEY = 'spacing.save.v1';
const PREF_KEY = 'spacing.prefs.v1';
const SEED = 20261111;
const $ = (s) => document.querySelector(s);

const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem armazenamento */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* sem armazenamento */ } },
};

// ---------- renderizador e cena ----------
const container = $('#game');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
} catch (err) {
  $('#loading').textContent = 'Seu navegador não conseguiu iniciar o WebGL. Tente outro navegador ou ative a aceleração de hardware.';
  throw err;
}
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x000000, 40, 80); // cor vem do gradiente do céu (shader)
const camera = new THREE.PerspectiveCamera(30, 1, 1, 400);
scene.add(createBackdrop());
const lights = createLights(scene);
const materials = createMaterials();
const propFactory = new PropFactory(materials.props);

const save = store.get(SAVE_KEY);
const prefs = store.get(PREF_KEY) || {};
const world = new World(scene, SEED, materials.terrain, propFactory);
world.load(save?.world);
const inventory = Object.fromEntries(ITEM_ORDER.map((k) => [k, save?.inventory?.[k] || 0]));

const ui = new UI(inventory);
const sfx = new Sfx();
sfx.muted = !!prefs.muted;
const player = new Player(scene, world);
const rig = new IsoRig(camera);
const particles = new Particles(scene);
const motes = createMotes(scene);
const input = new Input(renderer.domElement, ui);
const debris = new Debris(scene, world, materials.debris);
const footprints = new Footprints(scene);
const interaction = new Interaction({
  world, player, camera, rig, particles, sfx, ui, inventory, scene, materials, debris, canvas: renderer.domElement,
});
const meteors = new Meteors({ scene, world, debris, particles, sfx, rig, player });
const waypoint = createWaypoint();
scene.add(waypoint.group);
U.uMistY.value = Math.floor(world.terrain.spawnH) - 6;
world.onBlockChange = (x, y, z) => {
  footprints.clearAt(x, y, z);
  debris.disturb(x, y, z);
};
document.body.classList.toggle('touch', input.touch);

// ---------- qualidade ----------
const post = new Post(renderer, scene, camera);
let qualityName = prefs.quality || (input.touch ? 'medio' : 'alto');
const QUALITY_LABEL = { baixo: 'Baixa', medio: 'Média', alto: 'Alta' };
function size() { return [container.clientWidth || innerWidth, container.clientHeight || innerHeight]; }
function applyQuality(name) {
  qualityName = name;
  const [w, h] = size();
  post.build(QUALITY[name], w, h);
  lights.extent = 0; // força atualizar o tamanho do mapa de sombras
  $('#btn-quality .lbl').textContent = QUALITY_LABEL[name];
}
function resize() {
  const [w, h] = size();
  const aspect = w / h;
  camera.aspect = aspect;
  camera.fov = aspect >= 1 ? 30 : Math.min(50, THREE.MathUtils.radToDeg(2 * Math.atan((Math.tan(THREE.MathUtils.degToRad(15)) / aspect) * 0.72)));
  camera.updateProjectionMatrix();
  post.resize(w, h);
}
applyQuality(qualityName);
resize();
addEventListener('resize', resize);
new ResizeObserver(resize).observe(container);

// ---------- mundo inicial ----------
const lander = createLander();
scene.add(lander);
const missions = new Missions({ ui, sfx, inventory, player, world, meteors, waypoint, lander }, save?.missions);
if (missions.current.kind === 'end') lander.userData.setRepaired(true);
interaction.onCollect = (item, n) => missions.onCollect(item, n);
interaction.onPropBroken = (type) => missions.onPropBroken(type);
let started = false;
let ready = false;

function boot() {
  world.radius = 3;
  world.update(0, 0, 999, 0);
  lander.position.set(LANDER.x + 0.5, world.topY(LANDER.x, LANDER.z) + 1, LANDER.z + 0.5);
  if (save?.player) {
    player.pos.set(save.player.x, save.player.y + 0.05, save.player.z);
    // garante que não nasce dentro de um bloco
    while (player.collides(player.pos.x, player.pos.y, player.pos.z) && player.pos.y < 60) player.pos.y += 1;
  } else player.spawn(1.5, 1.5);
  player.update(0, input, rig);
  rig.snap(new THREE.Vector3(player.pos.x, player.pos.y + 0.8, player.pos.z));

  const icons = {};
  for (const k of ITEM_ORDER) icons[k] = renderIcon(renderer, interaction.itemObject(k));
  ui.buildHotbar(icons);
  ready = true;
  $('#loading').hidden = true;
  $('#btn-start').disabled = false;
  $('#btn-start').textContent = save ? 'Continuar missão' : 'Começar missão';
  $('#btn-reset').hidden = !save;
}

// ---------- botões ----------
function start() {
  if (!ready || started) return;
  started = true;
  sfx.init();
  sfx.setMuted(sfx.muted);
  $('#start').classList.add('gone');
  setTimeout(() => ($('#start').hidden = true), 500);
  // volta para um ângulo isométrico "limpo"
  rig.yawTarget = Math.round((rig.yaw - Math.PI / 4) / (Math.PI / 2)) * (Math.PI / 2) + Math.PI / 4;
  navigator.wakeLock?.request?.('screen').catch(() => {});
  const hint = missions.current.hint;
  ui.toast(hint || (input.touch ? 'Segure num bloco para minerar' : 'Segure o clique num bloco para minerar'));
  perf.reset();
}
$('#btn-start').addEventListener('click', start);
$('#btn-reset').addEventListener('click', () => {
  const b = $('#btn-reset');
  if (b.dataset.confirm) {
    store.del(SAVE_KEY);
    location.reload();
  } else {
    b.dataset.confirm = '1';
    b.textContent = 'Toque de novo para apagar';
  }
});
const press = (sel, fn) => $(sel).addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); sfx.init(); fn(); });
press('#btn-jump', () => (input.jump = true));
press('#btn-rot-l', () => rig.rotate(-1));
press('#btn-rot-r', () => rig.rotate(1));
press('#btn-build', () => { interaction.setBuildMode(!interaction.buildMode); sfx.play('ui'); });
press('#btn-zoom-in', () => rig.zoom(1 / 1.2));
press('#btn-zoom-out', () => rig.zoom(1.2));
press('#btn-quality', () => {
  const order = ['baixo', 'medio', 'alto'];
  applyQuality(order[(order.indexOf(qualityName) + 1) % 3]);
  prefs.quality = qualityName;
  store.set(PREF_KEY, prefs);
  ui.toast('Gráficos: ' + QUALITY_LABEL[qualityName]);
});
press('#btn-sound', () => {
  sfx.setMuted(!sfx.muted);
  prefs.muted = sfx.muted;
  store.set(PREF_KEY, prefs);
  $('#btn-sound').setAttribute('aria-pressed', !sfx.muted);
  $('#btn-sound .lbl').textContent = sfx.muted ? 'Mudo' : 'Som';
});
$('#btn-sound').setAttribute('aria-pressed', !sfx.muted);
$('#btn-sound .lbl').textContent = sfx.muted ? 'Mudo' : 'Som';
press('#btn-help', () => { $('#help').hidden = !$('#help').hidden; });
$('#help').addEventListener('pointerdown', () => ($('#help').hidden = true));
input.onRotate = (d) => rig.rotate(d);
input.onZoom = (f) => rig.zoom(f);
input.onHotbar = (i) => { ui.select(i); sfx.play('ui'); };
input.onBuildToggle = () => interaction.setBuildMode(!interaction.buildMode);
input.onTap = (x, y, button) => { if (started) interaction.tap(x, y, button); };
ui.onSelect = () => sfx.play('ui');
addEventListener('keydown', (e) => { if (!started && e.key === 'Enter') start(); });

// ---------- salvar ----------
function persist() {
  if (!ready) return;
  store.set(SAVE_KEY, {
    world: world.serialize(),
    inventory,
    player: { x: player.pos.x, y: player.pos.y, z: player.pos.z },
    missions: missions.serialize(),
  });
}
setInterval(() => { if (started) persist(); }, 5000);
addEventListener('visibilitychange', () => { if (document.hidden && started) persist(); });
addEventListener('pagehide', () => { if (started) persist(); });

// ---------- desempenho: reduz qualidade se ficar lento ----------
const perf = {
  frames: 0, time: 0, checked: false,
  reset() { this.frames = 0; this.time = 0; this.checked = false; },
  tick(dt) {
    if (this.checked || !started) return;
    this.frames++;
    this.time += dt;
    if (this.time < 5) return;
    this.checked = true;
    const fps = this.frames / this.time;
    if (fps < 32 && qualityName !== 'baixo' && !prefs.quality) {
      applyQuality(qualityName === 'alto' ? 'medio' : 'baixo');
      ui.toast(`Gráficos ajustados para ${QUALITY_LABEL[qualityName]} (${Math.round(fps)} FPS)`);
      this.reset();
    }
  },
};

// ---------- pegadas ----------
let stepSide = 1;
function footstep(both) {
  const p = player.pos;
  const under = world.peekBlock(Math.floor(p.x), Math.round(p.y) - 1, Math.floor(p.z));
  if (under !== REGOLITH && under !== BASALT && under !== ICE) return;
  if (Math.abs(p.y - Math.round(p.y)) > 0.05) return;
  const a = player.facing;
  const rx = Math.cos(a), rz = -Math.sin(a);
  for (const side of both ? [-1, 1] : [(stepSide = -stepSide)]) {
    footprints.place(p.x + rx * side * 0.13, Math.round(p.y), p.z + rz * side * 0.13, a + Math.PI);
  }
}

// ---------- laço principal ----------
const focus = new THREE.Vector3();
let last = performance.now();
let t = 0;
let hudT = 0;
const base = world.terrain.spawnH;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  t += dt;
  if (!ready) return;

  input.update();
  if (started) interaction.steer(input, dt);
  else {
    input.moveX = input.moveY = 0;
    input.jump = false;
    rig.yaw += dt * 0.06;
    rig.yawTarget = rig.yaw;
  }
  player.update(dt, input, rig);
  for (const e of player.events) {
    const p = player.pos;
    if (e === 'step') { sfx.play('step'); particles.dust(p.x, p.y, p.z, 2); footstep(false); }
    else if (e === 'land') { sfx.play('land'); particles.dust(p.x, p.y, p.z, 10, 0.4); footstep(true); rig.shake(0.12); }
    else if (e === 'jump') { sfx.play('jump'); particles.dust(p.x, p.y, p.z, 4); }
  }
  player.events.length = 0;

  debris.update(dt, player);
  for (const e of debris.events) sfx.play(e.type);
  debris.events.length = 0;
  footprints.update(dt);
  if (started) {
    meteors.update(dt, t);
    missions.update(dt);
  }
  waypoint.update(t);
  lander.userData.update(t);

  focus.set(player.pos.x, player.pos.y + 0.8, player.pos.z);
  rig.update(dt, focus);

  world.radius = THREE.MathUtils.clamp(Math.ceil((1.05 * rig.distTarget + 10) / 16), 2, 5);
  world.update(player.pos.x, player.pos.z, 2, dt);

  if (started) interaction.update(dt, input);
  particles.update(dt);
  motes.update(dt, rig.target, t);

  const extent = Math.max(14, rig.dist * 0.8);
  if (Math.abs((lights.extent || 0) - extent) > 2) lights.setShadowSize(QUALITY[qualityName].shadow, extent);
  lights.follow(rig.target);
  scene.fog.near = rig.dist * 1.15;
  scene.fog.far = rig.dist * 2.1;

  hudT -= dt;
  if (hudT <= 0) {
    hudT = 0.08;
    ui.updateCompass(rig.heading());
    ui.updateCoords(player.pos, base);
  }
  if (started) ui.drawWaypoint(camera, renderer.domElement.getBoundingClientRect(), player.pos);
  perf.tick(dt);
  post.render(t);
}

$('#loading').textContent = 'Gerando a superfície lunar…';
requestAnimationFrame(() => setTimeout(() => {
  try { boot(); } catch (err) { $('#loading').textContent = 'Erro ao iniciar: ' + err.message; throw err; }
}, 30));
requestAnimationFrame(frame);
