// Test data for the Profile tab: devenv's profile.example/environment.json, verbatim.
import { vi } from 'vitest'
export const EXAMPLE_ENV = "{\n  \"name\": \"example\",\n  \"repositories\": {\n    \"orders\": {\n      \"source\": \"../orders-api/main\",\n      \"ref\": \"main\",\n      \"project\": \"src/Orders.Api/Orders.Api.csproj\",\n      \"label\": \"Orders\",\n      \"kind\": \"api\",\n      \"port\": 5101,\n      \"dll\": \"Orders.Api.dll\",\n      \"docker\": true,\n      \"start\": true,\n      \"migrationGuard\": true,\n      \"test\": { \"port\": 5201, \"db\": \"Orders_Local\" }\n    },\n    \"mobile\": {\n      \"source\": \"../mobile-app/main\",\n      \"ref\": \"main\",\n      \"project\": \"src/Example.App/Example.App.csproj\",\n      \"label\": \"Mobile\",\n      \"kind\": \"mobile\",\n      \"start\": true\n    }\n  },\n  \"database\": {\n    \"name\": \"Orders_Local\",\n    \"databases\": [ \"Orders_Local\" ],\n    \"sourceContainer\": \"some-existing-sql-container\"\n  },\n  \"mobile\": {\n    \"packageId\": \"com.example.app\"\n  },\n  \"test\": {\n    \"defaultServices\": [ \"orders\" ],\n    \"collection\": \"api-tests\",\n    \"collectionEnv\": \"docker\",\n    \"wiring\": [],\n    \"extraDbConn\": {},\n    \"collectionPatterns\": { \"order\": \"orders\" }\n  }\n}\n"

export const DIR = 'C:\\repos\\dev-environment\\profile'
export const CFG = { root: 'C:\\repos\\dev-environment', pwsh: 'pwsh', profile: '' }

// An in-memory profile behind the adapter's profile calls, with the same stamp rule as main.
export function fakeProfileAdapter(files = {}, { dir = DIR } = {}) {
  const disk = new Map(Object.entries(files))
  let n = 0
  const stamps = new Map()
  const stampOf = path => {
    if (!disk.has(path)) return null
    const key = `${path}\u0000${disk.get(path)}`
    if (!stamps.has(key)) stamps.set(key, `s${++n}`)
    return stamps.get(key)
  }
  const adapter = {
    disk,
    open: vi.fn(async () => ({ ok: true })),
    listProfileFiles: vi.fn(async () => ({
      dir, exists: disk.has('environment.json'), truncated: false,
      files: [...disk.keys()].sort().map(path => ({ path, size: disk.get(path).length })),
    })),
    readProfileFile: vi.fn(async (_cfg, path) => (disk.has(path)
      ? { dir, path, text: disk.get(path), stamp: stampOf(path) }
      : { dir, path, missing: true, stamp: null })),
    writeProfileFile: vi.fn(async (_cfg, path, text, { expected }) => {
      const current = stampOf(path)
      if (current !== expected) return { ok: false, stale: true, stamp: current }
      disk.set(path, text)
      return { ok: true, stamp: stampOf(path) }
    }),
    // What another program (devenv, an editor) does to the file meanwhile.
    changeOnDisk(path, text) { disk.set(path, text) },
  }
  return adapter
}
