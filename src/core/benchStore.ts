// Guarda o último resultado do teste de desempenho (e o anterior, para comparar antes e depois de otimizar).
// Fica no navegador do aparelho (`localStorage`), fora do salvamento do jogo: apagar o progresso não apaga isto.
import type { BenchResult } from './benchStats';
import { readJSON, writeJSON, type KeyValueStore } from './save';

export const BENCH_KEY = 'spacing.bench.v1';

export interface BenchStore {
  last: BenchResult | null;
  /** o resultado de antes do último */
  previous: BenchResult | null;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** O valor tem a forma de um resultado? (confere só o que a tela de resultado usa; descarta lixo e versões futuras) */
export function isBenchResult(v: unknown): v is BenchResult {
  if (!isObj(v) || v.version !== 1 || !isNum(v.scenario) || typeof v.date !== 'string') return false;
  const o = v.overall, g = v.graphics, c = v.chunks, s = v.scene;
  if (!isObj(o) || !isNum(o.avgFps) || !isNum(o.minFps) || !isNum(o.maxMs) || !isNum(o.frames)) return false;
  if (!isObj(g) || typeof g.quality !== 'string' || !Array.isArray(g.buffer) || !Array.isArray(g.css)) return false;
  if (!isObj(c) || !isObj(c.generated) || !isObj(c.meshed) || !isObj(c.remeshed) || !isObj(c.loaded)) return false;
  if (!isObj(s) || !isObj(s.calls) || !isObj(s.triangles) || !isObj(s.objects)) return false;
  return Array.isArray(v.phases) && Array.isArray(v.worst) && isObj(v.device) && isObj(v.memory);
}

export function loadBench(store: KeyValueStore | null): BenchStore {
  const raw = readJSON(store, BENCH_KEY);
  if (!isObj(raw)) return { last: null, previous: null };
  return {
    last: isBenchResult(raw.last) ? raw.last : null,
    previous: isBenchResult(raw.previous) ? raw.previous : null,
  };
}

/** Guarda `result` como o último; o que era o último vira o anterior. Devolve false se não deu para gravar. */
export function saveBench(store: KeyValueStore | null, result: BenchResult): BenchStore {
  const cur = loadBench(store);
  const next: BenchStore = { last: result, previous: cur.last };
  writeJSON(store, BENCH_KEY, next);
  return next;
}
