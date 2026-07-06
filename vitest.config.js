import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node', // tidak butuh jsdom — satu-satunya browser API yang dipakai
                          // modul pure (localStorage) sudah di-polyfill di tests/setup.js
    setupFiles: ['./tests/setup.js'],
    globals: false,
  },
});
