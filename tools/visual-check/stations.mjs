// Telas cheias das estações e da energia (docs/design/CRAFTING.md, ENERGIA.md): abre cada uma com trabalhos em
// andamento e tira capturas. Toca nos botões de verdade (as áreas que a tela desenha a cada quadro).
// Uso: node stations.mjs <url> <pasta-de-saída> [largura] [altura]
import chromium from '@sparticuz/chromium';
import { chromium as pw } from 'playwright-core';

const [url = 'http://localhost:5173/', out = '/tmp', W = '844', H = '390'] = process.argv.slice(2);
const browser = await pw.launch({
  executablePath: await chromium.executablePath(),
  args: [...chromium.args, '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  headless: true,
});
const ctx = await browser.newContext({ viewport: { width: +W, height: +H }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await ctx.addInitScript(() => {
  try {
    localStorage.clear();
    localStorage.setItem('spacing.prefs.v1', JSON.stringify({ quality: 'baixo', muted: true, shake: 'off', vibration: false }));
  } catch {}
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const results = [];
const check = (name, ok, detail = '') => results.push(`${ok ? 'OK  ' : 'FALHOU'} ${name}${detail ? ' (' + detail + ')' : ''}`);
const g = (fn, arg) => page.evaluate(fn, arg);
const shot = (n) => page.screenshot({ path: `${out}/st-${n}.png` });
/** toca no botão `id` que a tela desenhou neste quadro */
const tap = async (panel, id) => {
  const r = await g(([p, i]) => window.spacing[p].hits.find((h) => h.id === i) ?? null, [panel, id]);
  if (!r) return false;
  await page.mouse.click(r.x + r.w / 2, r.y + r.h / 2);
  await page.waitForTimeout(250);
  return true;
};

await page.goto(url);
await page.waitForSelector('#btn-start:not([disabled])', { timeout: 120000 });
await page.click('#btn-start');
await page.waitForTimeout(1500);
await g(() => {
  const s = window.spacing;
  s.base.placeInside();
  for (const [k, n] of Object.entries({ rock: 6, iron: 13, regolith: 20, basalt: 4, ice: 6, ilmenite: 2, silicon: 2, gold: 1, iron_bar: 6, glass: 4, brick: 4 })) s.inventory.add(k, n, false);
});
await page.waitForTimeout(800);

// bancada: forno solar
await g(() => window.spacing.craftPanel.show('workbench'));
await page.waitForTimeout(800);
await shot('1-bancada');
check('bancada: toca na receita do forno', await tap('craftPanel', 'r:furnace'));
check('bancada: toca em Fazer', await tap('craftPanel', 'make'));
await page.waitForTimeout(1500);
await shot('2-bancada-trabalhando');
await g(() => window.spacing.crafting.update(400));
await page.waitForTimeout(600);
await shot('3-bancada-pronta');
check('bancada: Pegar tudo', await tap('craftPanel', 'take'));
await page.waitForTimeout(1200);
check('forno instalado', await g(() => window.spacing.crafting.isBuilt('furnace')));
await tap('craftPanel', 'back');
check('voltar fecha a tela', await g(() => !window.spacing.craftPanel.open));

// forno: três vagas, lote de ferro
await g(() => {
  const s = window.spacing;
  s.crafting.start(s.crafting.recipes('furnace').find((r) => r.id === 'brick'), 2);
  s.crafting.start(s.crafting.recipes('furnace').find((r) => r.id === 'glass'), 3);
  s.craftPanel.show('furnace');
});
await page.waitForTimeout(500);
await tap('craftPanel', 'r:iron_bar');
await tap('craftPanel', 'max');
const batch = await g(() => window.spacing.craftPanel.batch);
check('forno: "Tudo" põe o lote máximo de ferro (10 minérios → 5 barras)', batch === 5, String(batch));
await tap('craftPanel', 'make');
await g(() => window.spacing.crafting.update(12));
await page.waitForTimeout(2500);
await shot('4-forno-3-vagas');
const shares = await g(() => window.spacing.crafting.slots('furnace').map((j) => j && +j.share.toFixed(2)));
check('forno: três trabalhos dividindo o calor', shares.every((x) => x === 0.33), JSON.stringify(shares));
// vaga escolhida: pegar o que já ficou pronto, pausar e cancelar
await tap('craftPanel', 'slot:2');
await page.waitForTimeout(300);
await shot('4b-vaga');
const before = await g(() => window.spacing.inventory.count('iron_bar'));
check('pega as barras que já ficaram prontas, sem esperar o lote', await tap('craftPanel', 'take-slot'));
const after = await g(() => window.spacing.inventory.count('iron_bar'));
check('as barras prontas entraram na mochila', after > before, `${before} → ${after}`);
await tap('craftPanel', 'pause');
check('pausa a vaga', await g(() => window.spacing.crafting.slots('furnace')[2]?.paused === true));
await tap('craftPanel', 'pause');
await tap('craftPanel', 'cancel');
await tap('craftPanel', 'cancel');
check('cancela (com confirmação) e devolve os minérios', await g(() => window.spacing.crafting.slots('furnace')[2] === null && window.spacing.inventory.count('iron') > 0));
await tap('craftPanel', 'info');
await page.waitForTimeout(400);
await shot('5-forno-ciencia');
await tap('craftPanel', 'back');

// eletrolisador sem energia: bateria vazia e muito consumo
await g(() => {
  const s = window.spacing;
  s.crafting.start(s.crafting.recipes('workbench').find((r) => r.id === 'electrolyzer'));
  s.crafting.update(400);
  s.crafting.take('workbench');
  s.crafting.start(s.crafting.recipes('electrolyzer').find((r) => r.id === 'water'), 3);
  s.crafting.start(s.crafting.recipes('electrolyzer').find((r) => r.id === 'silicon'));
  s.power.battery = 0;
  s.craftPanel.show('electrolyzer');
});
await page.waitForTimeout(2500);
await shot('6-eletrolisador');
const slow = await g(() => window.spacing.power.satisfaction);
check('sem bateria, o eletrolisador anda mais devagar', slow < 1, slow.toFixed(2));
await tap('craftPanel', 'back');

// energia da base
await g(() => window.spacing.powerPanel.show());
await page.waitForTimeout(2000);
await shot('7-energia');
await tap('powerPanel', 'back');
check('energia fecha no voltar', await g(() => !window.spacing.powerPanel.open));

// retrato
await page.setViewportSize({ width: +H, height: +W });
await g(() => window.spacing.craftPanel.show('furnace'));
await page.waitForTimeout(1500);
await shot('8-retrato');

check('sem erros no console', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(results.join('\n'));
await browser.close();
process.exit(results.some((r) => r.startsWith('FALHOU')) ? 1 : 0);
