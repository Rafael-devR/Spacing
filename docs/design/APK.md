# App Android (APK)

> Desde 2026-11-13 ([ADR 0022](../adr/0022-app-android-com-capacitor-e-apk-pelo-github.md)).

Pedido do dono: pôr o jogo num **APK jogável** (Capacitor) e usar plugins que melhorem a interface e o desempenho. Escolha dele para
gerar o APK: **GitHub Actions** (sem instalar nada no computador).

## Como funciona

O [Capacitor](https://capacitorjs.com) embala o build do site (`dist/`) numa janela nativa do Android (WebView, o motor do Chrome). É o
**mesmo código do jogo**: nada foi reescrito. Dentro do app o jogo roda em `https://localhost` (contexto seguro, como no navegador:
som, `localStorage`, Web Workers), sem internet.

```
npm run build  →  dist/  →  cap sync  →  android/app/src/main/assets/public  →  Gradle  →  app-debug.apk
```

- Projeto nativo: `android/` (commitado; os arquivos gerados e o build ficam fora, pelo `.gitignore` de lá). Pacote `app.spacing.game`.
- Config: `capacitor.config.ts`. Android mínimo: 7.0 (API 24).
- **Fluxo do GitHub** (`.github/workflows/android-apk.yml`): roda a cada push que mexe no jogo ou no app, e na mão (Actions → "APK
  Android" → Run workflow). Faz `npm ci`, `npm run build`, `cap sync`, `./gradlew assembleDebug` e guarda o APK em **Artifacts**
  (`spacing-apk`, 30 dias). O número da execução vira o `versionCode` e a versão do `package.json` vira o `versionName`.
- **Instalar:** na página da execução, baixe o artefato `spacing-apk` (vem num zip), extraia e abra o `.apk`. Na primeira vez o Android
  pede para permitir instalar apps do navegador ou do gerenciador de arquivos.
- **Chave de teste fixa:** `android/debug.keystore` (de teste, só para APK de teste; senha `android`). Sem ela cada build do GitHub sairia
  com uma chave nova e o Android recusaria instalar um por cima do outro. O APK de loja terá a sua própria chave, **em segredo**.

## O que mudou no jogo para rodar no app

| Assunto | Como ficou |
| --- | --- |
| Fontes | Antes vinham do Google Fonts (internet). Agora `@fontsource/*` empacotado no build (`src/ui/fonts.ts`, só o latino e os pesos usados). Vale também para o jogo no navegador. |
| Detecção | `src/core/platform.ts` (`isNative`): lê o objeto global que o Capacitor injeta, sem importar nada dele. |
| Plugins | `src/core/native.ts`, carregado por import dinâmico só dentro do app (no navegador nem entra na página). |
| Tela cheia | O app já é tela cheia: barra de status e de navegação escondidas (modo imersivo em `MainActivity.java`; voltam por um instante com um deslize na borda). A opção "Tela cheia" some das configurações. |
| Orientação | "Orientação" (Deitada ou Livre) trava a tela pelo `@capacitor/screen-orientation`; começa deitada. |
| Tela sempre ligada | `@capacitor-community/keep-awake`: a tela não apaga jogando. |
| Botão Voltar | `@capacitor/app`: fecha a camada de cima (ajuda, configurações, mochila, mapa…), jogando abre a pausa, na pausa continua; no título fecha configurações/controles e, sem nada aberto, fecha o app. Carregando, não faz nada. |
| Segundo plano | Tela bloqueada ou outro app: o jogo pausa (e a pausa já salva). |
| Vibração | `VIBRATE` no manifesto (a WebView só vibra com a permissão); o jogo segue usando `navigator.vibrate`. |
| Visual nativo | Fundo `#120F26` desde o primeiro instante (sem clarão branco), barra de status/navegação da mesma cor, ícone próprio (lua de blocos, `tools/android/make_icon.py`). |

## Sobre desempenho (sem promessa)

Plugin nenhum acelera o Three.js. O que o app muda: janela sem a interface do navegador (mais área útil), sem barras, tela que não
apaga, mesma WebView do Chrome. O desempenho de verdade continua vindo do jogo (workers, qualidade automática, teste de desempenho no
menu de pausa). **Meça no celular** antes de acreditar em qualquer número daqui: o WebGL do ambiente de teste é por software.

## Comandos

```bash
npm run android:sync   # build do site + copia para o projeto Android
npm run android:apk    # ... e compila o APK de teste (precisa de Java 21 e do Android SDK; no dia a dia use o GitHub)
python3 tools/android/make_icon.py   # refaz os ícones
```

O APK sai em `android/app/build/outputs/apk/debug/app-debug.apk`.

## Em aberto

- **Testar no celular de verdade:** nem o APK nem os plugins foram vistos rodando num aparelho (aqui só compila; não há emulador).
  Conferir: abre direto no título, barras escondidas, toque libera o som, Voltar, bloquear a tela e voltar, vibração, desempenho.
- Salvamento: o `localStorage` da WebView some ao desinstalar o app. Se o dono quiser que sobreviva, trocar por `@capacitor/preferences`
  (ou backup para arquivo).
- APK de loja (assinatura própria e `bundle`) e Play Store: só quando o dono pedir.
- Splash nativa com a arte do jogo (hoje é só a cor de fundo, seguida do carregamento do jogo).
