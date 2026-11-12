// O teste de desempenho: conduz os cenários, as comparações (efeitos, resolução) e o aquecimento, e mede cada quadro
// (docs/design/BENCHMARK.md). Não conhece o DOM: quem mostra progresso e resultado é bench/ui.ts, e quem liga tudo
// (estado do jogo, salvamento, recarregar no fim) é o Game. Fora do teste nada daqui roda: o Game guarda `probe` nulo.
import * as THREE from 'three';
import {
  BENCH_EFFECTS, BENCH_SCENARIOS, BENCH_VERSION, DETECT_SECONDS, MATRIX_PREROLL, MATRIX_SCENARIO, RESOLUTION_SCALES, RESOLUTION_SCENARIO, THERMAL_MINUTES,
  THERMAL_MINUTE_SECONDS, THERMAL_SCENARIO, type BenchMode, type BenchScenario, type EffectId, plannedSeconds,
} from '../data/bench';
import type { BaseDirector } from '../app/BaseDirector';
import type { MapDirector } from '../app/MapDirector';
import type { Debris } from '../entities/Debris';
import type { ItemDrops } from '../entities/ItemDrops';
import type { LootPiles } from '../entities/LootPiles';
import type { Meteors } from '../entities/Meteors';
import type { Player } from '../entities/Player';
import type { IsoRig } from '../render/IsoRig';
import type { Particles } from '../render/particles';
import type { Post, QualityName, QualityPreset } from '../render/post';
import type { Interaction } from '../systems/Interaction';
import type { World } from '../world/World';
import { ScenarioDriver, originOf } from './actions';
import { CreationCounter } from './counters';
import { EffectToggles } from './effects';
import { measureRefresh, openBattery, readEnv, readJsHeap, type BatteryInfo, type EnvInfo } from './env';
import { GpuSync, GpuTimer } from './gpu';
import { Observers, summarizeLong } from './observers';
import { Probe, Recorder, Running, SUB, Timer } from './probe';
import {
  SCENE_KEYS, effectResult, findings, latency, resolutionResult, seriesOf, stepStat, summarize, thermalResult,
  type BenchReport, type EffectResult, type ResolutionPoint, type SceneKey, type SceneStats, type ScenarioResult,
  type SeriesData, type StepStat, type ThermalMinute,
} from './report';
import { bucketSeries, round2, type RefreshDetection } from './stats';

export interface RunnerDeps {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
  post: Post;
  world: World;
  player: Player;
  rig: IsoRig;
  interaction: Interaction;
  meteors: Meteors;
  debris: Debris;
  particles: Particles;
  drops: ItemDrops;
  loot: LootPiles;
  base: BaseDirector;
  map: MapDirector;
  /** materiais com brilho de cristal */
  glowMaterials: THREE.Material[];
  quality(): { name: QualityName; auto: boolean; preset: QualityPreset };
  muted(): boolean;
  /** tamanho do salvamento no aparelho, em bytes (null se não dá para saber) */
  saveBytes(): number | null;
  version: string;
}

export type RunnerState = 'idle' | 'running' | 'done' | 'cancelled';

/** o que a tela de acompanhamento mostra */
export interface BenchProgress {
  /** 0..1 do teste inteiro */
  fraction: number;
  /** o que está rodando: id do cenário, efeito, escala ou minuto */
  kind: 'scenario' | 'effect' | 'resolution' | 'thermal';
  id: string;
  /** detalhe: "ligado"/"desligado", escala, número do minuto */
  detail: string;
  /** segundos que faltam, aproximadamente */
  remaining: number;
  /** FPS dos últimos instantes */
  fps: number;
  /** passo atual e total */
  step: number;
  steps: number;
  warming: boolean;
}

type Section = 'scenarios' | 'effects' | 'resolution' | 'thermal';

