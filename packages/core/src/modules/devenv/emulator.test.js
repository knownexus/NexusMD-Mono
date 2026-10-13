import { describe, it, expect } from 'vitest'
import { normaliseAvds, buildEmulatorArgv } from './emulator.js'

describe('normaliseAvds', () => {
  it('keeps valid names, the default and the error', () => {
    expect(normaliseAvds({ kind: 'emulator-avds', avds: ['Pixel_9', 'bad name', 3], default: 'Pixel_9', error: null }))
      .toEqual({ avds: ['Pixel_9'], default: 'Pixel_9', error: null })
    expect(normaliseAvds({ kind: 'emulator-avds', avds: [], default: null, error: 'no SDK' }).error).toBe('no SDK')
  })
  it('drops names that look like options', () => {
    expect(normaliseAvds({ kind: 'emulator-avds', avds: ['-x', 'Pixel_9'], default: null, error: null }).avds).toEqual(['Pixel_9'])
  })
  it('rejects other results', () => { expect(() => normaliseAvds({ kind: 'x' })).toThrow('Not a devenv emulator-avds result') })
})

describe('buildEmulatorArgv', () => {
  it('builds every action', () => {
    expect(buildEmulatorArgv({ kind: 'start' })).toEqual(['emulator', 'start'])
    expect(buildEmulatorArgv({ kind: 'start', avd: 'Pixel_9', proxy: false })).toEqual(['emulator', 'start', '--avd', 'Pixel_9', '--no-proxy'])
    expect(buildEmulatorArgv({ kind: 'stop' })).toEqual(['emulator', 'stop'])
    expect(buildEmulatorArgv({ kind: 'proxy', on: true })).toEqual(['emulator', 'proxy'])
    expect(buildEmulatorArgv({ kind: 'proxy', on: false })).toEqual(['emulator', 'proxy', '--off'])
    expect(buildEmulatorArgv({ kind: 'push-ca' })).toEqual(['emulator', 'push-ca'])
    expect(buildEmulatorArgv({ kind: 'push', paths: ['C:\\Users\\me\\a.jpg', 'C:\\b.txt'] })).toEqual(['emulator', 'push', 'C:\\Users\\me\\a.jpg', 'C:\\b.txt'])
    expect(buildEmulatorArgv({ kind: 'push', paths: ['C:\\a.jpg'], dest: ' /sdcard/DCIM ' })).toEqual(['emulator', 'push', 'C:\\a.jpg', '--to', '/sdcard/DCIM'])
    expect(buildEmulatorArgv({ kind: 'create', avd: 'Pixel_9' })).toEqual(['emulator', 'create', '--avd', 'Pixel_9'])
  })
  it('refuses empty pushes, bad destinations, bad AVDs and recreate without a name', () => {
    expect(() => buildEmulatorArgv({ kind: 'push', paths: [] })).toThrow(/at least one file/)
    expect(() => buildEmulatorArgv({ kind: 'push', paths: ['-x'] })).toThrow()
    expect(() => buildEmulatorArgv({ kind: 'push', paths: ['C:\\a'], dest: '/data/x' })).toThrow(/sdcard/)
    expect(() => buildEmulatorArgv({ kind: 'start', avd: 'a b' })).toThrow()
    expect(() => buildEmulatorArgv({ kind: 'create' })).toThrow()
    expect(() => buildEmulatorArgv({ kind: 'start', avd: '--no-proxy' })).toThrow()
    expect(() => buildEmulatorArgv({ kind: 'create', avd: '-x' })).toThrow()
    expect(() => buildEmulatorArgv({ kind: 'nope' })).toThrow()
  })
})
