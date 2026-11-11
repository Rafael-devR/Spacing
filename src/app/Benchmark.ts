// Teste de desempenho (docs/design/DESEMPENHO.md): conduz um roteiro fixo que reproduz o que mais pesa no jogo e
// mede cada quadro. Não conhece o DOM: a tela de acompanhamento e de resultado ficam em ui/BenchmarkUi.ts, e quem
// liga tudo (estado do jogo, salvamento, recarregar no fim) é o Game.
//
// O roteiro (data/benchmark.ts) roda em tempo real: a mesma carga por segundo em qualquer aparelho, então um jogo
// otimizado faz o mesmo trabalho com menos tempo por quadro. Por isso o resultado só vale comparado com o do mesmo
// aparelho, com a mesma qualidade e a mesma resolução.
import * as THREE from 'three';
import {
  BENCH_BREAK_RADIUS, BENCH_HEADING, BENCH_PHASES, BENCH_SCENARIO, BENCH_SEED, BENCH_START,
  type BenchPhase,
} from '../data/benchmark';
import { Running, summarize, Timer, WorstFrames, type BenchResult, type PhaseResult } from '../core/benchStats';
import type { Debris } from '../entities/Debris';
import type { ItemDrops } from '../entities/ItemDrops';
import type { LootPiles } from '../entities/LootPiles';
import type { Meteors } from '../entities/Meteors';
import type { Player } from '../entities/Player';
import type { IsoRig } from '../render/IsoRig';
import type { Particles } from '../render/particles';
import type { QualityName, QualityPreset } from '../render/post';
import type { Interaction } from '../systems/Interaction';
import type { World } from '../world/World';

export interface BenchmarkDeps {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  world: World;
  player: Player;
  rig: IsoRig;
  interaction: Interaction;
  meteors: Meteors;
  debris: Debris;
  particles: Particles;
  drops: ItemDrops;
  loot: LootPiles;
  /** qualidade em uso, se veio do modo automático e o que ela liga */
  quality(): { name: QualityName; auto: boolean; preset: QualityPreset };
  muted(): boolean;
  version: string;
}

export type BenchState = 'idle' | 'running' | 'done' | 'cancelled';

/** o que a tela de acompanhamento mostra */
export interface BenchProgress {
  phase: BenchPhase;
  /** 0..1 do teste inteiro */
  fraction: number;
  /** FPS dos últimos instantes */
  fps: number;
}

/** sorteio com semente (mulberry32): o teste quebra sempre a mesma sequência de blocos */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Em que etapa o teste está, dado o tempo decorrido (já em segundos do cenário escalado). */
export function phaseAt(elapsed: number, scale = 1): { index: number; phase: BenchPhase } | null {
  let end = 0;
  for (let i = 0; i < BENCH_PHASES.length; i++) {
    end += BENCH_PHASES[i].seconds * scale;
    if (elapsed < end) return { index: i, phase: BENCH_PHASES[i] };
  }
  return null;
}

export class Benchmark {
  state: BenchState = 'idle';
  /** 1 = cenário completo; menos = abreviado (só para os testes automáticos) */
  scale = 1;
  onProgress: ((p: BenchProgress) => void) | null = null;
  onFinish: ((r: BenchResult) => void) | null = null;

  private elapsed = 0;
  private skip = 2;
  private phaseIndex = 0;
  private rawMs = 0;
  private breakAcc = 0;
  private meteorAcc = 0;
  private meteorsLaunched = 0;
  private rng = seeded(BENCH_SEED);
  private readonly dir = new THREE.Vector2();
  private readonly pos = new THREE.Vector2();
  private all: number[] = [];
  private allCpu: number[] = [];
  private byPhase: { ms: number[]; cpu: number[] }[] = [];
  private readonly worst = new WorstFrames();
  private readonly gen = new Timer();
  private readonly mesh = new Timer();
  private readonly remesh = new Timer();
  private series = this.makeSeries();
  private objectsT = 0;
  private recentMs: number[] = [];
  private uiT = 0;
  private startHeap: number | null = null;
  private startedAt = 0;

  constructor(private readonly d: BenchmarkDeps) {}

  get running(): boolean {
    return this.state === 'running';
  }

  get finished(): boolean {
    return this.state === 'done';
  }

  private makeSeries() {
    return {
      calls: new Running(), triangles: new Running(), objects: new Running(), debris: new Running(), particles: new Running(),
      drops: new Running(), loot: new Running(), meteors: new Running(), loaded: new Running(),
    };
  }

