import { describe, it, expect } from 'vitest'
import {
  resolveVars, resolveObjectVars, secretStorageKey,
  resolveEnvironment, setSecretVar, removeSecretVar,
} from '../../src/modules/api-client/var-resolve.js'

function memSecureStorage(initial = {}) {
  const m = new Map(Object.entries(initial))
  return {
    async get(key) { return m.has(key) ? m.get(key) : null },
    async set(key, value) { m.set(key, value) },
    async remove(key) { m.delete(key) },
    _dump: () => Object.fromEntries(m),
  }
}

describe('resolveVars', () => {
  it('substitutes {{key}} placeholders from a flat vars map', () => {
    expect(resolveVars('{{baseUrl}}/users/{{id}}', { baseUrl: 'https://api.test', id: 42 }))
      .toBe('https://api.test/users/42')
  })

  it('leaves unresolved placeholders untouched', () => {
    expect(resolveVars('{{missing}}', {})).toBe('{{missing}}')
  })

  it('passes non-string values through unchanged', () => {
    expect(resolveVars(42, {})).toBe(42)
    expect(resolveVars(null, {})).toBe(null)
  })
})

describe('resolveObjectVars', () => {
  it('recursively resolves strings inside nested objects/arrays', () => {
    const input = { url: '{{baseUrl}}/x', headers: { Authorization: 'Bearer {{token}}' }, tags: ['{{env}}', 'static'] }
    const vars = { baseUrl: 'https://api.test', token: 'abc', env: 'dev' }
    expect(resolveObjectVars(input, vars)).toEqual({
      url: 'https://api.test/x',
      headers: { Authorization: 'Bearer abc' },
      tags: ['dev', 'static'],
    })
  })
})

describe('resolveEnvironment', () => {
  it('resolves plain values directly from the environment definition', async () => {
    const envDef = { variables: { baseUrl: { value: 'https://dev.example.com' } } }
    const resolved = await resolveEnvironment(memSecureStorage(), 'col1', 'dev', envDef)
    expect(resolved).toEqual({ baseUrl: 'https://dev.example.com' })
  })

  it('resolves secret-marked values from secureStorage, not the file', async () => {
    const key = secretStorageKey('col1', 'dev', 'apiKey')
    const secureStorage = memSecureStorage({ [key]: 'super-secret' })
    const envDef = { variables: { apiKey: { secret: true } } }

    const resolved = await resolveEnvironment(secureStorage, 'col1', 'dev', envDef)
    expect(resolved).toEqual({ apiKey: 'super-secret' })
  })

  it('resolves a missing secret to an empty string rather than throwing', async () => {
    const envDef = { variables: { apiKey: { secret: true } } }
    const resolved = await resolveEnvironment(memSecureStorage(), 'col1', 'dev', envDef)
    expect(resolved).toEqual({ apiKey: '' })
  })
})

describe('setSecretVar / removeSecretVar', () => {
  it('writes and removes a secret under its namespaced key', async () => {
    const secureStorage = memSecureStorage()
    await setSecretVar(secureStorage, 'col1', 'dev', 'apiKey', 'shh')
    expect(secureStorage._dump()).toEqual({ [secretStorageKey('col1', 'dev', 'apiKey')]: 'shh' })

    await removeSecretVar(secureStorage, 'col1', 'dev', 'apiKey')
    expect(secureStorage._dump()).toEqual({})
  })
})
