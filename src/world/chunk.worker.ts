// Ponto de entrada do Web Worker dos chunks (ver chunkJobs.ts). Não importa nada do jogo além do terreno e da malha.
import { ChunkJobs, type JobRequest } from './chunkJobs';

const jobs = new ChunkJobs();
const ctx = self as unknown as {
  onmessage: ((e: { data: JobRequest }) => void) | null;
  postMessage(message: unknown, transfer: ArrayBuffer[]): void;
};

ctx.onmessage = (e) => {
  const { res, transfer } = jobs.handle(e.data);
  if (res) ctx.postMessage(res, transfer);
};