  /** Começa o teste: liga a medição, leva o astronauta ao ponto de partida e arruma a câmera. */
  start(): void {
    const { d } = this;
    this.state = 'running';
    this.elapsed = 0;
    this.skip = 2;
    this.phaseIndex = 0;
    this.breakAcc = this.meteorAcc = 0;
    this.meteorsLaunched = 0;
    this.rng = seeded(BENCH_SEED);
    this.all = [];
    this.allCpu = [];
    this.byPhase = BENCH_PHASES.map(() => ({ ms: [], cpu: [] }));
    this.series = this.makeSeries();
    this.objectsT = 0;
    this.recentMs = [];
    this.uiT = 0;
    this.startHeap = heapMb();
    this.startedAt = performance.now();
    // o renderizador soma as chamadas de todas as passadas do quadro (sombra, mundo, pós-processamento) só se não zerar sozinho
    d.renderer.info.autoReset = false;
    d.world.perf = {
      onGenerate: (ms) => this.gen.add(ms),
      onMesh: (ms, edit) => (edit ? this.remesh : this.mesh).add(ms),
    };
    // sem meteoros sorteados: só os do roteiro
    d.meteors.holdSpawns = true;
    // câmera e posição de partida sempre iguais
    d.rig.yaw = d.rig.yawTarget = Math.PI / 4;
    d.rig.dist = d.rig.distTarget = 30;
    d.player.spawn(BENCH_START.x, BENCH_START.z);
    this.pos.set(BENCH_START.x, BENCH_START.z);
    this.dir.set(BENCH_HEADING.x, BENCH_HEADING.z).normalize();
    d.rig.snap(new THREE.Vector3(d.player.pos.x, d.player.pos.y + 0.8, d.player.pos.z));
  }

  /** Desfaz o que o teste ligou (medição, meteoros). O jogo é recarregado em seguida: o mundo foi alterado. */
  private stop(): void {
    const { d } = this;
    d.world.perf = null;
    d.renderer.info.autoReset = true;
    d.player.mining = false;
  }

  cancel(): void {
    if (this.state !== 'running') return;
    this.stop();
    this.state = 'cancelled';
  }

  // ---------- a cada quadro ----------

  /** Começo do quadro: avança o roteiro (anda, quebra blocos, solta meteoros). `rawMs` = tempo desde o quadro anterior. */
  frameBegin(rawMs: number): void {
    if (this.state !== 'running') return;
    const { d } = this;
    this.rawMs = rawMs;
    d.renderer.info.reset();
    const sec = rawMs / 1000;
    this.elapsed += sec;
    const at = phaseAt(this.elapsed, this.scale);
    if (!at) {
      this.finish();
      return;
    }
    if (at.index !== this.phaseIndex) {
      this.phaseIndex = at.index;
      this.breakAcc = this.meteorAcc = 0;
    }
    const p = at.phase;
    // as ações usam o tempo real do quadro, mas um quadro de segundos não vira um salto de dezenas de blocos
    const act = Math.min(sec, 0.25);
    this.walk(p, act);
    d.player.mining = p.breakRate > 0;
    this.breakBlocks(p, act);
    this.meteors(p, act);
  }

  private walk(p: BenchPhase, dt: number): void {
    const { player, world } = this.d;
    if (p.walk <= 0) return;
    this.pos.addScaledVector(this.dir, p.walk * dt);
    const x = this.pos.x, z = this.pos.y;
    // a posição é imposta (o chão acompanha o relevo); a velocidade fica para os passos, a poeira e as pegadas
    player.pos.set(x, world.topY(Math.floor(x), Math.floor(z)) + 1.05, z);
    player.vel.set(this.dir.x * p.walk, 0, this.dir.y * p.walk);
    player.facing = Math.atan2(this.dir.x, this.dir.y);
  }

  private breakBlocks(p: BenchPhase, dt: number): void {
    if (p.breakRate <= 0) return;
    const { world, player, interaction } = this.d;
    this.breakAcc += p.breakRate * dt;
    let n = Math.min(40, Math.floor(this.breakAcc));
    this.breakAcc -= Math.floor(this.breakAcc);
    const cx = player.pos.x, cz = player.pos.z, R = BENCH_BREAK_RADIUS;
    for (let tries = 0; n > 0 && tries < n * 6; tries++) {
      const x = Math.floor(cx + (this.rng() * 2 - 1) * R), z = Math.floor(cz + (this.rng() * 2 - 1) * R);
      const y = world.topY(x, z);
      if (y <= 2) continue;
      if (interaction.breakBlockAt(x, y, z)) n--;
    }
  }

