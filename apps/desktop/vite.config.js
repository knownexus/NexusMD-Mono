import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Relative asset paths so the built renderer loads under Electron's file://
  // protocol (absolute "/assets/..." resolves to the filesystem root there).
  base: './',
  build: {
    outDir: '../../dist/desktop/renderer',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
  },
})
