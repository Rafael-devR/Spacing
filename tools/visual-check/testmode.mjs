// Teste do modo de teste (docs/design/TESTE.md): abre `?teste`, roda TODAS as ações do painel pela mesma porta que o celular
// usa (`window.spacing.testMode.run`) e confere o efeito de cada uma. Em vez de esperar o jogo acontecer, cada coisa é pedida
// e conferida na hora: o teste inteiro leva poucos minutos mesmo com o WebGL por software.
// Uso: node testmode.mjs <url> <pasta-de-saída>
import { boot } from './lib.mjs';

const [url = 'http://localhost:5173/', out = '/tmp'] = process.argv.slice(2);
const { page, g, shot, check, finish } = await boot({ url, out, test: true });
const t0 = Date.now();

/** roda uma ação do painel e devolve { ok, msg } */
const run = (id, arg) => g(([i, a]) => window.spacing.testMode.run(i, a), [id, arg]);
const S = (fn) => g(fn);

// ---- o modo ----
check('modo de teste ligado (classe no corpo, painel e botão)', await S(() => document.body.classList.contains('test-mode') && !document.querySelector('#btn-test').hidden));
check('o executor existe só no modo de teste', await S(() => !!window.spacing.testMode));

// ---- painel (toque de verdade) ----
await page.click('#btn-test');
check('o botão abre o painel', await page.isVisible('#testpanel'));
const nButtons = await S(() => document.querySelectorAll('#testpanel .tp-btn').length);
check('o painel desenha botões para todas as ações', nButtons > 80, `${nButtons} botões`);
await page.click('#testpanel summary:has-text("Itens")');
await page.click('#testpanel .tp-seg-btn:has-text("64")');
await page.click('#testpanel .tp-btn:has-text("Ferro")');
const fb = await S(() => document.querySelector('.tp-feedback').textContent);
check('tocar num item dá o item e mostra o resultado', /\+64/.test(fb) && (await S(() => window.spacing.inventory.count('iron'))) === 64, fb);
await shot('teste-painel');
await page.click('#testpanel .tp-close');
check('o botão de fechar fecha o painel', !(await page.isVisible('#testpanel')));

// ---- itens e equipamento ----
await run('qty', 1);
let r = await run('items.all');
check('um de cada: todos os tipos entram', r.ok && (await S(() => window.spacing.inventory.count('crystal'))) >= 1, r.msg);
r = await run('items.clear');
check('esvaziar a mochila', r.ok && (await S(() => window.spacing.inventory.count('iron'))) === 0, r.msg);
await run('gear.map');
check('equipar o mapa', await S(() => window.spacing.equipment.has('map')));
await run('gear.drill_crystal');
check('equipar a broca de cristal', await S(() => window.spacing.equipment.has('drill_crystal')));
await run('gear.stations');
check('instalar as estações', await S(() => window.spacing.crafting.isBuilt('furnace') && window.spacing.crafting.isBuilt('electrolyzer')));
r = await run('gear.craft');
check('concluir fabricações (sem nada andando)', r.ok, r.msg);
await run('gear.power');
check('bateria da base cheia', await S(() => { const p = window.spacing.power; return p.battery >= p.capacity - 1e-6; }));

// ---- astronauta ----
await S(() => { window.spacing.survival.o2 = 40; });
await run('player.fill');
check('encher o traje', await S(() => window.spacing.survival.o2 === 100));
r = await run('player.immortal');
check('imortal liga', /ligado/.test(r.msg) && (await S(() => window.spacing.survival.immortal)));
await run('player.immortal');
const p0 = await S(() => window.spacing.player.pos.toArray());
await run('tp.forward');
const p1 = await S(() => window.spacing.player.pos.toArray());
check('ir 30 blocos à frente', Math.hypot(p1[0] - p0[0], p1[2] - p0[2]) > 25, `${Math.round(Math.hypot(p1[0] - p0[0], p1[2] - p0[2]))} blocos`);
await run('tp.up');
check('subir 25 blocos', (await S(() => window.spacing.player.pos.y)) > p1[1] + 20);
await run('tp.lander');
check('ir ao módulo de pouso', await S(() => Math.hypot(window.spacing.player.pos.x + 3, window.spacing.player.pos.z + 2) < 8));
await run('tp.door');
await page.waitForTimeout(300);
check('ir à porta da base', await S(() => { const o = window.spacing.base.outsidePoint, p = window.spacing.player.pos; return Math.hypot(p.x - o.x, p.z - o.z) < 2; }));
r = await run('tp.inside');
await page.waitForTimeout(500);
check('entrar na base já', r.ok && (await S(() => window.spacing.base.mode)) === 'inside' && (await S(() => window.spacing.indoors.on)));
await shot('teste-dentro');
await run('tp.outside');
await page.waitForTimeout(500);
check('sair da base já', (await S(() => window.spacing.base.mode)) === 'outside' && !(await S(() => window.spacing.indoors.on)));

