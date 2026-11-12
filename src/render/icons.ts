// Renderiza um objeto 3D em uma imagem (ícones do inventário).
import * as THREE from 'three';

export function renderIcon(renderer: THREE.WebGLRenderer, object: THREE.Object3D, size = 256): string {
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#c9c3ff', '#6b5a50', 2.2));
  const d = new THREE.DirectionalLight('#fff3e2', 3.4);
  d.position.set(-2, 4, 3);
  scene.add(d);
  const box = new THREE.Box3().setFromObject(object);
  const c = box.getCenter(new THREE.Vector3());
  const s = box.getSize(new THREE.Vector3());
  const k = 1.25 / Math.max(s.x, s.y, s.z);
  object.scale.multiplyScalar(k);
  object.position.sub(c.multiplyScalar(k));
  scene.add(object);
  const cam = new THREE.OrthographicCamera(-0.95, 0.95, 0.95, -0.95, 0.1, 20);
  cam.position.set(3, 2.6, 3);
  cam.lookAt(0, 0, 0);
  const rt = new THREE.WebGLRenderTarget(size, size);
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(scene, cam);
  const buf = new Uint8Array(size * size * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, size, size, buf);
  renderer.setRenderTarget(null);
  renderer.setClearColor(prevClear, prevAlpha);
  rt.dispose();
  // o render target sai em espaço linear: converte para sRGB
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) {
    const v = i / 255;
    lut[i] = 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
  }
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  if (!g) return '';
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const si = ((size - 1 - y) * size + x) * 4;
      const di = (y * size + x) * 4;
      img.data[di] = lut[buf[si]];
      img.data[di + 1] = lut[buf[si + 1]];
      img.data[di + 2] = lut[buf[si + 2]];
      img.data[di + 3] = buf[si + 3];
    }
  }
  g.putImageData(img, 0, 0);
  return cv.toDataURL();
}
