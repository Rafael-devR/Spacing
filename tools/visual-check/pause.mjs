// Menu de pausa e configurações (docs/design/PAUSA.md): Continuar, Salvar, Configurações (a mesma tela do título), Controles,
// Sair para o título e Novo jogo (com confirmação). Capturas deitado e em pé.
// Uso: node pause.mjs <url> <pasta-de-saída>
import { boot } from './lib.mjs';

const [url = 'http://localhost:5173/', out = '/tmp/shots'] = process.argv.slice(2);
const { page, g, shot, check, finish } = await boot({ url, out });
const S = (n) => `pause-${n}`;
await page.waitForTimeout(1500);

await page.keyboard.press('Escape');
await page.waitForTimeout(500);
check('Esc abre a pausa', await page.isVisible('#pause'));
for (const id of ['resume', 'save', 'settings', 'controls', 'bench', 'exit', 'new'])
  check(`botão ${id} na pausa`, await page.isVisible(`#pause-${id}`));
check('o menu antigo não existe mais (sem linhas de configuração na pausa)', (await g(() => document.querySelectorAll('#pause [data-quality], #pause #pause-sound').length)) === 0);
check('mostra a hora em que salvou (a pausa grava)', /Salvo às \d\d:\d\d/.test(await page.textContent('#pause-saved')), await page.textContent('#pause-saved'));
await shot(S('1-pausa'));

// salvar: grava e avisa
const before = await g(() => JSON.parse(localStorage.getItem('spacing.save') ?? 'null')?.savedAt ?? 0);
await page.waitForTimeout(1100);
await page.click('#pause-save');
await page.waitForTimeout(200);
const after = await g(() => JSON.parse(localStorage.getItem('spacing.save') ?? 'null')?.savedAt ?? 0);
check('Salvar grava o jogo agora', after > before, `${before} → ${after}`);
check('o botão confirma', /Salvo/.test(await page.textContent('#pause-save')));

// configurações: a mesma tela do título, sem a escolha de planeta e com os gráficos avançados
await page.click('#pause-settings');
await page.waitForTimeout(300);
check('configurações abrem e a pausa some', (await page.isVisible('#settings')) && !(await page.isVisible('#pause')));
check('sem escolha de planeta no jogo e com gráficos avançados', !(await page.isVisible('#settings [data-planet]')) && (await page.isVisible('#set-advanced')));
await page.click('#settings [data-quality="alto"]');
await page.click('#settings [data-shake="off"]');
await page.click('#set-sound');
await page.waitForTimeout(200);
const p = await g(() => JSON.parse(localStorage.getItem('spacing.prefs.v1')));
check('as mudanças valem e ficam guardadas', p.quality === 'alto' && p.shake === 'off' && p.muted === false, JSON.stringify(p));
check('o botão da qualidade fica marcado', (await page.getAttribute('#settings [data-quality="alto"]', 'aria-pressed')) === 'true');
await shot(S('2-configuracoes'));
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
check('Esc volta da configuração para a pausa', (await page.isVisible('#pause')) && !(await page.isVisible('#settings')));

// controles e continuar
await page.click('#pause-controls');
check('Controles abre a ajuda', await page.isVisible('#help'));
await page.keyboard.press('Escape');
await page.click('#pause-resume');
await page.waitForFunction(() => document.body.dataset.state === 'playing');
check('Continuar volta ao jogo', !(await page.isVisible('#pause')));

// sair para o título: grava e abre a tela de título (sem carregar o jogo)
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
await page.click('#pause-exit');
await page.waitForSelector('#title:not([hidden])', { timeout: 60000 });
await page.waitForTimeout(1500);
check('Sair leva à tela de título', (await g(() => document.body.dataset.state)) === 'title' && (await g(() => !window.spacing)));
check('com jogo salvo: Continuar missão', /Continuar/i.test(await page.textContent('#btn-start')));
check('o salvamento ficou', await g(() => !!localStorage.getItem('spacing.save')));
await page.click('#btn-settings');
await page.waitForTimeout(300);
check('no título, as configurações têm o planeta', await page.isVisible('#settings [data-planet]'));
// (o arranque dos testes regrava as preferências a cada carga: o título deve mostrar o que está guardado)
const q = await g(() => JSON.parse(localStorage.getItem('spacing.prefs.v1')).quality ?? 'auto');
check('no título, a qualidade mostrada é a guardada', (await page.getAttribute(`#settings [data-quality="${q}"]`, 'aria-pressed')) === 'true', q);
await page.click('#settings-back');

// jogar de novo e Novo jogo (confirmação)
await page.click('#btn-start');
await page.waitForFunction(() => document.body.dataset.state === 'playing', null, { timeout: 180000 });
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
await page.click('#pause-new');
check('Novo jogo pede confirmação', /de novo/i.test(await page.textContent('#pause-new')) && (await page.isVisible('#pause')));
await shot(S('3-confirma'));

// em pé
await g(() => document.fullscreenElement && document.exitFullscreen().catch(() => {}));
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(400);
check('em pé: o menu cabe na tela', await g(() => { const r = document.querySelector('#pause .pause-card').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }));
await shot(S('4-em-pe'));
await page.click('#pause-settings');
await page.waitForTimeout(300);
await shot(S('5-configuracoes-em-pe'));
await finish();