// ---- meteoros ----
await run('meteor.auto');
check('sorteio automático desligado', !(await S(() => window.spacing.meteors.autoSpawn)));
r = await run('meteor.now');
check('meteoro agora: um meteoro no ar', r.ok && (await S(() => window.spacing.meteors.active.length)) === 1, r.msg);
await S(() => { window.spacing.meteors.active.length = 0; });
const d0 = await S(() => window.spacing.debris.count);
r = await run('meteor.instant');
await page.waitForFunction(() => window.spacing.meteors.active.length === 0, null, { timeout: 15000 });
await page.waitForTimeout(200);
check('impacto já: o meteoro caiu e soltou destroços', r.ok && (await S(() => window.spacing.debris.count)) > d0 + 20, `${d0} -> ${await S(() => window.spacing.debris.count)}`);
await shot('teste-impacto');
r = await run('meteor.big');
check('meteoro grande', r.ok && (await S(() => window.spacing.meteors.active.some((m) => m.radius > 3))));
await S(() => { for (const m of window.spacing.meteors.active) m.t = 1.69; });
await page.waitForFunction(() => window.spacing.meteors.active.length === 0, null, { timeout: 15000 });
r = await run('meteor.small');
check('meteoro pequeno', r.ok);
await S(() => { for (const m of window.spacing.meteors.active) m.t = 1.69; });
await page.waitForFunction(() => window.spacing.meteors.active.length === 0, null, { timeout: 15000 });
r = await run('meteor.rain');
check('chuva de 5', r.ok && (await S(() => window.spacing.meteors.active.length)) >= 3, r.msg);
await S(() => { for (const m of window.spacing.meteors.active) m.t = 1.69; });
await page.waitForFunction(() => window.spacing.meteors.active.length === 0, null, { timeout: 20000 });
r = await run('meteor.close');
check('meteoro perto', r.ok);
await S(() => { for (const m of window.spacing.meteors.active) m.t = 1.69; });
await page.waitForFunction(() => window.spacing.meteors.active.length === 0, null, { timeout: 15000 });

// ---- mundo ----
const props0 = await S(() => window.spacing.world.propMeshes.length);
r = await run('prop:crystal');
check('soltar um cristal à frente', r.ok && (await S(() => window.spacing.world.propMeshes.length)) === props0 + 1, r.msg);
for (const t of ['boulder', 'ilmenite', 'gold', 'meteorite', 'solarPanel', 'marsBoulder', 'blueberries']) {
  r = await run(`prop:${t}`);
  check(`soltar: ${t}`, r.ok, r.msg);
}
r = await run('world.debris');
check('explosão de destroços', r.ok && (await S(() => window.spacing.debris.count)) > 0, r.msg);
r = await run('world.clearDebris');
check('limpar destroços', r.ok && (await S(() => window.spacing.debris.count)) === 0, r.msg);
r = await run('world.loot');
check('pilha de itens no chão', r.ok && (await S(() => window.spacing.loot.piles().length)) >= 1, r.msg);
r = await run('world.drops');
check('itens saltando', r.ok, r.msg);
r = await run('world.reveal');
check('revelar o mapa', r.ok, r.msg);

// ---- tempo e efeitos ----
// o WebGL por software roda a poucos quadros por segundo: espera-se até a condição, não um tempo fixo
const advanced = (t0, ms = 12000) => page.waitForFunction((t) => window.spacing.time > t + 0.001, t0, { timeout: ms }).then(() => true, () => false);
await run('time', 0);
await page.waitForTimeout(400);
const tA = await S(() => window.spacing.time);
await page.waitForTimeout(1500);
const tB = await S(() => window.spacing.time);
check('jogo parado: o tempo do jogo não anda', Math.abs(tB - tA) < 0.001, `${tA.toFixed(4)} -> ${tB.toFixed(4)}`);
await run('time', 1);
check('velocidade 1×: o tempo volta a andar', await advanced(tB));
// 4×: um quadro normal avança no máximo 0,05 s (o tempo de um quadro é limitado); a 4× o maior avanço entre alguns quadros passa disso
await run('time', 4);
const maxStep = await g(() => new Promise((resolve) => {
  const s = window.spacing;
  let last = s.time, max = 0, n = 0;
  const tick = () => {
    if (s.time !== last) { max = Math.max(max, s.time - last); last = s.time; n++; }
    if (n >= 8) resolve(max); else requestAnimationFrame(tick);
  };
  tick();
}));
await run('time', 1);
check('4×: o tempo de um quadro passa do máximo de um quadro normal (0,05 s)', maxStep > 0.055, `maior avanço ${maxStep.toFixed(3)} s num quadro`);
for (const id of ['fx.shake', 'fx.punch', 'fx.hitstop', 'fx.slowmo', 'fx.toast', 'fx.ai']) {
  r = await run(id);
  check(`efeito: ${id}`, r.ok, r.msg);
}
r = await run('sound:boom');
check('tocar um som', r.ok, r.msg);

// ---- missão ----
const m0 = await S(() => window.spacing.missions.serialize().step);
await run('mission.skip');
check('pular a missão', (await S(() => window.spacing.missions.serialize().step)) === m0 + 1);

// ---- morte ----
await run('player.hurt');
check('dano de 30', (await S(() => window.spacing.survival.integrity)) < 100);
await run('player.fill');
r = await run('player.kill');
const died = await page.waitForSelector('#death', { state: 'visible', timeout: 15000 }).then(() => true, () => false);
check('morrer: a tela de morte aparece', r.ok && died);
await shot('teste-morte');
await page.click('#btn-respawn');
check('renasce jogando', await page.waitForFunction(() => document.body.dataset.state === 'playing', null, { timeout: 15000 }).then(() => true, () => false));

// ---- salvamento separado ----
await S(() => window.spacing.persist());
const keys = await S(() => Object.keys(localStorage));
check('o salvamento de teste é separado (spacing.save.teste, nunca spacing.save)', keys.includes('spacing.save.teste') && !keys.includes('spacing.save'), keys.join(', '));

// ---- sair do modo de teste ----
await run('test.exit');
await page.waitForURL((u) => !u.search.includes('teste'), { timeout: 15000 }).catch(() => {});
check('voltar ao jogo normal (o endereço perde ?teste)', !(await page.url()).includes('teste'), await page.url());

check(`tempo total ${Math.round((Date.now() - t0) / 1000)} s`, true);
await finish();
