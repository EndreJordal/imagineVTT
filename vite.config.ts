import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Relative asset paths, so the build works from any sub-path (GitHub Pages serves it at
  // /imagineVTT/) as well as from the root.
  base: './',
  plugins: [react()],
})
