import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // GitHub Pages serves the site under /Acordes/ and each song has its own page deeper down
  // (/Acordes/cancion/artista/titulo/), so assets and data need absolute paths
  base: mode === 'production' ? '/Acordes/' : '/', // build and preview; dev serves at /
  // dist/ is build output; watching it crashes the dev server on Windows (EBUSY) during a build
  // The preview pane assigns a free port through PORT (another chat's server may hold the default)
  server: { watch: { ignored: ['**/dist/**'] }, ...(process.env.PORT && { port: Number(process.env.PORT), strictPort: true }) },
  preview: process.env.PORT ? { port: Number(process.env.PORT), strictPort: true } : {},
}))
