import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { themePreload } from './build/theme-preload.mjs'
import { traceCalls } from '@nexusmd/trace/vite-plugin'

export default defineConfig({
  // traceCalls adds the reports a recording reads (desktop builds only, see apps/desktop/build/trace-leak.test.js)
  plugins: [traceCalls(), react(), themePreload()],
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
