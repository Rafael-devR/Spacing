// Arranque comum dos testes no navegador (docs/design/TESTE.md): abre o Chromium sem janela, entra no jogo (opcionalmente no
// modo de teste, `?teste`) e devolve ajudantes. Os scripts antigos repetem este bloco; os novos usam este módulo.
import chromium from '@sparticuz/chromium';
import { chromium as pw } from 'playwright-core';

/**
 * @param {{ url?: string, out?: string, w?: number, h?: number, quality?: string, test?: boolean, start?: boolean, query?: string }} o
 */
export async function boot({ url = 'http://localhost:5173/', out = '/tmp', w = 844, h = 390, quality = 'baixo', test = false, start = true, query = '' } = {}) {
  const browser = await pw.launch({
    executablePath: await chromium.executablePath(),
    args: [...chromium.args, '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    headless: true,
  });
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  await ctx.addInitScript((q) => {
    try {
      // limpa só uma vez por aba (recarregar no meio do teste não pode apagar o que ele fez)
      if (!sessionStorage.getItem('__vc')) {
        localStorage.clear();
        sessionStorage.setItem('__vc', '1');
      }
      localStorage.setItem('spacing.prefs.v1', JSON.stringify({ quality: q, muted: true, shake: 'off', vibration: false }));
    } catch {}
  }, quality);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const results = [];
  const check = (name, ok, detail = '') => results.push(`${ok ? 'OK  ' : 'FALHOU'} ${name}${detail ? ' (' + detail + ')' : ''}`);
  const g = (fn, arg) => page.evaluate(fn, arg);
  const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
  const q = [test ? 'teste' : '', query].filter(Boolean).join('&');
  await page.goto(q ? `${url}${url.includes('?') ? '&' : '?'}${q}` : url);
  await page.waitForSelector('#btn-start:not([disabled])', { timeout: 120000 });
  if (start) {
    await page.click('#btn-start');
    await page.waitForFunction(() => document.body.dataset.state === 'playing', null, { timeout: 15000 });
  }
  /** fecha o navegador e escreve o resultado; sai com erro se algo falhou */
  async function finish() {
    check('sem erros no console', errors.length === 0, errors.slice(0, 3).join(' | '));
    console.log(results.join('\n'));
    await browser.close();
    if (results.some((r) => r.startsWith('FALHOU'))) process.exitCode = 1;
  }
  return { browser, page, g, shot, check, errors, finish };
}
