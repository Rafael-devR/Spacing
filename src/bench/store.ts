// Histórico dos últimos resultados do teste (HISTORY_SIZE). Fica no `localStorage` do aparelho, numa chave PRÓPRIA,
// fora do salvamento do jogo e das preferências: não muda a versão do save e apagar o progresso não apaga isto.
// Se o navegador não deixa gravar (bloqueado, cheio), o teste segue sem guardar.
import { HISTORY_SIZE } from '../data/bench';
import { readJSON, writeJSON, type KeyValueStore } from '../core/save';
import type { BenchReport, SeriesData } from './report';

export const BENCH_HISTORY_KEY = 'spacing.bench.history.v2';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** O valor tem a forma de um resultado? (confere o que as telas leem; descarta lixo) */
export function isReport(v: unknown): v is BenchReport {
  if (!isObj(v) || typeof v.version !== 'number' || typeof v.date !== 'string' || typeof v.mode !== 'string') return false;
  return isObj(v.overall) && isObj(v.overall.stats) && Array.isArray(v.scenarios) && isObj(v.refresh) && isObj(v.env) && isObj(v.graphics);
}

export function loadHistory(store: KeyValueStore | null): BenchReport[] {
  const raw = readJSON(store, BENCH_HISTORY_KEY);
  if (!isObj(raw) || !Array.isArray(raw.entries)) return [];
  return raw.entries.filter(isReport).slice(0, HISTORY_SIZE);
}

const emptySeries = (s: SeriesData): SeriesData => ({ bucketMs: s.bucketMs, avg: [], max: [] });

/** cópia sem os gráficos (a parte que mais pesa), para caber quando o espaço aperta */
export function withoutSeries(r: BenchReport): BenchReport {
  return {
    ...r,
    scenarios: r.scenarios.map((s) => ({ ...s, series: emptySeries(s.series) })),
    thermal: r.thermal ? { ...r.thermal, series: emptySeries(r.thermal.series) } : null,
  };
}

export interface SaveOutcome {
  /** gravou no aparelho */
  saved: boolean;
  history: BenchReport[];
}

/**
 * Põe `report` na frente do histórico (no máximo HISTORY_SIZE). Se não couber, tira os gráficos dos resultados antigos,
 * depois do novo, depois os resultados mais antigos. Nunca lança: sem espaço, `saved` fica false.
 */
export function saveReport(store: KeyValueStore | null, report: BenchReport): SaveOutcome {
  const entries = [report, ...loadHistory(store)].slice(0, HISTORY_SIZE);
  const tries: BenchReport[][] = [entries, entries.map((r, i) => (i === 0 ? r : withoutSeries(r)))];
  tries.push(tries[1].map((r, i) => (i === 0 ? withoutSeries(r) : r)));
  for (let n = tries[2].length - 1; n >= 1; n--) tries.push(tries[2].slice(0, n));
  for (const list of tries) {
    if (writeJSON(store, BENCH_HISTORY_KEY, { version: 1, entries: list })) return { saved: true, history: list };
  }
  return { saved: false, history: entries };
}

export function clearHistory(store: KeyValueStore | null): void {
  try {
    store?.removeItem(BENCH_HISTORY_KEY);
  } catch {
    // sem armazenamento: nada a apagar
  }
}
