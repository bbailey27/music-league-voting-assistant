import js from '@eslint/js';

export default [
  { ignores: ['node_modules/**', 'rounds/**', 'analysis/**'] },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        process: 'readonly',
        console: 'readonly',
      },
    },
  },
];