export interface Step {
  section: Section;
  scenario: BenchScenario;
  seconds: number;
  warmup: number;
  /** de qual região o passo parte (número do ponto de partida) */
  origin: number;
  kind: BenchProgress['kind'];
  id: string;
  detail: string;
  effect?: { id: EffectId; on: boolean } | 'baseline';
  scale?: number;
  minute?: number;
  /** espera a GPU terminar o render (mede o custo sem o vsync mascarar) */
  sync?: boolean;
}

/** Descarta uma fração de segundo mínima para que o teste encurtado (usado nos testes automáticos) ainda tenha quadros. */
const MIN_MEASURE = 0.35;
const MIN_WARMUP = 0.2;

/** passos do teste, na ordem (puro: testado sem WebGL) */
export function buildSteps(mode: BenchMode, scale = 1): Step[] {
  const steps: Step[] = [];
  const sec = (s: number): number => Math.max(MIN_MEASURE, s * scale);
  const warm = (w: number): number => (w <= 0 ? 0 : Math.max(MIN_WARMUP, w * scale));
  BENCH_SCENARIOS.forEach((sc, i) => {
    const s = sc.seconds[mode];
    if (s === undefined) return;
    steps.push({ section: 'scenarios', scenario: sc, seconds: sec(s), warmup: warm(sc.warmup ?? 2), origin: i, kind: 'scenario', id: sc.id, detail: '' });
  });
  if (mode !== 'full') return steps;
  const idle = BENCH_SCENARIOS.findIndex((s) => s.id === 'idle');
  const m = MATRIX_SCENARIO;
  const mStep = (id: string, detail: string, effect: Step['effect'], first = false): Step => ({
    section: 'effects', scenario: m, seconds: sec(m.seconds.full ?? 2), warmup: warm((m.warmup ?? 1) + (first ? MATRIX_PREROLL : 0)),
    origin: idle, kind: 'effect', id, detail, effect, sync: true,
  });
  steps.push(mStep('baseline', '', 'baseline', true));
  for (const e of BENCH_EFFECTS) {
    steps.push(mStep(e.id, 'on', { id: e.id, on: true }));
    steps.push(mStep(e.id, 'off', { id: e.id, on: false }));
  }
  const base = BENCH_SCENARIOS.length;
  RESOLUTION_SCALES.forEach((k, i) => {
    const r = RESOLUTION_SCENARIO;
    steps.push({
      section: 'resolution', scenario: r, seconds: sec(r.seconds.full ?? 4), warmup: warm(r.warmup ?? 1), origin: base + i, kind: 'resolution',
      id: String(k), detail: String(k), scale: k, sync: true,
    });
  });
  for (let i = 0; i < THERMAL_MINUTES; i++) {
    steps.push({
      section: 'thermal', scenario: THERMAL_SCENARIO, seconds: sec(THERMAL_MINUTE_SECONDS), warmup: 0, origin: base + RESOLUTION_SCALES.length + i,
      kind: 'thermal', id: 'thermal', detail: String(i + 1), minute: i + 1,
    });
  }
  return steps;
}

/** quanto dura (s) um passo, com aquecimento */
const stepSeconds = (s: Step): number => s.seconds + s.warmup;

interface Current {
  step: Step;
  rec: Recorder;
  gauges: Record<SceneKey, Running>;
  gen: Timer;
  mesh: Timer;
  remesh: Timer;
  creations: CreationCounter;
  /** instante (ms desde o começo do teste) em que a parte medida começou e terminou */
  from: number;
  to: number;
  elapsed: number;
  measuring: boolean;
  frames: number;
}

const newGauges = (): Record<SceneKey, Running> => Object.fromEntries(SCENE_KEYS.map((k) => [k, new Running()])) as Record<SceneKey, Running>;

function sceneStats(g: Record<SceneKey, Running>): SceneStats {
  return Object.fromEntries(SCENE_KEYS.map((k) => [k, { avg: round2(g[k].value.avg), max: round2(g[k].value.max) }])) as SceneStats;
}

