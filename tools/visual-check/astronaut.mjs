// Teste do astronauta (docs/design/PERSONAGEM.md): modelo do Blender carregado com o esqueleto, animações (parado, andando,
// correndo, pulando, caindo, pousando, minerando, segurando item, comendo, dano, morte) e a poeira dos pés (cor do chão, nada
// dentro da base). Tira capturas de perto em cada situação.
// Uso: node astronaut.mjs [url] [pasta]
import { boot } from './lib.mjs';

const url = process.argv[2] ?? 'http://localhost:5173/';
const out = process.argv[3] ?? '/tmp/shots';
const { page, g, shot, check, finish } = await boot({ url, out, w: 900, h: 600, test: true, quality: 'alto' });
const wait = (ms) => page.waitForTimeout(ms);

// câmera bem perto do astronauta
await g(() => {
  const r = window.spacing.rig;
  r.min = 5;
  r.distTarget = 7;
});
await wait(800);

const info = await g(() => {
  const m = window.spacing.player.model;
  return { joints: Object.keys(m.joints).length, drill: !!m.drill, grip: !!m.grip };
});
check('modelo do Blender com o esqueleto inteiro', info.joints === 16 && info.drill && info.grip, JSON.stringify(info));
await shot('astro-1-parado');

// andar/correr: segura a tecla
await page.keyboard.down('d');
await wait(250);
await shot('astro-2-arrancando');
await wait(700);
const puffs = await g(() => window.spacing.puffs.active);
await shot('astro-3-correndo');
check('a corrida levanta poeira', puffs > 0, `${puffs} baforadas`);
await page.keyboard.down(' ');
await wait(120);
await page.keyboard.up(' ');
await wait(150);
await shot('astro-4-pulo-subindo');
await wait(550);
await shot('astro-5-pulo-descendo');
await page.keyboard.up('d');
await wait(1200);

// queda longa: os braços se agitam
await g(() => window.spacing.testMode.run('tp.up'));
await wait(900);
await shot('astro-6-caindo');
await page.waitForFunction(() => window.spacing.player.onGround, null, { timeout: 15000 });
await wait(60);
await shot('astro-7-pousando');
await wait(1500);

// item na mão
await g(() => window.spacing.testMode.run('items.all'));
await wait(400);
const held = await g(() => window.spacing.player.model.grip.children.filter((c) => c !== window.spacing.player.model.drill).length);
check('segura o item da barra', held === 1, `${held} na luva`);
await shot('astro-8-item');
await g(() => window.spacing.player.gesture('eat'));
await wait(350);
await shot('astro-9-comendo');
await wait(1000);
await g(() => window.spacing.player.hurt());
await wait(120);
await shot('astro-10-dano');
await wait(800);

// minerando: força o estado por um instante (a Interaction refaz a cada quadro; aqui a pose é o que interessa)
await g(() => {
  const s = window.spacing;
  s.__mine = setInterval(() => { s.player.mining = true; }, 5);
});
await wait(500);
await shot('astro-11-minerando');
await g(() => clearInterval(window.spacing.__mine));
await wait(500);

// à toa: espera um gesto
await wait(7500);
await shot('astro-12-a-toa');

// dentro da base: anda e não levanta poeira
await g(() => { window.spacing.puffs.clear(); window.spacing.testMode.run('tp.inside'); });
await wait(1500);
await page.keyboard.down('a');
await wait(1200);
await page.keyboard.up('a');
const inside = await g(() => window.spacing.puffs.active);
check('sem poeira dentro da base', inside === 0, `${inside} baforadas`);
await shot('astro-13-base');
await g(() => window.spacing.testMode.run('tp.outside'));
await wait(1200);

await g(() => window.spacing.testMode.run('player.kill'));
await wait(1600);
await shot('astro-14-morto');
await finish();
