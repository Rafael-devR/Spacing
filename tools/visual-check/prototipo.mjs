// Abre uma página do protótipo de desempenho (docs/design/NATIVO.md) servida por `npm run proto:web` (porta 5174), espera e
// clica em "Começar", tira uma captura em /tmp/prototipo-<pagina>.png. Uso: node prototipo.mjs three.html|rust.html [segundos]
import chromium from '@sparticuz/chromium';
import { chromium as pw } from 'playwright-core';
const [pg = 'three.html', secs = '40'] = process.argv.slice(2);
const b = await pw.launch({ executablePath: await chromium.executablePath(), args: [...chromium.args, '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await (await b.newContext({ viewport: { width: 844, height: 390 } })).newPage();
const logs = [];
p.on('console', (m) => logs.push(m.type() + ': ' + m.text().slice(0, 300)));
p.on('pageerror', (e) => logs.push('pageerror: ' + String(e).slice(0, 300)));
await p.goto(`http://localhost:5174/${pg}`);
await p.click('#comecar');
await p.waitForTimeout(+secs * 1000);
await p.screenshot({ path: `/tmp/prototipo-${pg.replace('.html', '')}.png` });
console.log(logs.filter((l) => !/GPU stall|ReadPixels/.test(l)).slice(0, 10).join('\n'));
await b.close();
