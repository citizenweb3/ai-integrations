import { defineConfig, globalIgnores } from 'eslint/config';
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/app/services/**/*', 'src/db/**/*'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@/db',
              message: 'Use src/app/services/* for database access outside indexer code.',
            },
          ],
          patterns: [
            {
              group: ['@/db/*'],
              message: 'Use src/app/services/* for database access outside indexer code.',
            },
          ],
        },
      ],
    },
  },
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts']),
]);
