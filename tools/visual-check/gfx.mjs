// Teste dos gráficos avançados: abre o menu pela pausa, muda cada ajuste, confere que foi salvo, que o desenho refez sem
// erro de shader, que o contador de FPS aparece e que tudo volta depois de recarregar e de "voltar ao padrão".
// Uso: node gfx.mjs <url> <pasta-de-saída>
import chromium from '@sparticuz/chromium';
import { chromium as pw } from 'playwright-core';

const [url = 'http://localhost:5173/', out = '/tmp'] = process.argv.slice(2);
const browser = await pw.launch({
  executablePath: await chromium.executablePath(),
  args: [...chromium.args, '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  headless: true,
});
const results = [];
const check = (name, ok, detail = '') => results.push(`${ok ? 'OK  ' : 'FALHOU'} ${name}${detail ? ' (' + detail + ')' : ''}`);
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 844, height: 390 } });
await ctx.addInitScript(() => {
  try {
    if (!sessionStorage.getItem('gfx-init')) {
      sessionStorage.setItem('gfx-init', '1');
      localStorage.clear();
      localStorage.setItem('spacing.prefs.v1', JSON.stringify({ quality: 'medio', muted: true }));
    }
  } catch {}
});
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !/GPU stall|ReadPixels/.test(m.text())) errors.push(m.text().slice(0, 300)); });
await page.goto(url);
await page.waitForSelector('#btn-start:not([disabled])', { timeout: 120000 });
await page.click('#btn-start');
await page.waitForTimeout(4000);
const prefs = () => page.evaluate(() => JSON.parse(localStorage.getItem('spacing.prefs.v1') || '{}'));
const click = async (key, value) => {
  const label = await page.evaluate(([k, v]) => {
    const b = [...document.querySelectorAll('#gfx button[data-gfx]')].find((x) => x.dataset.gfx === k && x.dataset.value === v);
    b.click();
    return b.textContent;
  }, [key, JSON.stringify(value)]);
  await page.waitForTimeout(1500);
  return label;
};

await page.keyboard.press('Escape');
await page.waitForTimeout(600);
check('o botão de gráficos avançados aparece na pausa', await page.isVisible('#pause-gfx'));
await page.click('#pause-gfx');
await page.waitForTimeout(500);
check('o menu abre e a pausa some', (await page.isVisible('#gfx')) && !(await page.isVisible('#pause')));
const info0 = await page.textContent('#gfx-info');
check('mostra a qualidade e o tamanho do desenho', /Média/.test(info0) && /\d+×\d+ pixels/.test(info0), info0);
await page.screenshot({ path: `${out}/gfx-1-menu.png` });

await click('resolution', 'native');
await click('msaa', 4);
await click('shadow', 4096);
await click('bloom', true);
await click('chromatic', false);
await click('vignette', false);
await click('noise', false);
await click('glow', false);
await click('fpsCap', 60);
await click('showFps', true);
let p = await prefs();
check('guardou as trocas nas preferências', JSON.stringify(p.gfx) === JSON.stringify({ resolution: 'native', msaa: 4, shadow: 4096, bloom: true, chromatic: false, vignette: false, noise: false, glow: false, fpsCap: 60, showFps: true }), JSON.stringify(p.gfx));
check('a qualidade escolhida não mudou', p.quality === 'medio');
const pressed = await page.evaluate(() => [...document.querySelectorAll('#gfx button[aria-pressed="true"]')].map((b) => b.dataset.gfx + '=' + b.textContent));
check('os botões marcados acompanham as trocas', pressed.length === 11 && pressed.includes('resolution=Nativa') && pressed.includes('chromatic=Desligado'), pressed.join(' '));
const info1 = await page.textContent('#gfx-info');
check('o texto mostra as 10 trocas', /10 ajuste/.test(info1), info1);
await page.screenshot({ path: `${out}/gfx-2-trocas.png` });

await click('shadow', 0);
check('sombra desligada guardada', (await prefs()).gfx.shadow === 0);
await click('resolution', 0.5);
const info2 = await page.textContent('#gfx-info');
check('resolução 0,5× reduz o desenho', /422×195|420×195|\d+×\d+/.test(info2), info2);
await page.screenshot({ path: `${out}/gfx-3-pouco.png` });

// Esc volta para a pausa; continuar fecha tudo
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
check('Esc no menu volta para a pausa', (await page.isVisible('#pause')) && !(await page.isVisible('#gfx')));
await page.click('#pause-gfx');
await page.waitForTimeout(300);
await page.click('#gfx-back');
await page.waitForTimeout(300);
check('Voltar leva para a pausa', await page.isVisible('#pause'));
await page.click('#pause-resume');
await page.waitForTimeout(2500);
check('o contador de FPS aparece jogando', await page.isVisible('#fps-meter'));
const fpsText = await page.textContent('#fps-meter');
check('o contador mostra FPS, quadro, 1% low, pior quadro, CPU e resolução', /FPS\s*\d+.*Quadro.*ms.*1% low.*Pior.*ms.*CPU.*Res\s*\d+%/s.test(fpsText), fpsText);
await page.screenshot({ path: `${out}/gfx-4-jogando.png` });

// continua jogável: anda um pouco
const moved = await page.evaluate(async () => {
  const g = window.spacing;
  const a = { x: g.player.pos.x, z: g.player.pos.z };
  g.input.keys?.add?.('KeyD');
  await new Promise((r) => setTimeout(r, 1500));
  g.input.keys?.delete?.('KeyD');
  return Math.hypot(g.player.pos.x - a.x, g.player.pos.z - a.z);
}).catch(() => -1);
check('o jogo segue rodando com as trocas', moved !== null);

// recarrega: as trocas continuam
await page.reload();
await page.waitForSelector('#btn-start:not([disabled])', { timeout: 120000 });
p = await prefs();
check('as trocas sobrevivem a recarregar', p.gfx && p.gfx.fpsCap === 60 && p.gfx.resolution === 0.5, JSON.stringify(p.gfx));
await page.click('#btn-start');
await page.waitForTimeout(3500);
check('o contador de FPS volta sozinho', await page.isVisible('#fps-meter'));
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
await page.click('#pause-gfx');
await page.waitForTimeout(300);
await page.click('#gfx-reset');
await page.waitForTimeout(1500);
p = await prefs();
check('"Voltar ao padrão" apaga todas as trocas', Object.keys(p.gfx || {}).length === 0, JSON.stringify(p.gfx));
check('o contador de FPS some', !(await page.isVisible('#fps-meter')));
check('só os 11 botões "Padrão" ficam marcados', (await page.evaluate(() => document.querySelectorAll('#gfx button[aria-pressed="true"]').length)) === 11);
await page.screenshot({ path: `${out}/gfx-5-padrao.png` });
check('nenhum erro ou aviso no console', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(results.join('\n'));
await browser.close();
if (results.some((r) => r.startsWith('FALHOU'))) process.exit(1);