export class BenchRunner {
  state: RunnerState = 'idle';
  /** a sonda do jogo: o Game a lê a cada quadro enquanto o teste roda (nula fora dele) */
  readonly probe = new Probe();
  onProgress: ((p: BenchProgress) => void) | null = null;
  onFinish: ((r: BenchReport) => void) | null = null;

  private readonly steps: Step[];
  private readonly total: number;
  private index = -1;
  private cur: Current | null = null;
  private readonly driver: ScenarioDriver;
  private readonly effects: EffectToggles;
  private readonly observers = new Observers();
  private readonly gpu: GpuTimer | null;
  private readonly sync: GpuSync;
  private env: EnvInfo | null = null;
  private refresh: RefreshDetection | null = null;
  private battery: (() => BatteryInfo) | null = null;
  private batteryStart: BatteryInfo | null = null;
  private t0 = 0;
  private doneSeconds = 0;
  private rawMs = 0;
  private hooked: unknown = null;
  private unhook: (() => void) | null = null;
  private effectsDirty = false;
  private uiT = 0;
  private objT = 0;
  private recent: number[] = [];
  private heapStart: number | null = null;
  private abort = { aborted: false };

  // resultados parciais
  private readonly scenarios: ScenarioResult[] = [];
  private readonly overall = new Recorder();
  private readonly overallChunks = { gen: new Timer(), mesh: new Timer(), remesh: new Timer() };
  private effectStats = new Map<string, StepStat>();
  private effectActive = new Map<EffectId, boolean>();
  private resolutionPoints: ResolutionPoint[] = [];
  private thermalMinutes: ThermalMinute[] = [];
  private thermalSeries: { avg: number[]; max: number[] } = { avg: [], max: [] };

  constructor(
    private readonly d: RunnerDeps,
    readonly mode: BenchMode,
    /** 1 = tempos reais; menos = abreviado (só os testes automáticos) */
    readonly scale = 1,
  ) {
    this.steps = buildSteps(mode, scale);
    this.total = this.steps.reduce((a, s) => a + stepSeconds(s), 0);
    this.driver = new ScenarioDriver(d);
    this.effects = new EffectToggles({ renderer: d.renderer, scene: d.scene, camera: d.camera, post: d.post, particles: d.particles, glowMaterials: d.glowMaterials });
    this.gpu = GpuTimer.create(d.renderer.getContext());
    this.sync = new GpuSync(d.renderer.getContext());
  }

  get running(): boolean {
    return this.state === 'running';
  }

  get finished(): boolean {
    return this.state === 'done';
  }

  /** duração planejada do teste, em segundos (sem a detecção da taxa de atualização) */
  get plannedSeconds(): number {
    return plannedSeconds(this.mode, this.scale);
  }

  // ---------- antes de começar ----------

  /** Mede a taxa da tela e lê o aparelho. Chame com o jogo parado. Devolve false se foi cancelado (aba escondida). */
  async detect(measure: () => Promise<RefreshDetection | null> = () => measureRefresh(DETECT_SECONDS, this.abort)): Promise<boolean> {
    this.abort.aborted = false;
    const refresh = await measure();
    if (!refresh || this.abort.aborted) return false;
    this.refresh = refresh;
    this.env = await readEnv(this.d.renderer.getContext());
    this.battery = await openBattery();
    return true;
  }

  get detected(): RefreshDetection | null {
    return this.refresh;
  }

  /** Liga a medição e começa o primeiro passo. Só depois de `detect()`. */
  start(): void {
    if (!this.refresh || !this.env) throw new Error('teste de desempenho: detectar a tela antes de começar');
    const { d } = this;
    this.state = 'running';
    this.t0 = performance.now();
    this.heapStart = readJsHeap()?.used ?? null;
    this.batteryStart = this.battery?.() ?? null;
    // o renderizador soma as chamadas de todas as passadas do quadro só se não zerar sozinho
    d.renderer.info.autoReset = false;
    d.meteors.holdSpawns = true; // sem meteoros sorteados: só os do roteiro
    d.world.perf = {
      onGenerate: (ms) => {
        this.cur?.gen.add(ms);
        this.probe.genMs += ms;
      },
      onMesh: (ms, edit) => {
        (edit ? this.cur?.remesh : this.cur?.mesh)?.add(ms);
        if (edit) this.probe.remeshMs += ms;
        else this.probe.meshMs += ms;
      },
    };
    this.observers.start();
    this.hookRender();
    this.index = -1;
    this.nextStep();
  }

