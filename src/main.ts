// Ponto de entrada: cria o renderizador e o jogo. Toda a lógica fica em app/Game.ts.
import * as THREE from 'three';
import { Game } from './app/Game';
import { t } from './i18n';
import { el } from './ui/dom';
import { setupPlanetPicker } from './ui/PlanetPicker';

const loading = el('#loading');
loading.textContent = t('boot.loadingEngine');

let renderer: THREE.WebGLRenderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
} catch (err) {
  loading.textContent = t('boot.webglError');
  throw err;
}

setupPlanetPicker();
const game = new Game(el('#game'), renderer);
loading.textContent = t('boot.generating');
// deixa o texto aparecer antes de gerar o mundo (trava a tela por um instante)
requestAnimationFrame(() =>
  setTimeout(() => {
    try {
      game.boot();
    } catch (err) {
      loading.textContent = t('boot.error', { message: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }, 30),
);
game.run();

// acesso para depuração e testes visuais (só em desenvolvimento)
if (import.meta.env.DEV) (window as unknown as { spacing: Game }).spacing = game;
