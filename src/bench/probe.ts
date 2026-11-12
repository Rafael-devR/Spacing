// Sondas de CPU do teste de desempenho (docs/design/BENCHMARK.md). O jogo guarda uma sonda (`Game.probe`) que fica
// NULA fora do teste: cada ponto de medição é `probe?.begin(i)` / `probe?.end(i)`, uma checagem de nulo. Dentro do
// teste, nada aloca por quadro: tudo vai para vetores tipados pré-alocados.

/** os subsistemas medidos, na ordem em que aparecem na tabela */
export const SUBSYSTEMS = [
  'input', 'sim', 'debris', 'interaction', 'entities', 'chunks', 'particles', 'hud', 'map', 'shadow', 'render', 'post', 'bench',
] as const;
export type SubsystemId = (typeof SUBSYSTEMS)[number];

/** índice de cada subsistema (para `probe.begin(SUB.input)`) */
export const SUB = Object.fromEntries(SUBSYSTEMS.map((s, i) => [s, i])) as Record<SubsystemId, number>;

export class Probe {
  /** tempo acumulado de cada subsistema no quadro atual (ms) */
  readonly acc = new Float64Array(SUBSYSTEMS.length);
  private readonly t = new Float64Array(SUBSYSTEMS.length);
  /** passos fixos da simulação neste quadro */
  steps = 0;
  /** o quadro bateu no limite de passos fixos (o jogo desacelera) */
  capped = false;
  /** tempo deste quadro gerando chunks, malhando chunks novos e refazendo malhas depois de editar blocos (ms) */
  genMs = 0;
  meshMs = 0;
  remeshMs = 0;

  begin(i: number): void {
    this.t[i] = performance.now();
  }

  end(i: number): void {
    this.acc[i] += performance.now() - this.t[i];
  }

  add(i: number, ms: number): void {
    this.acc[i] += ms;
  }

  /** zera para o próximo quadro */
  reset(): void {
    this.acc.fill(0);
    this.steps = 0;
    this.capped = false;
    this.genMs = this.meshMs = this.remeshMs = 0;
  }
}

/** Vetor tipado que cresce (dobrando) quando enche: o crescimento é raro e acontece fora dos quadros medidos. */
export class Series {
  private a: Float32Array;
  n = 0;

  constructor(capacity = 2048) {
    this.a = new Float32Array(capacity);
  }

  push(v: number): void {
    if (this.n === this.a.length) {
      const b = new Float32Array(this.a.length * 2);
      b.set(this.a);
      this.a = b;
    }
    this.a[this.n++] = v;
  }

  /** os valores guardados (sem cópia) */
  get values(): Float32Array {
    return this.a.subarray(0, this.n);
  }
}

/** Média e máximo de uma série sem guardar os valores. */
export class Running {
  private sum = 0;
  private n = 0;
  private top = 0;
  add(v: number): void {
    this.sum += v;
    this.n++;
    if (v > this.top) this.top = v;
  }
  get count(): number {
    return this.n;
  }
  get value(): { avg: number; max: number } {
    return { avg: this.n ? this.sum / this.n : 0, max: this.top };
  }
}

/** Soma de tempos (gerar chunk, malhar chunk). */
export class Timer {
  private count = 0;
  private total = 0;
  private top = 0;
  add(ms: number): void {
    this.count++;
    this.total += ms;
    if (ms > this.top) this.top = ms;
  }
  get value(): { count: number; totalMs: number; avgMs: number; maxMs: number } {
    return { count: this.count, totalMs: this.total, avgMs: this.count ? this.total / this.count : 0, maxMs: this.top };
  }
}

/** Tudo o que foi medido quadro a quadro num trecho do teste (um cenário, ou o teste inteiro). */
export class Recorder {
  readonly interval = new Series();
  readonly cpu = new Series();
  readonly steps = new Series();
  readonly subs: Series[] = SUBSYSTEMS.map(() => new Series());
  readonly gen = new Series();
  readonly mesh = new Series();
  readonly remesh = new Series();
  /** tempo de GPU por quadro (ms), se o aparelho tem timer query */
  readonly gpu = new Series(256);
  /** tempo do render com espera da GPU (ms), só nas etapas de efeitos */
  readonly sync = new Series(256);
  cappedFrames = 0;

  get frames(): number {
    return this.interval.n;
  }

  push(intervalMs: number, cpuMs: number, p: Probe): void {
    this.interval.push(intervalMs);
    this.cpu.push(cpuMs);
    this.steps.push(p.steps);
    for (let i = 0; i < SUBSYSTEMS.length; i++) this.subs[i].push(p.acc[i]);
    this.gen.push(p.genMs);
    this.mesh.push(p.meshMs);
    this.remesh.push(p.remeshMs);
    if (p.capped) this.cappedFrames++;
  }
}