  /** Para tudo o que o teste ligou. O jogo recarrega em seguida: o mundo foi alterado. */
  private stop(): void {
    const { d } = this;
    this.abort.aborted = true;
    this.driver.end();
    this.unhook?.();
    this.unhook = null;
    this.observers.stop();
    this.gpu?.dispose();
    if (this.effectsDirty) this.effects.restore();
    d.world.perf = null;
    d.renderer.info.autoReset = true;
    d.player.mining = false;
    d.base.benchRun = false;
  }

  cancel(): void {
    if (this.state === 'running') {
      this.stop();
      this.state = 'cancelled';
    } else this.abort.aborted = true;
  }

  // ---------- passos ----------

  private nextStep(): void {
    if (this.cur) this.closeStep();
    this.index++;
    const step = this.steps[this.index];
    if (!step) return this.finish();
    const { d } = this;
    // resolução: se o aparelho não comporta a escala, o ponto fica como "não suportado" e o passo é pulado
    if (step.scale !== undefined) {
      this.effects.restore();
      this.effectsDirty = true;
      const size = d.renderer.getSize(new THREE.Vector2());
      const max = this.env?.gl.maxTextureSize ?? 4096;
      const pr = d.renderer.getPixelRatio();
      const ok = this.effects.setScale(step.scale, max);
      if (!ok) {
        this.resolutionPoints.push({ scale: step.scale, width: Math.round(size.x * pr * step.scale), height: Math.round(size.y * pr * step.scale), skipped: true, stat: null, sustains: [false, false] });
        return this.nextStep();
      }
    } else if (step.effect) {
      this.effects.restore();
      this.effectsDirty = true;
      if (step.effect !== 'baseline') {
        const { id, on } = step.effect;
        if (!this.effectActive.has(id)) this.effectActive.set(id, this.effects.activeNow(id, d.quality().preset));
        this.effects.set(id, on);
      }
    } else if (this.effectsDirty) {
      this.effects.restore();
      this.effectsDirty = false;
    }
    this.driver.begin(step.scenario, originOf(step.origin), this.index);
    this.cur = {
      step, rec: new Recorder(), gauges: newGauges(), gen: new Timer(), mesh: new Timer(), remesh: new Timer(),
      creations: new CreationCounter(), from: 0, to: 0, elapsed: 0, measuring: false, frames: 0,
    };
    this.recent = [];
  }

