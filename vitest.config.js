import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/__tests__/**/*.test.js'],
    coverage: {
      include: ['src/**/*.{js,ts}'],
      exclude: ['**/node_modules/**', '**/dist/**']
    }
  }
}); 