// Tela de itens (docs/design/INVENTARIO.md, ESTACOES.md, ADR 0019): mexe nos itens com o mouse como um dedo (arrastar, segurar para
// pegar metade, tocar e tocar, toque duplo, Organizar), solta itens na entrada do forno, fabrica, pega pela saída, usa as vagas
// (pausar, cancelar) e abre a energia. Tira capturas deitado e em pé.
// Uso: node inventory.mjs <url> <pasta-de-saída>
import { boot } from './lib.mjs';

const [url = 'http://localhost:5173/', out = '/tmp/shots'] = process.argv.slice(2);
const { page, g, shot, check, finish } = await boot({ url, out });
const S = (n) => `inv-${n}`;

/** centro de um espaço do inventário */
const cell = async (i) => {
  const r = await page.locator(`#inv .slot[data-inv="${i}"]`).boundingBox();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
};
const center = async (sel) => {
  const r = await page.locator(sel).first().boundingBox();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
};
/** arrasta de um ponto a outro em passos (como um dedo) */
const drag = async (a, b, { hold = 0 } = {}) => {
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  if (hold) await page.waitForTimeout(hold);
  for (let k = 1; k <= 8; k++) await page.mouse.move(a.x + ((b.x - a.x) * k) / 8, a.y + ((b.y - a.y) * k) / 8);
  await page.mouse.up();
  await page.waitForTimeout(120);
};
const tap = async (p) => {
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(60);
};
const slot = (i) => g((k) => window.spacing.inventory.slot(k), i);
const hit = async (id) => {
  const r = await g((i) => window.spacing.craftPanel.hits.find((h) => h.id === i) ?? null, id);
  if (!r) return false;
  await page.mouse.click(r.x + r.w / 2, r.y + r.h / 2);
  await page.waitForTimeout(200);
  return true;
};

// inventário conhecido: pedra na barra (0), ferro (1), regolito (2), gelo (3)
await g(() => {
  const s = window.spacing;
  s.base.placeInside();
  s.inventory.takeEverything();
  s.inventory.add('rock', 30, false);
  s.inventory.add('iron', 13, false);
  s.inventory.add('regolith', 40, false);
  s.inventory.add('ice', 6, false);
  s.crafting.unlock('furnace');
});

// ---------- mochila ----------
await page.keyboard.press('i');
await page.waitForTimeout(400);
check('mochila abre (traje + inventário)', await page.isVisible('#bag') && await page.isVisible('#bag-grid'));
await shot(S('1-mochila'));

await drag(await cell(0), await cell(10));
check('arrastar leva a pilha inteira', JSON.stringify([await slot(0), await slot(10)]) === JSON.stringify([null, { item: 'rock', n: 30 }]));

await drag(await cell(10), await cell(11), { hold: 520 });
check('segurar e arrastar leva metade', (await slot(10))?.n === 15 && (await slot(11))?.n === 15, JSON.stringify([await slot(10), await slot(11)]));

await drag(await cell(11), await cell(10));
check('soltar no mesmo item junta', (await slot(10))?.n === 30 && (await slot(11)) === null);

await tap(await cell(1));
const held = await g(() => document.querySelector('#inv .slot[data-inv="1"]').classList.contains('held'));
await tap(await cell(12));
check('tocar e tocar move', held && (await slot(12))?.item === 'iron' && (await slot(1)) === null);

await drag(await cell(12), await cell(10));
check('soltar sobre outro item troca', (await slot(12))?.item === 'rock' && (await slot(10))?.item === 'iron');

const c10 = await cell(10);
await tap(c10);
await tap(c10);
check('toque duplo manda para a barra', (await slot(10)) === null && (await g(() => window.spacing.inventory.serialize().slots.slice(0, 8).some((s) => s?.item === 'iron'))));

await page.mouse.click((await cell(2)).x, (await cell(2)).y, { button: 'right' });
await tap(await cell(20));
check('botão direito pega metade', (await slot(20))?.n === 20 && (await slot(2))?.n === 20, JSON.stringify([await slot(2), await slot(20)]));

const before = await g(() => window.spacing.inventory.totals());
await drag(await cell(20), { x: 30, y: 30 });
check('soltar fora não muda nada', JSON.stringify(await g(() => window.spacing.inventory.totals())) === JSON.stringify(before) && (await slot(20))?.n === 20);

await page.click('#inv [data-hit="sort"]');
await page.waitForTimeout(150);
check('Organizar junta e ordena a mochila', (await slot(8))?.item !== undefined && (await g(() => window.spacing.inventory.serialize().slots.slice(8).filter(Boolean).length)) >= 1);
await tap(await cell(3));
await shot(S('2-mochila-escolhido'));
check('detalhe do item escolhido', /Gelo/i.test((await page.textContent('#bag .bag-detail')) ?? ''), (await page.textContent('#bag .bag-detail'))?.slice(0, 40));
await tap(await cell(3));
await page.click('#bag-close');
await page.waitForTimeout(200);
check('mochila fecha', !(await page.isVisible('#inv')));

