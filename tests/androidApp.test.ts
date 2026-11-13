// O app Android (docs/design/APK.md) depende de peças que moram fora do código do jogo; este teste confere que continuam
// de acordo entre si, para o build do GitHub não quebrar só no fim.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string): string => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

describe('app Android', () => {
  it('o Capacitor empacota a pasta que o Vite gera e usa o mesmo nome de pacote do projeto nativo', () => {
    const cfg = read('capacitor.config.ts');
    expect(cfg).toMatch(/webDir: 'dist'/);
    const id = cfg.match(/appId: '([^']+)'/)?.[1];
    expect(id).toBeDefined();
    expect(read('android/app/build.gradle')).toContain(`applicationId "${id}"`);
    expect(read('android/app/src/main/AndroidManifest.xml')).toContain('MainActivity');
    expect(read(`android/app/src/main/java/${(id as string).replace(/\./g, '/')}/MainActivity.java`)).toContain(`package ${id};`);
  });

  it('o manifesto tem a permissão de vibrar (a WebView só vibra com ela)', () => {
    expect(read('android/app/src/main/AndroidManifest.xml')).toContain('android.permission.VIBRATE');
  });

  it('a chave de teste fixa está no repositório e o build a usa (APKs instaláveis um por cima do outro)', () => {
    expect(read('android/app/build.gradle')).toContain("storeFile file('../debug.keystore')");
    expect(readFileSync(new URL('../android/debug.keystore', import.meta.url)).length).toBeGreaterThan(1000);
  });

  it('o fluxo do GitHub passa a versão e o número da execução ao Gradle', () => {
    const wf = read('.github/workflows/android-apk.yml');
    expect(wf).toContain('-PspacingVersionCode=');
    expect(wf).toContain('-PspacingVersionName=');
    expect(read('android/app/build.gradle')).toContain("findProperty('spacingVersionCode')");
  });

  it('as fontes vêm no build (nada de Google Fonts na página)', () => {
    expect(read('index.html')).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
    expect(read('src/main.ts')).toContain("import './ui/fonts'");
  });
});
