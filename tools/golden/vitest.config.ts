// Configuração só do exportador de vetores dourados (npm run golden); os testes normais ficam em vite.config.ts.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'node', include: ['tools/golden/**/*.test.ts'], testTimeout: 120000 },
});