// ---------- forno ----------
await g(() => window.spacing.craftPanel.show('furnace'));
await page.waitForTimeout(500);
check('forno abre com o inventário ao lado', await page.isVisible('#craft') && await page.isVisible('#bag-grid'));
const ironAt = await g(() => window.spacing.inventory.serialize().slots.findIndex((s) => s?.item === 'iron'));
await drag(await cell(ironAt), await center('#craft .st-in'));
const dbg1 = await g(() => window.spacing.craftPanel.debug);
check('soltar ferro na entrada escolhe a barra de ferro e o lote', dbg1.selected === 'iron_bar' && dbg1.batch === 6, JSON.stringify(dbg1));
check('nada sai do inventário antes de Fabricar', (await g(() => window.spacing.inventory.count('iron'))) === 13);
const iceAt = await g(() => window.spacing.inventory.serialize().slots.findIndex((s) => s?.item === 'ice'));
await drag(await cell(iceAt), await center('#craft .st-in'));
check('item que a estação não usa é recusado', /não usa/.test((await page.textContent('#craft .st-rsub')) ?? ''), await page.textContent('#craft .st-rsub'));
check('toca em Fabricar', await hit('make'));
await page.waitForTimeout(2200);
check('forno trabalhando e esquentando', (await g(() => window.spacing.craftPanel.debug.temp)) > 300 && (await g(() => window.spacing.crafting.working('furnace'))));
await shot(S('3-forno-trabalhando'));
const regAt = await g(() => window.spacing.inventory.serialize().slots.findIndex((s) => s?.item === 'regolith'));
const rc = await cell(regAt);
await tap(rc);
await tap(rc);
check('toque duplo no regolito escolhe uma receita de regolito', ['brick', 'glass'].includes((await g(() => window.spacing.craftPanel.debug.selected))));
check('segundo trabalho', (await hit('make')) && (await g(() => window.spacing.crafting.slots('furnace').filter(Boolean).length)) === 2);
check('toca na vaga 2', (await hit('slot:1')) && (await g(() => window.spacing.craftPanel.debug.slotSel)) === 1);
check('pausa', (await hit('pause')) && (await g(() => window.spacing.crafting.slots('furnace')[1]?.paused === true)));
await shot(S('4-vaga'));
await hit('cancel');
await hit('cancel');
check('cancela com confirmação', await g(() => window.spacing.crafting.slots('furnace')[1] === null));
await g(() => window.spacing.crafting.update(5000));
await page.waitForTimeout(500);
check('saída acende com o pronto', await g(() => document.querySelector('#craft .st-out-slot').classList.contains('ready')));
await shot(S('5-pronto'));
await drag(await center('#craft .st-out-slot'), await cell(25));
check('arrastar a saída para o inventário pega', (await g(() => window.spacing.inventory.count('iron_bar'))) === 6 && !(await g(() => window.spacing.crafting.hasReady('furnace'))));
check('ciência (i)', (await hit('info')) && (await page.isVisible('#craft .st-info')));
await hit('info');
check('voltar fecha', (await hit('back')) && !(await g(() => window.spacing.craftPanel.open)));

// ---------- trancada e energia ----------
await g(() => window.spacing.craftPanel.show('electrolyzer'));
await page.waitForTimeout(300);
check('eletrolisador não instalado: aviso', await page.isVisible('#craft .st-locked'));
await g(() => window.spacing.craftPanel.close());
await g(() => window.spacing.powerPanel.show());
await page.waitForTimeout(500);
await shot(S('6-energia'));
const back = await g(() => window.spacing.powerPanel.hits.find((h) => h.id === 'back'));
await page.mouse.click(back.x + back.w / 2, back.y + back.h / 2);
await page.waitForTimeout(200);
check('energia fecha', !(await g(() => window.spacing.powerPanel.open)));

// ---------- em pé ----------
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(400);
await g(() => window.spacing.craftPanel.show('furnace'));
await page.waitForTimeout(600);
await shot(S('7-forno-em-pe'));
const ironBarAt = await g(() => window.spacing.inventory.serialize().slots.findIndex((s) => s?.item === 'iron_bar'));
await drag(await cell(ironBarAt), await cell(31));
check('em pé: arrastar funciona', (await slot(31))?.item === 'iron_bar');
await g(() => window.spacing.craftPanel.close());
await page.keyboard.press('i');
await page.waitForTimeout(300);
await shot(S('8-mochila-em-pe'));
await page.keyboard.press('i');
await finish();
