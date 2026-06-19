import js from '@eslint/js';

export default [
  { ignores: ['node_modules/**', 'data/**'] },
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
