// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import crypto from 'node:crypto'
import { FORMAT, sha256, packApp, unpackApp, signIndex, verifyIndex } from './app-package.cjs'

describe('packApp and unpackApp', () => {
  let root
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexusmd-pkg-')) })
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

  it('carries an app folder, every file byte for byte', () => {
    const src = path.join(root, 'src')
    fs.mkdirSync(path.join(src, 'renderer'), { recursive: true })
    fs.mkdirSync(path.join(src, 'assets'))
    fs.writeFileSync(path.join(src, 'app.manifest.json'), '{"id":"git"}')
    fs.writeFileSync(path.join(src, 'renderer', 'index.js'), 'export default {}')
    fs.writeFileSync(path.join(src, 'assets', 'icon.png'), Buffer.from([0, 1, 2, 255]))
    const dest = path.join(root, 'dest')
    unpackApp(packApp(src), dest)
    expect(fs.readFileSync(path.join(dest, 'app.manifest.json'), 'utf8')).toBe('{"id":"git"}')
    expect(fs.readFileSync(path.join(dest, 'renderer', 'index.js'), 'utf8')).toBe('export default {}')
    expect([...fs.readFileSync(path.join(dest, 'assets', 'icon.png'))]).toEqual([0, 1, 2, 255])
  })

  it('packs the same folder to the same bytes', () => {
    fs.writeFileSync(path.join(root, 'b.txt'), 'b')
    fs.writeFileSync(path.join(root, 'a.txt'), 'a')
    expect(sha256(packApp(root))).toBe(sha256(packApp(root)))
  })

  it('refuses a package that would write outside its folder, and writes nothing', () => {
    const evil = zlib.gzipSync(JSON.stringify({ format: FORMAT, files: { 'ok.txt': 'eA==', '../escaped.txt': 'eA==' } }))
    const dest = path.join(root, 'dest')
    expect(() => unpackApp(evil, dest)).toThrow(/outside/)
    expect(fs.existsSync(path.join(root, 'escaped.txt'))).toBe(false)
    expect(fs.existsSync(path.join(dest, 'ok.txt'))).toBe(false)
    const absolute = zlib.gzipSync(JSON.stringify({ format: FORMAT, files: { [path.join(root, 'abs.txt')]: 'eA==' } }))
    expect(() => unpackApp(absolute, dest)).toThrow(/outside/)
  })

  it('refuses something that is not a package', () => {
    expect(() => unpackApp(Buffer.from('nope'), path.join(root, 'd'))).toThrow(/not an app package/)
    expect(() => unpackApp(zlib.gzipSync('{"format":"other","files":{}}'), path.join(root, 'd'))).toThrow(/format/)
  })
})

describe('signIndex and verifyIndex', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
  const pub = publicKey.export({ type: 'spki', format: 'pem' })
  const priv = privateKey.export({ type: 'pkcs8', format: 'pem' })

  it('accepts the index it signed, and nothing else', () => {
    const bytes = '{"apps":{}}'
    const signature = signIndex(bytes, priv)
    expect(verifyIndex(bytes, signature, pub)).toBe(true)
    expect(verifyIndex(bytes + ' ', signature, pub)).toBe(false)
    const other = crypto.generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' })
    expect(verifyIndex(bytes, signature, other)).toBe(false)
    expect(verifyIndex(bytes, 'garbage', pub)).toBe(false)
  })
})
