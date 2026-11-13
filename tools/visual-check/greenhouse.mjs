// Teste da estufa (docs/design/ESTUFA.md): o baú da base, o holograma e o assentamento no terreno, a entrega do material peça por
// peça pelo botão de ação, a finalização (baixa → alta qualidade), a colisão (parede, porta) e o salvamento. Usa o modo de teste
// (`?teste`) só para chegar mais rápido a cada situação; o que é conferido passa pelos caminhos de verdade do jogo.
// Uso: node greenhouse.mjs <url> <pasta-de-saída>
import { boot } from './lib.mjs';

const [url = 'http://localhost:5173/', out = '/tmp'] = process.argv.slice(2);
const { page, g, shot, check, finish } = await boot({ url, out, test: true });
const run = (id, arg) => g(([i, a]) => window.spacing.testMode.run(i, a), [id, arg]);
const label = () => g(() => { const b = document.querySelector('#btn-use'); return b.hidden ? null : document.querySelector('#btn-use .use-label').textContent; });
const press = () => page.dispatchEvent('#btn-use', 'pointerdown');
const waitLabel = (re) => page.waitForFunction((s) => { const b = document.querySelector('#btn-use'); return !b.hidden && new RegExp(s).test(document.querySelector('#btn-use .use-label').textContent); }, re.source, { timeout: 20000 });
/** congela o jogo para a captura (o WebGL por software é lento) */
const freeze = async (n, cam) => {
  await g((c) => { const s = window.spacing; if (c) s.rig.snap(s.player.center()); }, cam);
  await page.waitForTimeout(1200);
  await g(() => { window.spacing.state = 'paused'; });
  await page.waitForTimeout(500);
  await shot(n);
  await g(() => { window.spacing.state = 'playing'; });
};

// ---- o baú da base ----
check('o botão do painel de teste existe para a estufa', (await g(() => window.spacing.greenhouseState.chestOpened)) === false);
await run('tp.inside');
await page.waitForFunction(() => window.spacing.base.mode === 'inside', null, { timeout: 15000 });
await g(() => {
  const s = window.spacing, L = s.base.d.layout;
  const c = L.furniture.find((f) => f.def.kind === 'crates');
  s.player.pos.set(c.use.x, c.use.y + 0.02, c.use.z);
  s.player.prevPos.copy(s.player.pos);
});
await waitLabel(/baú/i);
check('perto das caixas aparece "Abrir o baú"', /baú/i.test((await label()) ?? ''), await label());
await press();
await page.waitForFunction(() => window.spacing.inventory.count('greenhouse_plan') === 1, null, { timeout: 5000 });
const kit = await g(() => ['brick', 'iron_bar', 'basalt_fiber', 'glass'].map((k) => window.spacing.inventory.count(k)));
check('o baú deu o projeto e o material', kit[0] >= 16 && kit[1] >= 22 && kit[2] >= 3 && kit[3] >= 8, kit.join(','));
await page.waitForTimeout(300);
check('depois de aberto, o botão do baú some', !/baú/i.test((await label()) ?? ''));

