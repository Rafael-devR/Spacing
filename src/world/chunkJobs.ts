// Trabalho de chunks fora da thread principal (docs/adr/0012-chunks-em-worker-e-resolucao-dinamica.md): gerar o terreno de
// um chunk e fazer a malha e a luz dele. É só uma função de pedido para resposta, sem Worker nem DOM: o worker de verdade
// (chunk.worker.ts) e os testes usam a mesma classe.
import { MarsTerrain } from './marsTerrain';
import { ChunkMesher } from './chunkMesher';
import { CH, CS, Terrain, type PropSpawn, type TerrainGen } from './terrain';
import type { MeshArrays } from './mesher';

export type ChunkPlanet = 'lua' | 'marte';

export type JobRequest =
  | { type: 'init'; planet: ChunkPlanet; seed: number }
  | { type: 'gen'; id: number; cx: number; cz: number }
  /** os 9 chunks em volta (e o do meio), na ordem de z e depois x */
  | { type: 'mesh'; id: number; cx: number; cz: number; blocks: Uint8Array[]; maxY: number[] };

export type JobResponse =
  | { type: 'gen'; id: number; cx: number; cz: number; data: Uint8Array; props: PropSpawn[]; maxY: number; ms: number }
  | { type: 'mesh'; id: number; cx: number; cz: number; mesh: MeshArrays; light: Uint8Array; ms: number };

/** por onde o World fala com um worker (ou com um de mentira nos testes) */
export interface ChunkTransport {
  post(req: JobRequest): void;
  /** o World coloca aqui o que quer receber */
  onResponse: ((res: JobResponse) => void) | null;
  /** o worker caiu ou não carregou: o World volta a trabalhar sozinho */
  onFailure: (() => void) | null;
}

export class ChunkJobs {
  private terrain: TerrainGen | null = null;
  private readonly mesher = new ChunkMesher();

  /** Atende um pedido. `transfer` são os buffers que podem ser entregues sem copiar. */
  handle(req: JobRequest): { res: JobResponse | null; transfer: ArrayBuffer[] } {
    if (req.type === 'init') {
      this.terrain = req.planet === 'marte' ? new MarsTerrain(req.seed) : new Terrain(req.seed);
      return { res: null, transfer: [] };
    }
    if (req.type === 'gen') {
      if (!this.terrain) throw new Error('chunkJobs: gen antes do init');
      const t0 = performance.now();
      const g = this.terrain.generate(req.cx, req.cz);
      const res: JobResponse = { type: 'gen', id: req.id, cx: req.cx, cz: req.cz, data: g.data, props: g.props, maxY: g.maxY, ms: performance.now() - t0 };
      return { res, transfer: [g.data.buffer as ArrayBuffer] };
    }
    const t0 = performance.now();
    const nb = req.blocks.map((data, i) => ({ data, maxY: req.maxY[i] }));
    const light = new Uint8Array(CS * CS * CH);
    const mesh = this.mesher.build(nb, req.cx * CS, req.cz * CS, light);
    const res: JobResponse = { type: 'mesh', id: req.id, cx: req.cx, cz: req.cz, mesh, light, ms: performance.now() - t0 };
    return {
      res,
      transfer: [light.buffer as ArrayBuffer, mesh.position.buffer as ArrayBuffer, mesh.normal.buffer as ArrayBuffer, mesh.color.buffer as ArrayBuffer, mesh.edge.buffer as ArrayBuffer, mesh.sky.buffer as ArrayBuffer],
    };
  }
}
