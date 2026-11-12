// Ambiente do teste: taxa de atualização da tela (medida) e dados do aparelho. O que o navegador não informa fica
// `null` e a interface mostra "não disponível": nunca se inventa um valor.
import { detectRefreshRate, type RefreshDetection } from './stats';

export const NA = null;

export interface BatteryInfo {
  /** 0..1 */
  level: number;
  charging: boolean;
}

export interface GlInfo {
  renderer: string | null;
  vendor: string | null;
  version: string | null;
  glsl: string | null;
  webgl2: boolean;
  maxTextureSize: number | null;
  maxRenderbufferSize: number | null;
  maxSamples: number | null;
  /** extensões úteis para o teste */
  extensions: { name: string; present: boolean }[];
  timerQuery: boolean;
}

export interface EnvInfo {
  userAgent: string;
  cores: number | null;
  deviceMemoryGb: number | null;
  gl: GlInfo;
  devicePixelRatio: number;
  screen: { width: number; height: number } | null;
  viewport: { width: number; height: number };
  orientation: string | null;
  battery: BatteryInfo | null;
  /** o jogo mede memória do JS só no Chrome (performance.memory) */
  perfMemory: boolean;
  longTask: boolean;
  longAnimationFrame: boolean;
  eventTiming: boolean;
}

const EXTENSIONS = [
  'EXT_disjoint_timer_query_webgl2',
  'EXT_disjoint_timer_query',
  'EXT_color_buffer_float',
  'EXT_color_buffer_half_float',
  'EXT_texture_filter_anisotropic',
  'OES_texture_float_linear',
  'WEBGL_debug_renderer_info',
];

type PerfWithMemory = Performance & { memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } };

/** Dados do contexto WebGL em uso (o do jogo). */
export function readGl(gl: WebGLRenderingContext | WebGL2RenderingContext): GlInfo {
  const webgl2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
  const dbg = gl.getExtension('WEBGL_debug_renderer_info') as { UNMASKED_RENDERER_WEBGL: number; UNMASKED_VENDOR_WEBGL: number } | null;
  const str = (p: number | undefined): string | null => {
    if (p === undefined) return null;
    const v = gl.getParameter(p) as unknown;
    return typeof v === 'string' && v ? v : null;
  };
  const num = (p: number): number | null => {
    const v = gl.getParameter(p) as unknown;
    return typeof v === 'number' ? v : null;
  };
  const extensions = EXTENSIONS.map((name) => ({ name, present: gl.getExtension(name) !== null }));
  return {
    renderer: str(dbg?.UNMASKED_RENDERER_WEBGL) ?? str(gl.RENDERER),
    vendor: str(dbg?.UNMASKED_VENDOR_WEBGL) ?? str(gl.VENDOR),
    version: str(gl.VERSION),
    glsl: str(gl.SHADING_LANGUAGE_VERSION),
    webgl2,
    maxTextureSize: num(gl.MAX_TEXTURE_SIZE),
    maxRenderbufferSize: num(gl.MAX_RENDERBUFFER_SIZE),
    maxSamples: webgl2 ? num((gl as WebGL2RenderingContext).MAX_SAMPLES) : null,
    extensions,
    timerQuery: extensions.some((e) => e.present && e.name.startsWith('EXT_disjoint_timer_query')),
  };
}

/** Bateria, se o navegador deixa ler (Chrome/Android sim; Safari e Firefox não). */
export async function readBattery(): Promise<BatteryInfo | null> {
  const nav = navigator as Navigator & { getBattery?: () => Promise<{ level: number; charging: boolean }> };
  if (typeof nav.getBattery !== 'function') return null;
  try {
    const b = await Promise.race([
      nav.getBattery(),
      new Promise<null>((r) => setTimeout(() => r(null), 1500)),
    ]);
    return b ? { level: b.level, charging: b.charging } : null;
  } catch {
    return null;
  }
}

/** Memória do JavaScript em uso (bytes), só onde `performance.memory` existe. */
export function readJsHeap(): { used: number; total: number; limit: number } | null {
  const m = (performance as PerfWithMemory).memory;
  return m ? { used: m.usedJSHeapSize, total: m.totalJSHeapSize, limit: m.jsHeapSizeLimit } : null;
}

export async function readEnv(gl: WebGLRenderingContext | WebGL2RenderingContext): Promise<EnvInfo> {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const types = typeof PerformanceObserver !== 'undefined' ? (PerformanceObserver.supportedEntryTypes ?? []) : [];
  const orient =
    typeof screen !== 'undefined' && screen.orientation ? screen.orientation.type : window.innerWidth >= window.innerHeight ? 'landscape' : 'portrait';
  return {
    userAgent: navigator.userAgent,
    cores: typeof nav.hardwareConcurrency === 'number' && nav.hardwareConcurrency > 0 ? nav.hardwareConcurrency : null,
    deviceMemoryGb: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null,
    gl: readGl(gl),
    devicePixelRatio: window.devicePixelRatio || 1,
    screen: typeof screen !== 'undefined' ? { width: screen.width, height: screen.height } : null,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    orientation: orient,
    battery: await readBattery(),
    perfMemory: readJsHeap() !== null,
    longTask: types.includes('longtask'),
    longAnimationFrame: types.includes('long-animation-frame'),
    eventTiming: types.includes('event'),
  };
}

/**
 * Mede a taxa de atualização da tela: intervalos do requestAnimationFrame por `seconds` s, mediana, arredondada para
 * 60/90/120/144 Hz. Devolve null se a aba ficou escondida (o rAF para) ou se foi cancelado.
 */
export function measureRefresh(seconds = 2, signal?: { aborted: boolean }): Promise<RefreshDetection | null> {
  return new Promise((resolve) => {
    const intervals: number[] = [];
    let last = -1;
    let start = -1;
    const tick = (now: number): void => {
      if (signal?.aborted || document.hidden) return resolve(null);
      if (start < 0) start = now;
      if (last >= 0) intervals.push(now - last);
      last = now;
      if ((now - start) / 1000 >= seconds && intervals.length >= 10) {
        // descarta os 2 primeiros intervalos (o navegador ainda está acordando)
        resolve(detectRefreshRate(intervals.slice(2)));
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
