import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: {
    host: true,
    port: 5173,
    // o Codespace encaminha a porta por *.app.github.dev; sem isso o Vite bloqueia (403)
    allowedHosts: ['.app.github.dev'],
  },
  // modelos do Blender (docs/design/MODELOS.md): o jogo importa com ?url, os testes leem com ?inline
  assetsInclude: ['**/*.glb'],
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 900 },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{js,ts}'],
  },
});
