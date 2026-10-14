import { describe, it, expect } from 'vitest'
import { normaliseMacStatus, buildMacArgv, macConnectionText } from './mac.js'

const raw = over => ({ type: 'result', kind: 'mac-status', configured: true, host: 'mac.local', user: 'me', sshKey: 'C:\\Users\\me\\.ssh\\devenv_mac_ed25519', keyExists: true, connection: 'ok', detail: null, error: null, ...over })

describe('normaliseMacStatus', () => {
  it('keeps the fields', () => {
    expect(normaliseMacStatus(raw())).toEqual({ configured: true, host: 'mac.local', user: 'me', sshKey: 'C:\\Users\\me\\.ssh\\devenv_mac_ed25519', keyExists: true, connection: 'ok', detail: null, error: null })
  })
  it('reads an unknown connection as error, and unconfigured whenever configured is false', () => {
    expect(normaliseMacStatus(raw({ connection: 'weird' })).connection).toBe('error')
    expect(normaliseMacStatus(raw({ configured: false, connection: 'ok', error: 'No mac.json' }))).toMatchObject({ configured: false, connection: 'unconfigured', error: 'No mac.json' })
  })
  it('survives junk', () => {
    expect(normaliseMacStatus({ kind: 'mac-status', host: 3, keyExists: 'yes' })).toMatchObject({ configured: false, host: null, keyExists: false, connection: 'unconfigured' })
  })
  it('rejects other results', () => { expect(() => normaliseMacStatus({ kind: 'status' })).toThrow('Not a devenv mac-status result') })
})

describe('buildMacArgv', () => {
  it('builds each action', () => {
    expect(buildMacArgv('doctor')).toEqual(['mac', 'doctor'])
    expect(buildMacArgv('fix')).toEqual(['mac', 'fix'])
    expect(buildMacArgv('key-setup')).toEqual(['mac', 'key-setup'])
    expect(buildMacArgv('ios-sim')).toEqual(['setup', 'ios-sim'])
    expect(buildMacArgv('ios-sim-remove')).toEqual(['setup', 'ios-sim', '--remove'])
  })
  it('refuses anything else', () => { expect(() => buildMacArgv('rm')).toThrow() })
})

describe('macConnectionText', () => {
  it('explains every state', () => {
    for (const c of ['ok', 'auth', 'hostkey', 'unreachable', 'error', 'unconfigured']) expect(macConnectionText(c)).toMatch(/\w/)
    expect(macConnectionText('auth')).toMatch(/key/i)
    expect(macConnectionText('hostkey')).toMatch(/ssh-keygen -R <its address>/)
  })
})