  /** guarda o que o passo mediu */
  private closeStep(): void {
    const c = this.cur;
    if (!c) return;
    this.cur = null;
    this.doneSeconds += stepSeconds(c.step);
    c.to = performance.now() - this.t0;
    const hz = (this.refresh as RefreshDetection).hz;
    const s = c.step;
    if (c.rec.frames === 0) return;
    if (s.section === 'scenarios') {
      const chunks = { gen: c.gen.value, mesh: c.mesh.value, remesh: c.remesh.value };
      const inWindow = (list: { at: number; ms: number; source: string }[]): typeof list => list.filter((e) => e.at >= c.from && e.at <= c.to);
      this.scenarios.push({
        id: s.id,
        summary: summarize(c.rec, hz, chunks),
        scene: sceneStats(c.gauges),
        creations: c.creations.rates(c.elapsed - s.warmup),
        longTasks: summarizeLong(inWindow(this.observers.longTasks)),
        longFrames: summarizeLong(inWindow(this.observers.longFrames)),
        series: seriesOf(c.rec, 250),
      });
      // o conjunto de todos os cenários: os mesmos quadros, somados
      const o = this.overall;
      for (let i = 0; i < c.rec.frames; i++) {
        o.interval.push(c.rec.interval.values[i]);
        o.cpu.push(c.rec.cpu.values[i]);
        o.steps.push(c.rec.steps.values[i]);
        c.rec.subs.forEach((ser, k) => o.subs[k].push(ser.values[i]));
        o.gen.push(c.rec.gen.values[i]);
        o.mesh.push(c.rec.mesh.values[i]);
        o.remesh.push(c.rec.remesh.values[i]);
      }
      for (let i = 0; i < c.rec.gpu.n; i++) o.gpu.push(c.rec.gpu.values[i]);
      o.cappedFrames += c.rec.cappedFrames;
      for (const [k, t] of [['gen', c.gen], ['mesh', c.mesh], ['remesh', c.remesh]] as const) this.overallChunks[k].merge(t);
    } else if (s.section === 'effects') {
      const key = s.effect === 'baseline' || !s.effect ? 'baseline' : `${s.effect.id}:${s.effect.on ? 'on' : 'off'}`;
      this.effectStats.set(key, stepStat(c.rec));
    } else if (s.section === 'resolution') {
      const size = this.d.renderer.getDrawingBufferSize(new THREE.Vector2());
      const st = stepStat(c.rec);
      const sum = summarize(c.rec, hz, { gen: c.gen.value, mesh: c.mesh.value, remesh: c.remesh.value });
      this.resolutionPoints.push({
        scale: s.scale as number, width: size.x, height: size.y, skipped: false, stat: st, sustains: sum.targets.map((t) => t.sustains),
      });
    } else {
      const st = stepStat(c.rec);
      this.thermalMinutes.push({
        minute: s.minute as number, fps: st.fps, meanMs: st.meanMs, p99Ms: st.p99Ms, cpuMs: st.cpuMs, battery: this.battery?.().level ?? null,
      });
      const b = bucketSeries(c.rec.interval.values, 1000);
      this.thermalSeries.avg.push(...b.avg.map(round2));
      this.thermalSeries.max.push(...b.max.map(round2));
    }
  }

  // ---------- a cada quadro ----------

  /** Começo do quadro (o Game chama antes de tudo). `rawMs` = tempo desde o quadro anterior. */
  beforeFrame(rawMs: number): void {
    if (this.state !== 'running') return;
    const t0 = performance.now();
    const c = this.cur;
    if (!c) return;
    this.rawMs = rawMs;
    const { d } = this;
    d.renderer.info.reset();
    this.probe.reset();
    c.elapsed += rawMs / 1000;
    if (c.elapsed >= stepSeconds(c.step)) {
      this.nextStep();
      if (this.state !== 'running') return;
      return this.beforeFrame(rawMs);
    }
    if (!c.measuring && c.elapsed >= c.step.warmup) {
      c.measuring = true;
      c.from = performance.now() - this.t0;
      c.creations = new CreationCounter();
      c.elapsed = Math.max(c.elapsed, c.step.warmup);
    }
    this.driver.tick(rawMs / 1000);
    this.probe.add(SUB.bench, performance.now() - t0);
  }

  /** Desenha o quadro (o Game chama no lugar de `post.render`): mede a GPU e, nas etapas de comparação, espera por ela. */
  render(time: number): void {
    const { d } = this;
    this.hookRender();
    const c = this.cur;
    const sync = !!c?.step.sync && c.measuring;
    const t0 = sync ? performance.now() : 0;
    this.gpu?.begin();
    d.post.render(time);
    this.gpu?.end();
    if (sync && c) {
      this.sync.wait();
      c.rec.sync.push(performance.now() - t0);
    }
    if (this.gpu && c?.measuring) this.gpu.poll((ms) => c.rec.gpu.push(ms));
  }

