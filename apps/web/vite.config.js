import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    // Output lands inside the ASP.NET project's wwwroot, served directly by the API.
    outDir: './NexusMD-Web/wwwroot',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      // Matches NexusMD-Web/Properties/launchSettings.json's applicationUrl
      '/api': 'http://localhost:5100',
    },
  },
})
