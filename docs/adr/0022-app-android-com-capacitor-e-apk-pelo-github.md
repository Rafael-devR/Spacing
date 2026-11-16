# ADR 0022: App Android com Capacitor e APK gerado pelo GitHub

- **Status:** aceita
- **Data:** 2026-11-13

## Contexto

O dono joga e testa no celular. Pediu o jogo num APK instalável, com plugins que melhorem interface e desempenho, e escolheu gerar o
APK pelo GitHub Actions. O jogo é um site (Three.js, Vite); o ambiente de desenvolvimento é um Codespace.

## Decisão

- **Capacitor** embala o build do site numa WebView Android; o código do jogo é o mesmo. Alternativas descartadas: reescrever em motor
  nativo (custo enorme, sem ganho), TWA/PWA (depende do Chrome, menos controle de tela, orientação e botão Voltar).
- O projeto nativo (`android/`) fica no repositório. O **APK de teste sai do GitHub Actions** (`.github/workflows/android-apk.yml`),
  assinado por uma **chave de teste fixa** versionada (`android/debug.keystore`) para os APKs poderem ser instalados um por cima do outro.
  A chave de loja, quando existir, fica em segredo do GitHub.
- Código do app isolado: `core/platform.ts` (detecção sem importar o Capacitor) e `core/native.ts` (plugins, import dinâmico: o
  navegador não paga por eles). O que muda de comportamento no app (tela cheia, orientação, botão Voltar, segundo plano) está em
  [design/APK.md](../design/APK.md).
- As fontes passam a ser empacotadas (`@fontsource`) em vez de vir do Google Fonts: o app e o jogo funcionam sem internet.
- Plugins escolhidos: `@capacitor/app`, `@capacitor/status-bar`, `@capacitor/screen-orientation`, `@capacitor-community/keep-awake`.
  Nenhum é "de desempenho": não existe plugin que acelere o Three.js, e o documento diz isso.

## Consequências

- Gerar APK não depende de Android Studio nem do Codespace; precisa de um push (o fluxo roda sozinho) ou de um clique em "Run workflow".
- O app precisa de Java 21 e do SDK só para quem quiser compilar localmente (`npm run android:apk`); foi validado assim neste ambiente
  (o APK compila, assina e traz o site, as fontes e os modelos), mas **ainda não rodou num aparelho**.
- A chave de teste é pública: serve só para teste. APK de loja pede outra, secreta.
- Qualquer mudança que mexa no jogo gera um APK novo no GitHub, o que gasta minutos de execução (o fluxo cancela a execução anterior da
  mesma branch quando chega outro push).
