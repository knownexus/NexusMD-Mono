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
    rolldownOptions: {
      output: {
        // The trace reports make the entry chunk bigger, and Vite's import scan (a WebAssembly lexer) runs out of memory on a
        // chunk that large (found building 1.2.42 on Linux and macOS). The libraries nobody here edits go in chunks of their own.
        // The shared UI package gets one too: with only the libraries out, the entry chunk was within about 14,000 characters of
        // the lexer's limit (about 4.2 million), so a few dozen lines of new code would have broken the build again. Each chunk
        // is now about 1.5 MB or less; build/renderer-build.test.js keeps them under 3 million characters.
        codeSplitting: {
          groups: [
            { name: 'vendor-editor', test: /node_modules[\\/](?:@codemirror|@lezer|codemirror)[\\/]/ },
            { name: 'vendor-react', test: /node_modules[\\/](?:react|react-dom|scheduler)[\\/]/ },
            { name: 'ui', test: /packages[\\/]ui[\\/]src/ },
          ],
        },
      },
    },
  },
  server: {
    port: 5173,
  },
})
