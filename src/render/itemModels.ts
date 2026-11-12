// Aparência 3D dos itens: usada nos ícones da barra e nos itens soltos no mundo.
import * as THREE from 'three';
import type { BlockId } from '../data/blocks';
import { ITEMS, itemBlock, type ItemId } from '../data/items';
import { meshSingle } from '../world/mesher';
import { craftedGeometry } from './craftedModels';
import type { Materials } from './materials';
import type { PropFactory } from './models';

export class ItemModels {
  private readonly blockGeos = new Map<BlockId, THREE.BufferGeometry>();
  private readonly propGeos = new Map<ItemId, THREE.BufferGeometry>();
  /** contorno branco dos itens soltos no mundo (casco invertido: a cópia aumentada só mostra o verso) */
  private readonly outlineMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.BackSide, toneMapped: false });

  constructor(
    private readonly materials: Materials,
    private readonly props: PropFactory,
  ) {}

  private blockGeo(id: BlockId): THREE.BufferGeometry {
    let g = this.blockGeos.get(id);
    if (!g) {
      const m = meshSingle(id);
      g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(m.position, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(m.normal, 3));
      g.setAttribute('color', new THREE.BufferAttribute(m.color, 3));
      g.setAttribute('aEdge', new THREE.BufferAttribute(m.edge, 2));
      g.setAttribute('aSky', new THREE.BufferAttribute(m.sky, 1));
      g.translate(-0.5, -0.5, -0.5);
      this.blockGeos.set(id, g);
    }
    return g;
  }

  private propGeo(item: ItemId): THREE.BufferGeometry {
    let g = this.propGeos.get(item);
    if (!g) {
      const icon = ITEMS[item].icon;
      g = icon?.model ? craftedGeometry(icon.model, icon.color ?? '#c3c7d2') : this.props.geos[icon?.prop ?? 'boulder'][0].clone();
      g.computeBoundingBox();
      const c = g.boundingBox?.getCenter(new THREE.Vector3()) ?? new THREE.Vector3();
      g.translate(-c.x, -c.y, -c.z);
      this.propGeos.set(item, g);
    }
    return g;
  }

  /** Malha nova (geometria compartilhada; não descartar a geometria). */
  create(item: ItemId): THREE.Mesh {
    const block = itemBlock(item);
    if (block !== undefined) return new THREE.Mesh(this.blockGeo(block), this.materials.terrain);
    return new THREE.Mesh(this.propGeo(item), this.materials.props);
  }

  /** Item solto no mundo: a malha do item com contorno branco, para ser visto de longe. */
  createOutlined(item: ItemId): THREE.Mesh {
    const m = this.create(item);
    const o = new THREE.Mesh(m.geometry, this.outlineMat);
    // blocos são cubos (contorno mais fino basta); minérios são irregulares e precisam de mais
    o.scale.setScalar(itemBlock(item) !== undefined ? 1.2 : 1.28);
    o.castShadow = false;
    o.renderOrder = -1;
    m.add(o);
    return m;
  }

  /** Malha de um bloco inteiro, centrada (efeitos de quebrar e colocar). */
  blockMesh(id: BlockId): THREE.Mesh {
    return new THREE.Mesh(this.blockGeo(id), this.materials.terrain);
  }

  /** escala para o item parecer do tamanho certo solto no mundo */
  dropScale(item: ItemId): number {
    return itemBlock(item) !== undefined ? 0.3 : 0.42;
  }
}
