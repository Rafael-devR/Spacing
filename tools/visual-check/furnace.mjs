// Tela do forno em PixiJS (docs/design/FORNO.md, ADR 0018): abre o forno com trabalhos, toca nos botões e cartões de verdade (as
// áreas que o painel informa por `targets()`), confere calor, ventoinha, partículas e o esfriar, e tira capturas.
// Uso: node furnace.mjs [url] [pasta]
import { boot } from './lib.mjs';

const url = process.argv[2] ?? 'http://localhost:5173/';
const out = process.argv[3] ?? '/tmp/shots';
const { page, g, shot, check, finish } = await boot({ url, out, w: 844, h: 390, quality: 'baixo', test: true });
const wait = (ms) => page.waitForTimeout(ms);

/** toca no alvo `id` com o mouse (pelo canal real de eventos do Pixi) */
const tap = async (id) => {
  const r = await g((i) => window.spacing.craftPanel.furnace.targets()[i] ?? null, id);
  if (!r) return false;
  await page.mouse.click(r.x + r.w / 2, r.y + r.h / 2);
  await wait(250);
  return true;
};
const dbg = () => g(() => window.spacing.craftPanel.furnace.debug);

await g(() => {
  const s = window.spacing;
  s.base.placeInside();
  for (const [k, n] of Object.entries({ rock: 6, iron: 13, regolith: 20, basalt: 4, ice: 6, ilmenite: 2, silicon: 2, gold: 1, iron_bar: 6, glass: 4, brick: 4})) s.inventory.add(k, n, false);
  // o forno vem da bancada: fabrica e pega, como no jogo
  s.crafting.start(s.crafting.recipes('workbench').find((r) => r.id === 'furnace'));
  s.crafting.update(400);
  s.crafting.take('workbench');
});
await wait(800);
check('forno instalado', await g(() => window.spacing.crafting.isBuilt('furnace')));

// abre: a primeira vez carrega o Pixi sob demanda
const t0 = Date.now();
await g(() => window.spacing.craftPanel.show('furnace'));
await page.waitForFunction(() => window.spacing.craftPanel.furnace?.open, null, { timeout: 30000 });
check('abre o forno em Pixi (carga sob demanda)', true, `${Date.now() - t0} ms`);
await wait(1200);
await shot('furnace-1-parado');
const idle = await dbg();
check('parado: câmara fria e ventoinha parada', idle.temp < 30 && idle.fan === 0, `${idle.temp.toFixed(0)}°C`);

// escolhe a receita pelo toque, põe o lote máximo e fabrica
check('toca na receita do ferro', await tap('r:iron_bar'));
check('"Tudo" põe o lote máximo', await tap('max') && (await dbg()).batch === 5, String((await dbg()).batch));
check('toca em Fabricar', await tap('make'));
await g(() => {
  const s = window.spacing;
  s.crafting.start(s.crafting.recipes('furnace').find((r) => r.id === 'brick'), 2);
  s.crafting.start(s.crafting.recipes('furnace').find((r) => r.id === 'glass'), 3);
});
await wait(1500);
await shot('furnace-2-esquentando');
await wait(3000);
await shot('furnace-3-trabalhando');
const hot = await dbg();
check('trabalhando: câmara quente', hot.temp > 700, `${hot.temp.toFixed(0)}°C`);
check('trabalhando: ventoinha girando', hot.fan > 0.4, hot.fan.toFixed(2));
check('trabalhando: partículas (fagulhas, ar, fumaça)', hot.particles > 10, String(hot.particles));
const shares = await g(() => window.spacing.crafting.slots('furnace').map((j) => j && +j.share.toFixed(2)));
check('três trabalhos dividindo o calor', shares.every((x) => x === 0.33), JSON.stringify(shares));

// vaga escolhida
check('toca no cadinho 3', await tap('slot:2') && (await dbg()).slotSel === 2);
await shot('furnace-4-vaga');
const before = await g(() => window.spacing.inventory.count('iron_bar'));
await g(() => window.spacing.crafting.update(6));
await wait(600);
check('pega o que ficou pronto da vaga', await tap('take-slot'));
check('pausa', (await tap('pause')) && (await g(() => window.spacing.crafting.slots('furnace')[2]?.paused === true)));
await tap('pause');
await tap('cancel');
await tap('cancel');
check('cancela (com confirmação) e devolve', await g(() => window.spacing.crafting.slots('furnace')[2] === null));
void before;
await wait(400);
await shot('furnace-5-depois-de-cancelar');

// ciência da receita
await tap('r:iron_bar');
check('abre a ciência (?)', await tap('info'));
await wait(300);
await shot('furnace-6-ciencia');
await tap('info');

// tudo pronto: bandeja e pegar tudo
await g(() => window.spacing.crafting.update(500));
await wait(1500);
await shot('furnace-7-pronto');
check('há botão de pegar tudo na bandeja', await g(() => !!window.spacing.craftPanel.furnace.targets()['take']));
check('toca em Pegar tudo', await tap('take'));
// esfriando: sem trabalho a câmara esfria, e a ventoinha continua girando
await wait(2500);
const cooling = await dbg();
await shot('furnace-8-esfriando');
check('esfriando: ainda quente e com a ventoinha girando', cooling.temp > 150 && cooling.fan > 0.1, `${cooling.temp.toFixed(0)}°C, ventoinha ${cooling.fan.toFixed(2)}`);
await wait(12000);
const cold = await dbg();
check('depois de um tempo: fria e a ventoinha quase parada', cold.temp < 80 && cold.fan < 0.25, `${cold.temp.toFixed(0)}°C, ventoinha ${cold.fan.toFixed(2)}`);

// rolar a lista com o dedo (arrasto)
const r0 = await g(() => window.spacing.craftPanel.furnace.targets()['r:iron_bar']);
await page.mouse.move(r0.x + 20, r0.y + 20);
await page.mouse.down();
await page.mouse.move(r0.x + 20, r0.y - 100, { steps: 6 });
await page.mouse.up();
await wait(300);
const r1 = await g(() => window.spacing.craftPanel.furnace.targets()['r:iron_bar']);
check('a lista rola com o arrasto', !r1 || Math.abs(r1.y - r0.y) > 30, `${r0.y.toFixed(0)} → ${r1 ? r1.y.toFixed(0) : 'fora'}`);

// voltar fecha
check('voltar fecha a tela', (await tap('back')) && (await g(() => !window.spacing.craftPanel.furnace.open)));
check('o jogo recupera o controle (sem tela aberta)', await g(() => !window.spacing.craftPanel.open));

// em pé (retrato)
await page.setViewportSize({ width: 390, height: 844 });
await wait(500);
await g(() => window.spacing.craftPanel.show('furnace'));
await wait(1500);
await g(() => window.spacing.crafting.start(window.spacing.crafting.recipes('furnace').find((r) => r.id === 'brick'), 2));
await wait(2500);
await shot('furnace-9-retrato');
await finish();
