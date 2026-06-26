import { describe, it, expect } from 'vitest'
import { createNoOpAdapters } from '../src/adapters/defaults.js'

describe('createNoOpAdapters', () => {
  it('returns objects for all 17 adapter keys', () => {
    const a = createNoOpAdapters()
    const keys = [
      'file', 'http', 'storage',
      'notification', 'picker', 'auth', 'clipboard',
      'secureStorage', 'network', 'lifecycle', 'share',
      'tray', 'navigation', 'theme', 'update', 'badge', 'deepLink',
    ]
    for (const key of keys) {
      expect(a[key], `adapter "${key}" should be defined`).toBeDefined()
    }
  })

  it('required file adapter rejects by default (apps must implement)', async () => {
    const { file } = createNoOpAdapters()
    await expect(file.read('/any')).rejects.toThrow('IFileAdapter.read not implemented')
    await expect(file.write('/any', '')).rejects.toThrow('IFileAdapter.write not implemented')
    await expect(file.exists('/any')).rejects.toThrow('IFileAdapter.exists not implemented')
    await expect(file.list('/any')).rejects.toThrow('IFileAdapter.list not implemented')
    await expect(file.delete('/any')).rejects.toThrow('IFileAdapter.delete not implemented')
    await expect(file.mkdir('/any')).rejects.toThrow('IFileAdapter.mkdir not implemented')
    await expect(file.defaultProfileDir()).rejects.toThrow('IFileAdapter.defaultProfileDir not implemented')
  })

  it('required http adapter rejects by default', async () => {
    const { http } = createNoOpAdapters()
    await expect(http.fetch('http://x')).rejects.toThrow('IHttpAdapter.fetch not implemented')
  })

  it('required storage adapter rejects by default', () => {
    const { storage } = createNoOpAdapters()
    expect(() => storage.get('key')).toThrow('IStorageAdapter.get not implemented')
    expect(() => storage.set('key', 'v')).toThrow('IStorageAdapter.set not implemented')
    expect(() => storage.remove('key')).toThrow('IStorageAdapter.remove not implemented')
    expect(() => storage.keys()).toThrow('IStorageAdapter.keys not implemented')
  })

  it('optional adapter notification.send is a no-op', () => {
    const { notification } = createNoOpAdapters()
    expect(() => notification.send('title', 'body')).not.toThrow()
  })

  it('optional auth.isAvailable resolves to false', async () => {
    const { auth } = createNoOpAdapters()
    await expect(auth.isAvailable()).resolves.toBe(false)
  })

  it('optional tray.isAvailable returns false synchronously', () => {
    const { tray } = createNoOpAdapters()
    expect(tray.isAvailable()).toBe(false)
  })

  it('optional clipboard.isAvailable returns false', () => {
    const { clipboard } = createNoOpAdapters()
    expect(clipboard.isAvailable()).toBe(false)
  })

  it('optional badge.isAvailable returns false', () => {
    const { badge } = createNoOpAdapters()
    expect(badge.isAvailable()).toBe(false)
  })

  it('optional share.isAvailable returns false', () => {
    const { share } = createNoOpAdapters()
    expect(share.isAvailable()).toBe(false)
  })

  it('optional deepLink.isAvailable returns false', () => {
    const { deepLink } = createNoOpAdapters()
    expect(deepLink.isAvailable()).toBe(false)
  })

  it('optional update.checkForUpdate resolves to { available: false }', async () => {
    const { update } = createNoOpAdapters()
    await expect(update.checkForUpdate()).resolves.toEqual({ available: false })
  })

  it('optional network.isOnline returns true (core assumes online when absent)', () => {
    const { network } = createNoOpAdapters()
    expect(network.isOnline()).toBe(true)
  })

  it('optional lifecycle.onForeground returns an unsubscribe function', () => {
    const { lifecycle } = createNoOpAdapters()
    const unsub = lifecycle.onForeground(() => {})
    expect(typeof unsub).toBe('function')
  })

  it('optional picker.pickFile resolves to null (no file picked)', async () => {
    const { picker } = createNoOpAdapters()
    await expect(picker.pickFile()).resolves.toBeNull()
  })

  it('optional picker.pickDirectory resolves to null', async () => {
    const { picker } = createNoOpAdapters()
    await expect(picker.pickDirectory()).resolves.toBeNull()
  })

  it('optional picker.saveFile resolves without throwing', async () => {
    const { picker } = createNoOpAdapters()
    await expect(picker.saveFile('test.json', '{}')).resolves.toBeUndefined()
  })

  it('optional secureStorage returns null for missing keys', async () => {
    const { secureStorage } = createNoOpAdapters()
    await expect(secureStorage.get('nonexistent')).resolves.toBeNull()
  })

  it('apps can spread and override individual methods', async () => {
    const { file } = createNoOpAdapters()
    const customFile = {
      ...file,
      exists: async () => true,
    }
    await expect(customFile.exists('/any')).resolves.toBe(true)
    await expect(customFile.read('/any')).rejects.toThrow('IFileAdapter.read not implemented')
  })
})
