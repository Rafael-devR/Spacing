// Contagem de criações de geometrias, materiais, texturas e objetos do three.js, para achar alocações por quadro.
// O three.js dá a cada um deles um número de série crescente (`id`). Criar um objeto descartável e ler o seu `id` diz
// quantos já foram criados: a diferença entre duas leituras é quantos foram criados no meio, sem alterar o three.js.
import * as THREE from 'three';

export interface Creations {
  geometries: number;
  materials: number;
  textures: number;
  objects: number;
}

/** Lê os números de série atuais (cada leitura cria um de cada: a CreationCounter desconta isso). */
export function readIds(): Creations {
  return {
    geometries: new THREE.BufferGeometry().id,
    materials: new THREE.Material().id,
    textures: new THREE.Texture().id,
    objects: new THREE.Object3D().id,
  };
}

export class CreationCounter {
  private first: Creations = readIds();
  private last: Creations = this.first;
  private reads = 1;
  private t0 = performance.now();

  /** nova leitura (chame de tempos em tempos; é barato) */
  sample(): void {
    this.last = readIds();
    this.reads++;
  }

  /** criações por segundo desde o começo, já sem as leituras do próprio contador */
  rates(seconds = (performance.now() - this.t0) / 1000): Creations {
    this.sample();
    const own = this.reads - 1;
    const s = Math.max(seconds, 1e-3);
    const d = (a: number, b: number): number => Math.max(0, a - b - own) / s;
    return {
      geometries: d(this.last.geometries, this.first.geometries),
      materials: d(this.last.materials, this.first.materials),
      textures: d(this.last.textures, this.first.textures),
      objects: d(this.last.objects, this.first.objects),
    };
  }
}