// ---- holograma e assentamento ----
await run('tp.outside');
const spot = await g(() => {
  const s = window.spacing;
  // o primeiro chão que serve, perto do astronauta, fora da base
  const p = s.player.pos;
  const box = s.base.d.layout.structure.box;
  for (let r = 6; r < 40; r += 2) for (let a = 0; a < 16; a++) {
    const tx = Math.floor(p.x + Math.cos((a / 16) * 6.283) * r), tz = Math.floor(p.z + Math.sin((a / 16) * 6.283) * r);
    const c = s.greenhouseState.check(s.world, box, tx - 3, tz - 3);
    if (c.ok) return { tx, tz, floorY: c.floorY };
  }
  return null;
});
check('há um chão que serve perto da base', !!spot);
// dá para ver o holograma (fantasma) com o projeto na mão e o modo construir
await g((sp) => {
  const s = window.spacing;
  const inv = s.inventory;
  for (let i = 0; i < 8; i++) if (inv.slot(i)?.item === 'greenhouse_plan') inv.select(i);
  if (inv.selectedItem() !== 'greenhouse_plan') {
    for (let i = 8; i < 32; i++) if (inv.slot(i)?.item === 'greenhouse_plan') inv.move(i, 7);
    inv.select(7);
  }
  s.player.pos.set(sp.tx + 0.5, sp.floorY + 1.05, sp.tz + 8.5);
  s.player.prevPos.copy(s.player.pos);
  s.interaction.target = { kind: 'block', x: sp.tx, y: sp.floorY, z: sp.tz };
}, spot);
await page.waitForFunction(() => !window.spacing.interaction.worldLocked, null, { timeout: 10000 });
await g(() => window.spacing.interaction.setBuildMode(true));
await page.waitForTimeout(800);
check('o projeto na barra, no modo construir', await g(() => window.spacing.inventory.selectedItem() === 'greenhouse_plan' && window.spacing.interaction.buildMode), await g(() => JSON.stringify({ sel: window.spacing.inventory.selectedItem(), bm: window.spacing.interaction.buildMode, locked: window.spacing.interaction.worldLocked, mode: window.spacing.base.mode })));
// mira inválida: no meio da base → recusa e não gasta o projeto
const bad = await g(() => {
  const s = window.spacing, b = s.base.d.layout.structure.box;
  const ok = s.interaction.onSite(b.x0 + 3, b.y0, b.z0 + 3);
  return { ok, site: !!s.greenhouseState.site, plan: s.inventory.count('greenhouse_plan') };
});
check('perto da base: recusa, e o projeto continua na mochila', !bad.ok && !bad.site && bad.plan === 1, JSON.stringify(bad));
const placed = await g((sp) => {
  const s = window.spacing;
  const ok = s.interaction.onSite(sp.tx, sp.floorY, sp.tz);
  const site = s.greenhouseState.site;
  return { ok, site, plan: s.inventory.count('greenhouse_plan'), solid: site ? s.world.getBlock(site.x + 3, site.floorY, site.z + 3) : -1, struct: s.world.structures.some((x) => x.id === 'greenhouse') };
}, spot);
check('assentou: obra salva, projeto gasto, chão sólido e estrutura no mundo', placed.ok && placed.site && placed.plan === 0 && placed.solid === 8 && placed.struct, JSON.stringify(placed));
await g(() => window.spacing.interaction.setBuildMode(false));
// o chão sob a estufa ficou nivelado e a faixa da porta, rente ao piso
const level = await g(() => {
  const s = window.spacing, st = s.greenhouseState.site, W = s.world;
  const cols = [];
  for (let dz = 0; dz < 7; dz++) for (let dx = 0; dx < 7; dx++) {
    const x = st.x + dx, z = st.z + dz;
    cols.push(W.getBlock(x, st.floorY - 1, z) !== 0 && W.getBlock(x, st.floorY + 5, z) === 0);
  }
  const apron = [-1, 0, 1].map((d) => W.getBlock(st.x + 3 + d, st.floorY, st.z + 7) !== 0 && W.getBlock(st.x + 3 + d, st.floorY + 1, st.z + 7) === 0);
  return { under: cols.every(Boolean), apron: apron.every(Boolean) };
});
check('o terreno sob a estufa e a faixa da porta estão nivelados', level.under && level.apron, JSON.stringify(level));
await g(() => { const s = window.spacing, st = s.greenhouseState.site; s.player.pos.set(st.x + 3.5, st.floorY + 1.05, st.z + 11.5); s.player.prevPos.copy(s.player.pos); });
await freeze('estufa-1-holograma', true);

// ---- entregar peça por peça pelo botão ----
await g(() => { const s = window.spacing, st = s.greenhouseState.site; s.player.pos.set(st.x + 3.5, st.floorY + 1.05, st.z + 9.2); s.player.prevPos.copy(s.player.pos); });
await waitLabel(/Entregar: Piso/);
check('perto da obra: "Entregar: Piso"', /Entregar: Piso/.test((await label()) ?? ''), await label());
const bricks0 = await g(() => window.spacing.inventory.count('brick'));
await press();
await page.waitForFunction(() => window.spacing.greenhouseState.delivered === 1, null, { timeout: 5000 });
check('entregou o piso: o material saiu da mochila', (await g(() => window.spacing.inventory.count('brick'))) === bricks0 - 8);
await waitLabel(/Entregar: Parede sul/);
await press();
await page.waitForFunction(() => window.spacing.greenhouseState.delivered === 2, null, { timeout: 5000 });
// sem material: recusa e diz o que falta
await g(() => { window.spacing.inventory.remove('iron_bar', window.spacing.inventory.count('iron_bar')); });
await waitLabel(/Entregar: Parede oeste/);
await press();
await page.waitForTimeout(400);
check('sem material não entrega', (await g(() => window.spacing.greenhouseState.delivered)) === 2);
const toast = await g(() => document.querySelector('#toasts, .toast')?.textContent ?? '');
check('avisa o que falta', /Faltam/.test(toast), toast.slice(0, 60));
await g(() => window.spacing.inventory.add('iron_bar', 30, false));
await press();
await page.waitForFunction(() => window.spacing.greenhouseState.delivered === 3, null, { timeout: 5000 });
// colisão: a parede sul está fechada, o vão da porta, não
const col = await g(() => {
  const s = window.spacing, st = s.greenhouseState.site, W = s.world;
  return {
    wall: W.getBlock(st.x + 1, st.floorY + 1, st.z + 6), door: W.getBlock(st.x + 3, st.floorY + 1, st.z + 6), lintel: W.getBlock(st.x + 3, st.floorY + 3, st.z + 6),
    northOpen: W.getBlock(st.x + 1, st.floorY + 1, st.z), 
  };
});
check('parede sul sólida, vão da porta livre, parede norte ainda não existe', col.wall === 8 && col.door === 0 && col.lintel === 8 && col.northOpen === 0, JSON.stringify(col));
await freeze('estufa-2-baixa-qualidade', true);

