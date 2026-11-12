// Cria os workers dos chunks. Fica à parte do World para os testes (sem Worker) não importarem o arquivo do worker.
import type { ChunkTransport, JobRequest, JobResponse } from './chunkJobs';

/** quantos workers: um por núcleo livre, de 1 a 2 (mais que isso só disputa a GPU e a bateria do celular) */
export function workerCount(cores: number): number {
  return Math.max(1, Math.min(2, Math.floor(cores) - 3));
}

/** Os workers prontos, ou lista vazia se o navegador não tem Worker. */
export function createChunkWorkers(n = workerCount(navigator.hardwareConcurrency || 4)): ChunkTransport[] {
  if (typeof Worker === 'undefined') return [];
  const out: ChunkTransport[] = [];
  try {
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('./chunk.worker.ts', import.meta.url), { type: 'module' });
      const t: ChunkTransport = {
        post: (req: JobRequest) => w.postMessage(req),
        onResponse: null,
        onFailure: null,
      };
      w.onmessage = (e: MessageEvent<JobResponse>) => t.onResponse?.(e.data);
      w.onerror = () => t.onFailure?.();
      out.push(t);
    }
  } catch {
    return [];
  }
  return out;
}
