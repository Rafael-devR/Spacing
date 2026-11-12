import { describe, expect, it } from 'vitest';
import { Scene } from 'three';
import { AIR, REGOLITH } from '../src/data/blocks';
import { PropFactory } from '../src/render/models';
import { createMaterials } from '../src/render/materials';
import { ChunkJobs, type ChunkTransport, type JobRequest, type JobResponse } from '../src/world/chunkJobs';
import { workerCount } from '../src/world/workerPool';
import { World } from '../src/world/World';

const SEED = 4242;

/** worker de mentira: atende na mesma hora, mas só entrega quando `flush` é chamado (como a mensagem de um worker de verdade) */
class FakeWorker implements ChunkTransport {
  onResponse: ((res: JobResponse) => void) | null = null;
  onFailure: (() => void) | null = null;
  readonly inbox: JobResponse[] = [];
  readonly requests: JobRequest[] = [];
  private readonly jobs = new ChunkJobs();
  post(req: JobRequest): void {
    this.requests.push(req);
    const { res } = this.jobs.handle(req);
    if (res) this.inbox.push(res);
  }
  flush(): void {
    for (const r of this.inbox.splice(0)) this.onResponse?.(r);
  }
}

function makeWorld(workers: FakeWorker[] = []): World {
  const mats = createMaterials();
  const w = new World(new Scene(), SEED, mats.terrain, new PropFactory(mats.props));
  w.radius = 2;
  if (workers.length) w.enableWorkers(workers, 'lua', SEED);
  return w;
}

/** roda quadros até não faltar nada */
function settle(w: World, fakes: FakeWorker[], px = 8, pz = 8): number {
  for (let frame = 1; frame <= 200; frame++) {
    const left = w.update(px, pz, 2, 0.016);
    if (left === 0) return frame;
    for (const f of fakes) f.flush();
  }
  return -1;
}

describe('chunks em worker', () => {
  it('dá o mesmo mundo que gerar na thread principal: blocos, luz e malha', () => {
    const sync = makeWorld();
    sync.update(8, 8, 999, 0);
    const fakes = [new FakeWorker(), new FakeWorker()];
    const async = makeWorld(fakes);
    expect(async.usesWorkers).toBe(true);
    expect(settle(async, fakes)).toBeGreaterThan(0);
    expect(fakes.every((f) => f.requests.some((r) => r.type === 'gen'))).toBe(true);
    expect(fakes.some((f) => f.requests.some((r) => r.type === 'mesh'))).toBe(true);
    let compared = 0;
    for (const [k, a] of sync.chunks) {
      const b = async.chunks.get(k);
      if (!b?.mesh || !a.mesh) continue;
      expect(b.data, k).toEqual(a.data);
      expect(b.light, k).toEqual(a.light);
      expect(b.maxY).toBe(a.maxY);
      const ga = a.mesh.geometry, gb = b.mesh.geometry;
      for (const name of ['position', 'normal', 'color', 'aEdge', 'aSky']) {
        expect(gb.getAttribute(name).array, `${k} ${name}`).toEqual(ga.getAttribute(name).array);
      }
      expect(b.props.map((p) => p.key ?? p.wx + ',' + p.wz)).toEqual(a.props.map((p) => p.key ?? p.wx + ',' + p.wz));
      compared++;
    }
    expect(compared).toBeGreaterThan(10);
  });

  it('aplica poucas malhas por quadro, as mais perto primeiro', () => {
    const fakes = [new FakeWorker()];
    const w = makeWorld(fakes);
    // pede tudo, entrega tudo, e conta quantas malhas aparecem a cada quadro
    for (let i = 0; i < 40; i++) {
      w.update(8, 8, 2, 0.016);
      for (const f of fakes) f.flush();
    }
    let prev = [...w.chunks.values()].filter((c) => c.mesh).length;
    const steps: number[] = [];
    for (let i = 0; i < 30; i++) {
      w.update(40, 40, 2, 0.016);
      for (const f of fakes) f.flush();
      const now = [...w.chunks.values()].filter((c) => c.mesh).length;
      steps.push(now - prev);
      prev = now;
    }
    expect(Math.max(...steps)).toBeLessThanOrEqual(2);
  });

  it('uma edição durante a malha descarta a malha velha e refaz com o bloco novo', () => {
    const fakes = [new FakeWorker()];
    const w = makeWorld(fakes);
    expect(settle(w, fakes)).toBeGreaterThan(0);
    // chunk longe ainda sem malha: o jogador vai para perto dele
    const far = fakes[0];
    w.update(60, 8, 2, 0.016); // pede
    const target = [...w.chunks.values()].find((c) => !c.mesh);
    expect(target).toBeTruthy();
    // enquanto a resposta está no ar, quebra um bloco dentro do chunk e dos vizinhos
    const x = target!.cx * 16 + 5, z = target!.cz * 16 + 5;
    const top = w.topY(x, z);
    expect(w.setBlock(x, top, z, AIR)).toBe(true);
    far.flush();
    expect(settle(w, fakes, 60, 8)).toBeGreaterThan(0);
    const c = w.chunks.get(target!.key)!;
    expect(c.mesh).toBeTruthy();
    expect(w.getBlock(x, top, z)).toBe(AIR);
    // a malha final é a de um mundo feito na hora com a mesma edição
    const ref = makeWorld();
    ref.setBlock(x, top, z, AIR);
    ref.update(60, 8, 999, 0);
    const rc = ref.chunks.get(target!.key)!;
    expect(c.mesh!.geometry.getAttribute('position').array).toEqual(rc.mesh!.geometry.getAttribute('position').array);
    expect(c.light).toEqual(rc.light);
  });

  it('se o worker cai, o mundo continua sozinho', () => {
    const fakes = [new FakeWorker()];
    const w = makeWorld(fakes);
    w.update(8, 8, 2, 0.016);
    fakes[0].onFailure?.();
    expect(w.usesWorkers).toBe(false);
    expect(settle(w, fakes)).toBeGreaterThan(0);
    expect(w.chunks.get('0,0')?.mesh).toBeTruthy();
  });

  it('o carregamento inicial (orçamento alto) não espera os workers', () => {
    const fakes = [new FakeWorker()];
    const w = makeWorld(fakes);
    w.update(8, 8, 999, 0);
    expect(fakes[0].requests.filter((r) => r.type !== 'init')).toHaveLength(0);
    expect(w.getBlock(8, 3, 8)).not.toBe(AIR);
    expect(w.chunks.get('0,0')?.mesh).toBeTruthy();
    void REGOLITH;
  });

  it('um worker por núcleo livre, de 1 a 2', () => {
    expect(workerCount(1)).toBe(1);
    expect(workerCount(4)).toBe(1);
    expect(workerCount(5)).toBe(2);
    expect(workerCount(8)).toBe(2);
    expect(workerCount(64)).toBe(2);
  });
});
