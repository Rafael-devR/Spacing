// Tela de título e carregamento (docs/design/TITULO.md): o título não carrega o jogo; as configurações trocam o planeta do fundo sem
// recarregar e guardam gráficos e som; "Novo jogo" pede confirmação e apaga só o salvamento do planeta escolhido; o carregamento passa
// pelas etapas com a barra só andando para a frente e termina no jogo. Capturas deitado e em pé.
// Uso: node title.mjs <url> <pasta-de-saída>
import { boot } from './lib.mjs';

const [url = 'http://localhost:5173/', out = '/tmp/shots'] = process.argv.slice(2);
const { page, g, shot, check, finish } = await boot({ url, out, start: false });
const S = (n) => `title-${n}`;

await page.waitForTimeout(2000);
check('o título não carrega o jogo', await g(() => !window.spacing && document.body.dataset.state === 'title'));
check('nome e versão', /spacing/i.test(await page.textContent('.title-name')) && /\d+\.\d+\.\d+/.test(await page.textContent('#title-version')));
check('sem jogo salvo: Começar missão e sem Novo jogo', /Começar/i.test(await page.textContent('#btn-start')) && !(await page.isVisible('#btn-reset')));
await shot(S('1-lua'));

await page.click('#btn-settings');
check('configurações abrem', await page.isVisible('#title-settings'));
await page.click('#title-settings [data-planet="marte"]');
await page.click('#title-settings [data-quality="medio"]');
await page.click('#title-sound');
await page.waitForTimeout(2000);
const st = await g(() => ({ planet: localStorage.getItem('spacing.planet'), prefs: JSON.parse(localStorage.getItem('spacing.prefs.v1')) }));
check('trocar o planeta guarda a escolha, sem recarregar', st.planet === 'marte' && /Elysium/.test(await page.textContent('#title-region')) && (await g(() => !window.spacing)));
check('gráficos e som vão para as preferências', st.prefs.quality === 'medio' && st.prefs.muted === false, JSON.stringify(st.prefs));
await shot(S('2-configuracoes'));
await page.click('#title-settings-back');
await shot(S('3-marte'));

// um salvamento de Marte falso: aparece Continuar e Novo jogo; o da Lua não é tocado
await g(() => {
  localStorage.setItem('spacing.save.marte', '{"marca":"marte"}');
  localStorage.setItem('spacing.save', '{"marca":"lua"}');
});
await page.click('#btn-settings');
await page.click('#title-settings [data-planet="lua"]');
await page.click('#title-settings [data-planet="marte"]');
await page.click('#title-settings-back');
check('com jogo salvo: Continuar e Novo jogo', /Continuar/i.test(await page.textContent('#btn-start')) && (await page.isVisible('#btn-reset')));
await page.click('#btn-reset');
check('Novo jogo pede confirmação', /de novo/i.test(await page.textContent('#btn-reset')) && (await g(() => !window.spacing)));

// carregamento: a barra só anda para a frente e termina no jogo
await g(() => {
  window.__pct = [];
  new MutationObserver(() => window.__pct.push(parseInt(document.querySelector('#boot-pct').textContent))).observe(document.querySelector('#boot-pct'), { childList: true, characterData: true, subtree: true });
});
const t0 = Date.now();
await page.click('#btn-reset');
await page.waitForTimeout(400);
await shot(S('4-carregando'));
await page.waitForFunction(() => document.body.dataset.state === 'playing', null, { timeout: 180000 });
const pct = await g(() => window.__pct);
check('carregou e começou', true, `${Date.now() - t0} ms`);
check('a barra só anda para a frente até 100%', pct.length > 4 && pct.every((v, i) => i === 0 || v >= pct[i - 1]) && pct[pct.length - 1] === 100, pct.join(','));
check('jogo novo em Marte (o salvamento falso saiu)', await g(() => document.body.dataset.planet === 'marte' && !localStorage.getItem('spacing.save.marte')?.includes('"marca"')));
check('o salvamento da Lua não foi tocado', (await g(() => localStorage.getItem('spacing.save'))) === '{"marca":"lua"}');
await page.waitForTimeout(800);
await shot(S('5-jogo'));

// em pé
await page.setViewportSize({ width: 390, height: 844 });
await g(() => localStorage.setItem('spacing.planet', 'lua'));
await page.reload();
await page.waitForSelector('#btn-start');
await page.waitForTimeout(2000);
await shot(S('6-em-pe'));
check('em pé: o menu cabe na tela', await g(() => document.querySelector('.title-menu').getBoundingClientRect().bottom < innerHeight));
await finish();
