import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import { resolve } from 'node:path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const repoName = env.GITHUB_REPOSITORY?.split('/').pop() || 'dundung';
  const base = env.VITE_BASE_PATH || `/${repoName}/`;

  return {
    base,
    resolve: {
      alias: {
        '@': resolve(process.cwd(), 'src'),
      },
    },
    test: {
      include: ['tests/**/*.test.ts'],
      environment: 'node',
      clearMocks: true,
    },
  };
});
