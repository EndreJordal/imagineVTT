/// <reference types="vitest/config" />
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { configDefaults } from 'vitest/config'

/**
 * Dev only: serve the V:tM combat tracker at /vtm-combat-tracker/, next to imagineVTT, as
 * GitHub Pages does. Same address, so the two can talk (docs/combat-link.md). The tracker's
 * folder: TRACKER_DIR, or ../vtm-combat_tracker.
 */
function combatTracker(): Plugin {
  const root = resolve(process.env.TRACKER_DIR ?? '../vtm-combat_tracker')
  const types: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.jpg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
  }
  return {
    name: 'combat-tracker',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/vtm-combat-tracker', (req, res, next) => {
        const path = decodeURIComponent((req.url ?? '/').split(/[?#]/)[0])
        const file = normalize(join(root, path.endsWith('/') ? path + 'index.html' : path))
        if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) return next()
        res.setHeader('Content-Type', types[extname(file).toLowerCase()] ?? 'application/octet-stream')
        res.setHeader('Cache-Control', 'no-store')
        createReadStream(file).pipe(res)
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  // Relative asset paths, so the build works from any sub-path (GitHub Pages serves it at
  // /imagineVTT/) as well as from the root.
  base: './',
  plugins: [react(), combatTracker()],
  test: {
    // The detectors' runs over real maps (test-maps/, not in the repo) take most of a minute:
    // they run with `npm run test:maps`, not on every `npm test`.
    exclude:
      process.env.npm_lifecycle_event === 'test:maps'
        ? configDefaults.exclude
        : [...configDefaults.exclude, '**/*.maps.test.ts'],
  },
})
