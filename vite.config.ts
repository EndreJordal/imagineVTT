/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { configDefaults } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  // Relative asset paths, so the build works from any sub-path (GitHub Pages serves it at
  // /imagineVTT/) as well as from the root.
  base: './',
  plugins: [react()],
  test: {
    // The detectors' runs over real maps (test-maps/, not in the repo) take most of a minute:
    // they run with `npm run test:maps`, not on every `npm test`.
    exclude:
      process.env.npm_lifecycle_event === 'test:maps'
        ? configDefaults.exclude
        : [...configDefaults.exclude, '**/*.maps.test.ts'],
  },
})