// ---- o resto e a finalização ----
for (let i = 0; i < 4; i++) {
  await g(() => { const s = window.spacing, st = s.greenhouseState.site; s.player.pos.set(st.x + 3.5, st.floorY + 1.05, st.z + 9.2); s.player.prevPos.copy(s.player.pos); });
  await waitLabel(/Entregar/);
  await press();
  await page.waitForFunction((n) => window.spacing.greenhouseState.delivered === n, 4 + i, { timeout: 5000 });
}
await waitLabel(/Finalizar/);
check('com todas as peças, o botão vira "Finalizar a estufa"', /Finalizar/.test((await label()) ?? ''));
await freeze('estufa-3-todas-baixa', true);
await press();
await page.waitForFunction(() => window.spacing.greenhouseState.done, null, { timeout: 5000 });
check('finalizada', await g(() => window.spacing.greenhouseState.done));
await page.waitForTimeout(500);
check('depois de pronta, o botão some', !/Finalizar|Entregar/.test((await label()) ?? ''));
await freeze('estufa-4-alta-qualidade', true);
// entrar pela porta: o astronauta chega dentro
await g(() => { const s = window.spacing, st = s.greenhouseState.site; s.player.pos.set(st.x + 3.5, st.floorY + 1.05, st.z + 9.5); s.player.prevPos.copy(s.player.pos); });
const inside = await g(async () => {
  const s = window.spacing, st = s.greenhouseState.site, V = s.player.pos.constructor;
  const t0 = performance.now();
  while (performance.now() - t0 < 90000) {
    if (!s.interaction.walkGoal) s.interaction.walkGoal = { pos: new V(st.x + 3.5, st.floorY + 1, st.z + 3.5), reach: false };
    await new Promise((r) => setTimeout(r, 200));
    if (s.player.pos.z < st.z + 4.5) break;
  }
  return { z: s.player.pos.z - st.z, y: s.player.pos.y - st.floorY };
});
check('o astronauta entra pela porta (não fica preso) e anda sobre o piso', inside.z < 5 && inside.y > 0.9 && inside.y < 1.6, JSON.stringify(inside));
await g(() => { const s = window.spacing, st = s.greenhouseState.site; s.player.pos.set(st.x + 3.5, st.floorY + 1.05, st.z + 4.5); s.player.prevPos.copy(s.player.pos); });
await freeze('estufa-5-dentro', true);

// ---- salvamento ----
await g(() => window.spacing['persist']());
await page.reload();
await page.waitForSelector('#btn-start:not([disabled])', { timeout: 120000 });
await page.click('#btn-start');
await page.waitForFunction(() => document.body.dataset.state === 'playing', null, { timeout: 15000 });
const back = await g(() => {
  const s = window.spacing, st = s.greenhouseState.site;
  return { done: s.greenhouseState.done, parts: st?.parts.length, chest: s.greenhouseState.chestOpened, struct: s.world.structures.some((x) => x.id === 'greenhouse'), wall: st ? s.world.getBlock(st.x + 1, st.floorY + 1, st.z + 6) : -1 };
});
check('recarregar: a estufa pronta volta, com a colisão e o baú aberto', back.done && back.parts === 7 && back.chest && back.struct && back.wall === 8, JSON.stringify(back));

// ---- ações do modo de teste ----
let r = await run('gh.remove');
check('teste: desmontar a obra', r.ok && !(await g(() => window.spacing.greenhouseState.site)), r.msg);
r = await run('gh.site');
check('teste: assentar a obra perto', r.ok && !!(await g(() => window.spacing.greenhouseState.site)), r.msg);
r = await run('gh.build');
check('teste: construir tudo', r.ok && (await g(() => window.spacing.greenhouseState.done)), r.msg);