  /** Fim do quadro, depois de desenhar. `cpuMs` = tempo do JavaScript neste quadro. */
  afterFrame(cpuMs: number): void {
    const c = this.cur;
    if (this.state !== 'running' || !c) return;
    const ms = this.rawMs;
    c.frames++;
    if (c.measuring && c.frames > 1) {
      c.rec.push(ms, cpuMs, this.probe);
      this.sampleScene(c, ms);
    }
    this.recent.push(ms);
    if (this.recent.length > 30) this.recent.shift();
    this.uiT -= ms / 1000;
    if (this.uiT <= 0 && this.onProgress) {
      this.uiT = 0.25;
      const avg = this.recent.reduce((a, v) => a + v, 0) / this.recent.length;
      const done = this.doneSeconds + Math.min(c.elapsed, stepSeconds(c.step));
      this.onProgress({
        fraction: Math.min(1, done / this.total), kind: c.step.kind, id: c.step.id, detail: c.step.detail,
        remaining: Math.max(0, this.total - done), fps: 1000 / avg, step: this.index + 1, steps: this.steps.length, warming: !c.measuring,
      });
    }
  }

  private sampleScene(c: Current, ms: number): void {
    const { d } = this;
    const info = d.renderer.info;
    const g = c.gauges;
    g.calls.add(info.render.calls);
    g.triangles.add(info.render.triangles);
    g.lines.add(info.render.lines);
    g.points.add(info.render.points);
    g.geometries.add(info.memory.geometries);
    g.textures.add(info.memory.textures);
    g.programs.add(info.programs?.length ?? 0);
    g.debris.add(d.debris.count);
    g.particles.add(d.particles.active);
    g.drops.add(d.drops.count);
    g.loot.add(d.loot.count);
    g.meteors.add(d.meteors.active.length);
    g.chunks.add(d.world.chunkCount);
    const size = d.renderer.getDrawingBufferSize(this.sizeTmp);
    g.pixels.add(size.x * size.y);
    // contar os objetos visíveis percorre a cena inteira: amostra duas vezes por segundo
    this.objT -= ms / 1000;
    if (this.objT <= 0) {
      this.objT = 0.5;
      g.objects.add(countVisible(d.scene));
    }
  }
  private readonly sizeTmp = new THREE.Vector2();

  // ---------- medição por passada ----------

  /** Mede cada passada do pós-processamento e a sombra. Refaz o gancho se o jogo recriou o compositor. */
  private hookRender(): void {
    const { post, renderer } = this.d;
    const passes = post.passes;
    if (this.hooked === passes[0] && this.unhook) return;
    this.unhook?.();
    const probe = this.probe;
    const restore: (() => void)[] = [];
    passes.forEach((pass, i) => {
      const orig = pass.render.bind(pass) as (...a: unknown[]) => void;
      // a primeira passada desenha o mundo (e a sombra, dentro dela); a segunda é o tablet; o resto é pós-processamento
      const slot = i <= 1 ? SUB.render : SUB.post;
      (pass as unknown as { render: (...a: unknown[]) => void }).render = (...a) => {
        const t = performance.now();
        orig(...a);
        probe.add(slot, performance.now() - t);
      };
      restore.push(() => delete (pass as unknown as { render?: unknown }).render);
    });
    const sm = renderer.shadowMap as unknown as { render: (...a: unknown[]) => void };
    const origShadow = sm.render;
    sm.render = (...a) => {
      const t = performance.now();
      origShadow.apply(sm, a);
      const dt = performance.now() - t;
      probe.add(SUB.shadow, dt);
      probe.add(SUB.render, -dt); // o desenho do mundo inclui a sombra: tira para não contar duas vezes
    };
    restore.push(() => (sm.render = origShadow));
    this.hooked = passes[0];
    this.unhook = () => {
      restore.forEach((f) => f());
      this.hooked = null;
    };
  }

  // ---------- resultado ----------

  private finish(): void {
    const report = this.build();
    this.stop();
    this.state = 'done';
    this.onFinish?.(report);
  }

