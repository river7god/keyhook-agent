import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Local dev reads .env; CI sets env vars directly.
try {
  process.loadEnvFile('.env');
} catch {
  /* no .env file */
}

const alias = { '@': path.resolve(import.meta.dirname, 'src') };

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts', 'evals/**/*.test.ts'],
          exclude: ['**/*.db.test.ts'],
          environment: 'node',
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'db',
          include: ['src/**/*.db.test.ts', 'evals/**/*.db.test.ts'],
          environment: 'node',
          globalSetup: ['src/test/db-global-setup.ts'],
          // One shared test database → run DB test files serially.
          fileParallelism: false,
          // Generous limits: on some dev machines module loading between files stalls for tens
          // of seconds (nothing touches the DB meanwhile); CI on Linux runs these in seconds.
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
