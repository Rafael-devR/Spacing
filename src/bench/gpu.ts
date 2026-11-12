// Tempo de GPU por quadro com a extensão de timer query (EXT_disjoint_timer_query_webgl2), onde existir. Muitos
// navegadores de celular não a oferecem; nesse caso o teste marca "não disponível" e usa a comparação com efeitos
// ligados e desligados (src/bench/effects.ts) com espera da GPU.

interface TimerExt {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

export class GpuTimer {
  private readonly pending: WebGLQuery[] = [];
  private readonly pool: WebGLQuery[] = [];
  private active: WebGLQuery | null = null;

  private constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly ext: TimerExt,
  ) {}

  /** O timer, ou null se o aparelho não tem a extensão. */
  static create(gl: WebGLRenderingContext | WebGL2RenderingContext): GpuTimer | null {
    if (typeof WebGL2RenderingContext === 'undefined' || !(gl instanceof WebGL2RenderingContext)) return null;
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExt | null;
    return ext ? new GpuTimer(gl, ext) : null;
  }

  /** começa a medir (um por vez: o próximo `begin` só depois de `end`) */
  begin(): void {
    if (this.active) return;
    const q = this.pool.pop() ?? this.gl.createQuery();
    if (!q) return;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.active = q;
  }

  end(): void {
    if (!this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
  }

  /** Entrega ao `sink` os tempos (ms) das medições já prontas. A GPU responde alguns quadros depois. */
  poll(sink: (ms: number) => void): void {
    const gl = this.gl;
    const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT) as boolean;
    while (this.pending.length) {
      const q = this.pending[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      this.pending.shift();
      // uma medição "disjunta" (troca de GPU, energia) não vale
      if (!disjoint) sink(Number(gl.getQueryParameter(q, gl.QUERY_RESULT)) / 1e6);
      this.pool.push(q);
    }
    // se a GPU não responde, não deixa a fila crescer sem fim
    while (this.pending.length > 16) this.pool.push(this.pending.shift() as WebGLQuery);
  }

  dispose(): void {
    for (const q of [...this.pending, ...this.pool]) this.gl.deleteQuery(q);
    this.pending.length = 0;
    this.pool.length = 0;
  }
}

/**
 * Espera a GPU terminar o que foi desenhado, lendo um pixel do quadro (a leitura só volta quando a GPU acaba). Serve para
 * medir o custo do render sem o vsync mascarar. Só nas etapas de efeitos: trava o paralelismo entre CPU e GPU.
 */
export class GpuSync {
  private readonly px = new Uint8Array(4);
  constructor(private readonly gl: WebGLRenderingContext | WebGL2RenderingContext) {}
  wait(): void {
    this.gl.readPixels(0, 0, 1, 1, this.gl.RGBA, this.gl.UNSIGNED_BYTE, this.px);
  }
}
