import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SHARED_SPECIFIERS, sharedName, importMap, sharedEntrySource } from './build/shared.mjs'
import { analyzeUi, sharedUiEntrySource } from './build/ui-split.mjs'

// The shell of the split build: the window's own code and the shared libraries, and NO app code.
// Each app is built on its own (build/build-split.mjs) and loaded from its folder at runtime.
const here = dirname(fileURLToPath(import.meta.url))
const shellDir = resolve(here, 'src', 'shell')
const entriesDir = join(here, 'build', '.shared')
const UI = '@nexusmd/ui'

// One entry module per shared library, written where Node resolution finds the packages they re-export.
function writeSharedEntries() {
  rmSync(entriesDir, { recursive: true, force: true })
  mkdirSync(entriesDir, { recursive: true })
  const input = {}
  for (const specifier of SHARED_SPECIFIERS) {
    const name = sharedName(specifier)
    const file = join(entriesDir, `${name}.js`)
    // @nexusmd/ui is exposed without the apps' screens: those are built into the apps (build/ui-split.mjs).
    writeFileSync(file, specifier === UI ? sharedUiEntrySource(analyzeUi()) : sharedEntrySource(specifier))
    input[`shared/${name}`] = file
  }
  return input
}

// Wherever the shell (or another shared library) imports '@nexusmd/ui', it gets that trimmed entry, so
// the shell and the apps use one copy of it.
const useSharedUi = () => ({
  name: 'nexusmd-shared-ui',
  enforce: 'pre',
  resolveId: source => (source === UI ? join(entriesDir, `${sharedName(UI)}.js`) : null),
})

// The shell asks for the apps through two files; in the split build they are the runtime versions.
const swapAppSources = () => ({
  name: 'nexusmd-split-app-sources',
  enforce: 'pre',
  resolveId(source, importer) {
    if (!importer || !resolve(dirname(importer)).startsWith(shellDir)) return null
    if (source === './app-manifests.js') return join(shellDir, 'app-manifests.split.js')
    if (source === './app-code.js') return join(shellDir, 'app-code.split.js')
    return null
  },
})

// The import map must come before any module script, so the shared libraries resolve to the files above.
const injectImportMap = () => ({
  name: 'nexusmd-import-map',
  transformIndexHtml: () => [{
    tag: 'script',
    attrs: { type: 'importmap' },
    children: JSON.stringify(importMap('./shared/')),
    injectTo: 'head-prepend',
  }],
})

export default defineConfig({
  plugins: [react(), useSharedUi(), swapAppSources(), injectImportMap()],
  base: './',
  build: {
    outDir: '../../dist/desktop/split/shell',
    emptyOutDir: true,
    // The app loader awaits at the top level, and Electron's Chromium supports it.
    target: 'esnext',
    rollupOptions: {
      input: { index: resolve(here, 'index.html'), ...writeSharedEntries() },
      // The shared modules must keep every export: the apps import them by name.
      preserveEntrySignatures: 'strict',
      output: {
        entryFileNames: chunk => (chunk.name.startsWith('shared/') ? '[name].js' : 'assets/[name]-[hash].js'),
      },
    },
  },
})