  private meteors(p: BenchPhase, dt: number): void {
    if (p.meteorEvery <= 0) return;
    this.meteorAcc += dt;
    if (this.meteorAcc < p.meteorEvery) return;
    this.meteorAcc -= p.meteorEvery;
    const { meteors } = this.d;
    meteors.launch(meteors.pickTarget(7, 15), { radius: 1.6 + (this.meteorsLaunched % 3) * 0.4, meteorite: this.meteorsLaunched % 2 === 0 });
    this.meteorsLaunched++;
  }

  /** Fim do quadro (depois de desenhar): registra o tempo e o que havia na tela. `cpuMs` = tempo do JavaScript no quadro. */
  frameEnd(cpuMs: number): void {
    if (this.state !== 'running') return;
    const { d } = this;
    // os primeiros quadros pagam a compilação dos shaders e o intervalo desde a pausa: não valem
    if (this.skip > 0) {
      this.skip--;
      return;
    }
    const ms = this.rawMs;
    this.all.push(ms);
    this.allCpu.push(cpuMs);
    const ph = this.byPhase[this.phaseIndex];
    ph.ms.push(ms);
    ph.cpu.push(cpuMs);
    this.worst.add({ ms, phase: BENCH_PHASES[this.phaseIndex].id, at: this.elapsed });

    const info = d.renderer.info.render;
    const s = this.series;
    s.calls.add(info.calls);
    s.triangles.add(info.triangles);
    s.debris.add(d.debris.count);
    s.particles.add(d.particles.active);
    s.drops.add(d.drops.count);
    s.loot.add(d.loot.count);
    s.meteors.add(d.meteors.active.length);
    s.loaded.add(d.world.chunkCount);
    // contar os objetos visíveis percorre a cena inteira: amostra duas vezes por segundo
    this.objectsT -= ms / 1000;
    if (this.objectsT <= 0) {
      this.objectsT = 0.5;
      s.objects.add(countVisible(d.scene));
    }
    this.recentMs.push(ms);
    if (this.recentMs.length > 30) this.recentMs.shift();
    this.uiT -= ms / 1000;
    if (this.uiT <= 0 && this.onProgress) {
      this.uiT = 0.5;
      const total = BENCH_PHASES.reduce((a, q) => a + q.seconds, 0) * this.scale;
      const avg = this.recentMs.reduce((a, v) => a + v, 0) / this.recentMs.length;
      this.onProgress({ phase: BENCH_PHASES[this.phaseIndex], fraction: Math.min(1, this.elapsed / total), fps: 1000 / avg });
    }
  }

  // ---------- resultado ----------

  private finish(): void {
    this.stop();
    this.state = 'done';
    const result = this.build();
    this.onFinish?.(result);
  }

  private build(): BenchResult {
    const { d } = this;
    const q = d.quality();
    const gl = d.renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const size = d.renderer.getDrawingBufferSize(new THREE.Vector2());
    const phases: PhaseResult[] = BENCH_PHASES.map((p, i) => ({ id: p.id, ...summarize(this.byPhase[i].ms, this.byPhase[i].cpu) }));
    const nav = navigator as Navigator & { deviceMemory?: number };
    const s = this.series;
    return {
      version: 1,
      scenario: BENCH_SCENARIO,
      date: new Date().toISOString(),
      gameVersion: d.version,
      seconds: (performance.now() - this.startedAt) / 1000,
      scale: this.scale,
      device: {
        userAgent: navigator.userAgent,
        cores: navigator.hardwareConcurrency ?? null,
        memoryGb: nav.deviceMemory ?? null,
        gpu: ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : null,
        touch: 'ontouchstart' in window || navigator.maxTouchPoints > 0,
      },
      graphics: {
        quality: q.name,
        auto: q.auto,
        pixelRatio: d.renderer.getPixelRatio(),
        shadow: q.preset.shadow,
        samples: q.preset.samples,
        bloom: q.preset.bloom,
        css: [d.renderer.domElement.clientWidth, d.renderer.domElement.clientHeight],
        buffer: [size.x, size.y],
        dpr: window.devicePixelRatio || 1,
      },
      muted: d.muted(),
      overall: summarize(this.all, this.allCpu),
      phases,
      worst: this.worst.all,
      chunks: { generated: this.gen.value, meshed: this.mesh.value, remeshed: this.remesh.value, loaded: s.loaded.value },
      scene: {
        calls: s.calls.value, triangles: s.triangles.value, objects: s.objects.value, debris: s.debris.value,
        particles: s.particles.value, drops: s.drops.value, loot: s.loot.value, meteors: s.meteors.value,
      },
      memory: { startMb: this.startHeap, endMb: heapMb() },
    };
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

/** memória do JavaScript em uso, em MB (só o Chrome informa) */
function heapMb(): number | null {
  const m = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  return m ? Math.round((m.usedJSHeapSize / 1048576) * 10) / 10 : null;
}
