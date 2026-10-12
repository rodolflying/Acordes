import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './',
  // dist/ is build output; watching it crashes the dev server on Windows (EBUSY) during a build
  server: { watch: { ignored: ['**/dist/**'] } },
})
