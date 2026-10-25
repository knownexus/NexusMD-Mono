// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import Module from 'module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const origRequire = Module.prototype.require
const dialog = { showOpenDialog: vi.fn() }
const handlers = {}
let dir, file

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexusmd-picker-'))
  file = path.join(dir, 'note.txt')
  fs.writeFileSync(file, 'hello')
  Module.prototype.require = function (id) {
    if (id === 'electron') return { dialog }
    return origRequire.apply(this, arguments)
  }
  const { register } = origRequire.call(module, path.join(__dirname, 'picker.cjs'))
  register({ handle: (channel, fn) => { handlers[channel] = fn } }, () => null)
})

afterAll(() => {
  Module.prototype.require = origRequire
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('picker:pickFile', () => {
  it('returns the file with its text by default (what the importers expect)', async () => {
    dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [file] })
    expect(await handlers['picker:pickFile'](null, undefined)).toEqual({ path: file, name: 'note.txt', text: 'hello' })
  })

  it('with pathOnly returns just where it is, without reading it', async () => {
    dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [path.join(dir, 'does-not-exist.bin')] })
    expect(await handlers['picker:pickFile'](null, { pathOnly: true }))
      .toEqual({ path: path.join(dir, 'does-not-exist.bin'), name: 'does-not-exist.bin' })
  })

  it('returns null when the dialog is cancelled', async () => {
    dialog.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    expect(await handlers['picker:pickFile'](null, { pathOnly: true })).toBeNull()
  })
})
