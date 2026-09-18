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
  {
    // Node runtime scripts/tests — fetch/timers are process globals on Node >=18.
    files: ['scripts/**/*.mjs', 'tests/**/*.mjs'],
    languageOptions: {
      globals: {
        fetch: 'readonly',
        setTimeout: 'writable',
        clearTimeout: 'writable',
        setInterval: 'writable',
        clearInterval: 'writable',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        AbortController: 'readonly',
        FormData: 'readonly',
      },
    },
  },
  {
    // Browser-only code served from docs/ (both app.js and lib/*.mjs load as ES modules).
    files: ['docs/**/*.js', 'docs/lib/**/*.mjs'],
    languageOptions: {
      globals: {
        document: 'readonly',
        window: 'readonly',
        navigator: 'readonly',
        location: 'writable',
        localStorage: 'readonly',
        DOMParser: 'readonly',
        fetch: 'readonly',
        setTimeout: 'writable',
        clearTimeout: 'writable',
        setInterval: 'writable',
        clearInterval: 'writable',
        requestAnimationFrame: 'readonly',
        CustomEvent: 'readonly',
        URLSearchParams: 'readonly',
      },
    },
  },
];
