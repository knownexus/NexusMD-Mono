// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { appIds, installedManifest } from './build-split.mjs'
import shellApi from '../electron/shell-api.cjs'

const modulesDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'modules')

describe('installedManifest', () => {
  it('is the app\'s manifest, stamped with its version and the shell API it is built against', () => {
    for (const id of appIds()) {
      const source = JSON.parse(readFileSync(join(modulesDir, id, 'app.manifest.json'), 'utf8'))
      const { version } = JSON.parse(readFileSync(join(modulesDir, id, 'package.json'), 'utf8'))
      expect(installedManifest(id)).toEqual({ ...source, version, requires: { ...source.requires, shellApi: shellApi.SHELL_API } })
      expect(version).toMatch(/^\d+\.\d+\.\d+$/)
    }
  })
})
