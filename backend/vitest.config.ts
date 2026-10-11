import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
  },
  resolve: {
    alias: {
      '@kaiji-quiz/shared': path.resolve(__dirname, '../shared/src/index.ts'),
    },
  },
});
