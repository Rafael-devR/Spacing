// Empacotamento em app Android (docs/design/APK.md, ADR 0022): o Capacitor embala o build do site (`dist/`) numa WebView.
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.spacing.game',
  appName: 'Spacing',
  webDir: 'dist',
  backgroundColor: '#120f26',
  // o jogo roda em https://localhost (contexto seguro: AudioContext, localStorage e Web Workers como no navegador)
  server: { androidScheme: 'https' },
  android: { allowMixedContent: false },
};

export default config;