// ---- cultivo: canteiro, solo, plantar, regar, colher ----
const inv0 = await g(() => ['planter', 'soil', 'potato'].map((k) => window.spacing.inventory.count(k)));
check('o baú também deu o kit de cultivo', inv0[0] >= 2 && inv0[1] >= 4 && inv0[2] >= 4, inv0.join(','));
await run('tp.greenhouse');
const bedCell = await g(() => {
  const s = window.spacing, st = s.greenhouseState.site, inv = s.inventory;
  for (let i = 8; i < 32; i++) if (inv.slot(i)?.item === 'planter') inv.move(i, 6);
  for (let i = 0; i < 8; i++) if (inv.slot(i)?.item === 'planter') inv.select(i);
  s.player.pos.set(st.x + 3.5, st.floorY + 1.05, st.z + 3.5);
  s.player.prevPos.copy(s.player.pos);
  return { x: st.x + 1, z: st.z + 2, y: st.floorY };
});
await page.waitForFunction(() => !window.spacing.interaction.worldLocked, null, { timeout: 10000 });
await g(() => window.spacing.interaction.setBuildMode(true));
const bad2 = await g((c) => window.spacing.interaction.onSite(c.x - 1, c.y + 1, c.z), bedCell);
check('canteiro na parede: recusa', !bad2);
const bed = await g((c) => {
  const s = window.spacing;
  const ok = s.interaction.onSite(c.x, c.y, c.z);
  s.interaction.setBuildMode(false);
  return { ok, beds: s.greenhouseState.site.beds.length, solid: s.world.getBlock(c.x, c.y + 1, c.z) };
}, bedCell);
check('canteiro no piso da estufa: no lugar e sólido', bed.ok && bed.beds === 1 && bed.solid === 8, JSON.stringify(bed));
await g((c) => { const s = window.spacing; s.player.pos.set(c.x + 1.9, c.y + 1.05, c.z + 0.5); s.player.prevPos.copy(s.player.pos); s.inventory.remove('ice', 999); }, bedCell);
await waitLabel(/Encher com solo/);
await press();
await waitLabel(/Plantar batata/);
await press();
await page.waitForFunction(() => !!window.spacing.greenhouseState.site.beds[0].crop, null, { timeout: 5000 });
check('encheu de solo e plantou (a batata saiu da mochila)', (await g(() => window.spacing.inventory.count('potato'))) === inv0[2] - 1);
await g(() => window.spacing.inventory.add('ice', 2, false));
await waitLabel(/Regar/);
await press();
await page.waitForFunction(() => window.spacing.greenhouseState.site.beds[0].water === 1, null, { timeout: 5000 });
check('regou com gelo', (await g(() => window.spacing.inventory.count('ice'))) === 1);
const g0 = await g(() => window.spacing.greenhouseState.site.beds[0].crop.growth);
await page.waitForTimeout(3000);
const g1 = await g(() => window.spacing.greenhouseState.site.beds[0].crop.growth);
check('a batata cresce com o tempo', g1 > g0, `${g0.toFixed(4)} → ${g1.toFixed(4)}`);
await run('gh.ripe');
await waitLabel(/Colher/);
const p0 = await g(() => window.spacing.inventory.count('potato'));
await press();
await page.waitForFunction((n) => window.spacing.inventory.count('potato') === n + 3, p0, { timeout: 5000 });
check('colheu 3 batatas e o canteiro ficou com solo, vazio', await g(() => { const b = window.spacing.greenhouseState.site.beds[0]; return b.soil && !b.crop; }));

// ---- fome: comer batata ----
await run('gh.hungry');
await g((c) => {
  const s = window.spacing, inv = s.inventory;
  for (let i = 8; i < 32; i++) if (inv.slot(i)?.item === 'potato') inv.move(i, 5);
  for (let i = 0; i < 8; i++) if (inv.slot(i)?.item === 'potato') inv.select(i);
  s.player.pos.set(c.x + 2.5, c.y + 1.05, c.z + 2.5);
  s.player.prevPos.copy(s.player.pos);
}, bedCell);
await waitLabel(/Comer batata/);
check('com fome e batata na mão: "Comer batata"', /Comer batata/.test((await label()) ?? ''), await label());
await press();
await page.waitForFunction(() => window.spacing.survival.energy >= 44, null, { timeout: 5000 });
check('comer devolve energia', (await g(() => Math.round(window.spacing.survival.energy))) >= 44);
check('medidor de energia no HUD', await g(() => !!document.querySelector('#meter-energy') && document.querySelector('#meter-energy .m-val').textContent !== ''));

// ---- captura dos estágios ----
r = await run('gh.farm');
check('teste: plantar canteiros', r.ok, r.msg);
await g(() => {
  const s = window.spacing, st = s.greenhouseState.site;
  const growth = [0.05, 0.3, 0.6, 0.85, 1];
  st.beds.forEach((b, i) => { if (b.crop) { b.crop.growth = growth[i % growth.length]; b.water = i === 2 ? 0 : 1; } });
  s.player.pos.set(st.x + 3.5, st.floorY + 1.05, st.z + 4.5);
  s.player.prevPos.copy(s.player.pos);
  s.rig.distTarget = 16; s.rig.dist = 16;
});
await freeze('estufa-6-canteiros', true);

await finish();
