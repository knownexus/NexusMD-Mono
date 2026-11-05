// vite-plugin.mjs — adds the call reports (see instrument.mjs) to our own code while Vite builds a desktop bundle.
//
//   plugins: [traceCalls(), react(), …]
//
// It runs before the other plugins, so it reads the source as written, and only touches files of this repository
// (a workspace package is a real path under the repo, not under node_modules). Wire it into the desktop builds only:
// the web and Android apps build the same shared packages and must not get it (apps/desktop/build/trace-leak.test.js).
import { instrument } from './instrument.mjs'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const SOURCE = /\.(?:[cm]?jsx?)$/
const norm = (p) => p.replace(/\\/g, '/')

/**
 * @param {{ root?: string, exclude?: { files?: string[], functions?: string[] } }} [opts]
 * @returns {import('vite').Plugin}
 */
export function traceCalls({ root = REPO, exclude } = {}) {
  const base = norm(root).replace(/\/$/, '') + '/'
  return {
    name: 'nexusmd-trace-calls',
    enforce: 'pre',
    transform(code, id) {
      // NEXUSMD_TRACE=0 builds without the reports, to measure what they cost (apps/desktop/scripts/trace-cost.mjs). It is not a
      // way to ship without them: the shipped app always has them.
      if (process.env.NEXUSMD_TRACE === '0' || id.startsWith('\0')) return null
      const file = norm(id.split('?')[0])
      if (!SOURCE.test(file) || !file.startsWith(base)) return null
      const rel = file.slice(base.length)
      if (rel.startsWith('node_modules/') || rel.includes('/node_modules/') || rel.startsWith('packages/trace/')) return null
      const out = instrument(code, { filename: file, root, exclude })
      return out ? { code: out.code, map: out.map } : null
    },
  }
}