  private build(): BenchReport {
    const { d } = this;
    const hz = (this.refresh as RefreshDetection).hz;
    const q = d.quality();
    const size = d.renderer.getDrawingBufferSize(new THREE.Vector2());
    const css = d.renderer.getSize(new THREE.Vector2());
    const overall = summarize(this.overall, hz, {
      gen: this.overallChunks.gen.value, mesh: this.overallChunks.mesh.value, remesh: this.overallChunks.remesh.value,
    });
    const batteryEnd = this.battery?.() ?? null;
    const seconds = (performance.now() - this.t0) / 1000;
    const minutes = seconds / 60;
    const res = performance.getEntriesByType?.('resource') as PerformanceResourceTiming[] | undefined;

    let effects: BenchReport['effects'] = null;
    if (this.mode === 'full' && this.effectStats.has('baseline')) {
      const list: EffectResult[] = [];
      for (const e of BENCH_EFFECTS) {
        const on = this.effectStats.get(`${e.id}:on`), off = this.effectStats.get(`${e.id}:off`);
        if (on && off) list.push(effectResult(e.id, this.effectActive.get(e.id) ?? true, on, off));
      }
      effects = { baseline: this.effectStats.get('baseline') as StepStat, effects: list };
    }
    const resolution = this.resolutionPoints.length ? resolutionResult(this.resolutionPoints) : null;
    const thermal = this.thermalMinutes.length
      ? thermalResult(this.thermalMinutes, { bucketMs: 1000, avg: this.thermalSeries.avg, max: this.thermalSeries.max } as SeriesData)
      : null;
    const env = this.env as EnvInfo;
    const refresh = this.refresh as RefreshDetection;
    const partial = { refresh, overall, scenarios: this.scenarios, thermal, env };
    const ob = this.observers;
    const report: BenchReport = {
      version: BENCH_VERSION,
      gameVersion: d.version,
      date: new Date().toISOString(),
      mode: this.mode,
      scale: this.scale,
      seconds,
      env,
      refresh,
      graphics: {
        quality: q.name, auto: q.auto, pixelRatio: d.renderer.getPixelRatio(), shadow: q.preset.shadow, samples: q.preset.samples,
        bloom: q.preset.bloom, css: [css.x, css.y], buffer: [size.x, size.y],
      },
      muted: d.muted(),
      overall,
      scenarios: this.scenarios,
      effects,
      resolution,
      thermal,
      input: {
        touch: latency(ob.touchLatency),
        fallback: latency(ob.touchFallback),
        touchCount: Math.max(ob.touchLatency.length, ob.touchFallback.length),
      },
      memory: {
        heapStartMb: this.heapStart === null ? null : Math.round((this.heapStart / 1048576) * 10) / 10,
        heapEndMb: (() => {
          const h = readJsHeap();
          return h ? Math.round((h.used / 1048576) * 10) / 10 : null;
        })(),
        saveBytes: d.saveBytes(),
        resourceCount: res ? res.length : null,
        resourceBytes: res ? res.reduce((a, r) => a + (r.transferSize || r.encodedBodySize || 0), 0) : null,
      },
      battery:
        this.batteryStart && batteryEnd
          ? {
              start: this.batteryStart.level, end: batteryEnd.level, minutes: round2(minutes), charging: batteryEnd.charging || this.batteryStart.charging,
              perMinute: minutes > 0 ? round2(((this.batteryStart.level - batteryEnd.level) * 100) / minutes) : null,
            }
          : null,
      findings: [],
    };
    report.findings = findings(partial);
    return report;
  }
}

/** objetos desenháveis visíveis na cena (malhas, pontos, linhas, sprites), sem contar os escondidos */
export function countVisible(scene: THREE.Object3D): number {
  let n = 0;
  scene.traverseVisible((o) => {
    const r = o as THREE.Mesh;
    if (r.isMesh || (o as THREE.Points).isPoints || (o as THREE.Line).isLine || (o as THREE.Sprite).isSprite) n++;
  });
  return n;
}
