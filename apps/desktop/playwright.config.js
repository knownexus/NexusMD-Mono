import { defineConfig } from '@playwright/test'

// Desktop e2e drives the real Electron app via Playwright's _electron API.
// The renderer must be built first (npm run e2e does `vite build` then this).
export default defineConfig({
  testDir: './e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  // Electron launches are serial and a bit slow; no parallelism needed for smoke.
  workers: 1,
  timeout: 60_000,
})
