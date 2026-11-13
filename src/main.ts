// Ponto de entrada (docs/design/TITULO.md): cria o renderizador e mostra a tela de título, que é leve (estrelas e o planeta). O jogo
// só é importado e montado depois de "Jogar", na tela de carregamento, em etapas: o código, os modelos do Blender, o mundo com a
// semente certa, o terreno em volta, a base e o astronauta no lugar, os materiais compilados, os ícones, o som e os primeiros quadros.
// Toda a lógica do jogo fica em app/Game.ts.
import * as THREE from 'three';
import { PLANETS } from './data/planets';
import { t } from './i18n';
import { el } from './ui/dom';
import { LoadingScreen, type LoadStep } from './ui/title/LoadingScreen';
import { TitleScreen, type PlayOptions } from './ui/title/TitleScreen';

const container = el('#game');
let renderer: THREE.WebGLRenderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
} catch (err) {
  el('#title-error').textContent = t('boot.webglError');
  el('#title-error').hidden = false;
  throw err;
}
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
container.appendChild(renderer.domElement);
document.body.dataset.state = 'title';

const title = new TitleScreen(renderer);
const loading = new LoadingScreen();
title.onPlay = (o) => void play(o);
title.show();

/** espera um quadro (a barra de progresso aparece antes de cada etapa pesada) */
const nextFrame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));

async function play(o: PlayOptions): Promise<void> {
  const planet = PLANETS[title.planetId];
  title.hide();
  loading.show(planet);
  const step = (id: LoadStep, f: number): void => loading.set(id, f);
  try {
    await nextFrame();
    // 1) o código do jogo (só agora: o planeta da sessão é fixado aqui, com a escolha das configurações)
    step('code', 0.1);
    const [{ Game }, { loadModels }] = await Promise.all([import('./app/Game'), import('./render/gltfModels')]);
    step('code', 1);
    // 2) os modelos do Blender (se algum falhar, o jogo usa o feito em código)
    await loadModels((done, total) => step('models', done / total));
    // 3) o mundo: salvamento, semente (a do salvamento, ou sorteada num jogo novo) e os sistemas
    step('world', 0);
    await nextFrame();
    const game = new Game(container, renderer, { newGame: o.newGame });
    if (import.meta.env.DEV) (window as unknown as { spacing: typeof game }).spacing = game;
    step('world', 1);
    // 4) terreno, base, materiais, ícones e som
    await game.boot((s, f) => step(s, f));
    // 5) primeiros quadros já desenhados por trás da tela de carregamento (o jogo começa sem engasgar)
    game.run();
    for (let i = 0; i < 4; i++) {
      step('frames', i / 4);
      await nextFrame();
    }
    loading.hide();
    game.start();
    if (import.meta.env.DEV) console.info('carregamento (ms):', loading.times);
  } catch (err) {
    loading.fail(err instanceof Error ? err.message : String(err));
    throw err;
  }
}
