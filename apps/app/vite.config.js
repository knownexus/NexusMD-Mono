import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: { outDir: 'www' },
  server: {
    proxy: {
      '/api': 'http://localhost:5100',
      '/templates': 'http://localhost:5100',
    },
  },
})
