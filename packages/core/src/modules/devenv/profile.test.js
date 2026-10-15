import { describe, it, expect } from 'vitest'
import {
  profileFileKind, validateProfileFile, validateEnvironment, validateMac, detectEol, toLf, fromLf,
  setIn, formatJson, newRepository, addRepository, renameRepository, removeRepository,
} from './profile.js'

const ENV = {
  name: 'example',
  repositories: {
    orders: { source: '../orders/main', ref: 'main', project: 'src/O.csproj', label: 'Orders', kind: 'api', port: 5101, dll: 'O.dll', docker: true, start: true, migrationGuard: true, test: { port: 5201, db: 'Orders_Local' } },
    mobile: { source: '../app/main', ref: 'main', project: 'src/A.csproj', kind: 'mobile', start: true },
  },
  database: { name: 'Orders_Local', databases: ['Orders_Local'], sourceContainer: 'sql-dev' },
  mobile: { packageId: 'com.example.app' },
  test: { defaultServices: ['orders'], collection: 'api-tests', collectionEnv: 'docker', wiring: [{ from: 'orders', to: 'orders', key: 'Self__Url', always: true }], extraDbConn: {}, collectionPatterns: { order: 'orders' } },
}
const msgs = env => validateEnvironment(env).map(e => e.message)

describe('profileFileKind', () => {
  it('maps extensions to editor languages', () => {
    expect(['environment.json', 'docker/a.yml', 'x.yaml', 'commands.ps1', 'sql/a.sql', 'README.md', 'api-tests/a.bru', 'docker/a.env'].map(profileFileKind))
      .toEqual(['json', 'yaml', 'yaml', 'powershell', 'sql', 'markdown', 'text', 'text'])
  })
})

describe('validateEnvironment', () => {
  it('accepts the example profile', () => { expect(validateEnvironment(ENV)).toEqual([]) })
  it('needs repositories with the required fields', () => {
    expect(msgs({})).toContain('repositories needs at least one repository.')
    const m = msgs({ repositories: { 'Bad Key': { kind: 'api' }, b: { source: 'x', ref: '-x', project: 'p', kind: 'desktop', port: 70000 } } })
    expect(m.some(x => /Bad Key.*lower-case/.test(x))).toBe(true)
    expect(m).toContain('b: ref can\'t start with \'-\'.')
    expect(m).toContain('b: kind must be api, mobile or web.')
    expect(m).toContain('b: port must be a whole number from 1 to 65535.')
    expect(m.filter(x => /: (source|ref|project) is required\./.test(x))).toHaveLength(3)
  })
  it('checks types of the optional fields and the test block', () => {
    const env = structuredClone(ENV)
    Object.assign(env.repositories.orders, { docker: 'yes', label: 3, test: { port: '5201' } })
    const m = msgs(env)
    expect(m).toContain('orders: docker must be true or false.')
    expect(m).toContain('orders: label must be text.')
    expect(m).toContain('orders: test.port must be a whole number from 1 to 65535.')
    expect(m).toContain('orders: test.db is required.')
  })
  it('ties the mobile app to the "mobile" key and mobile.packageId', () => {
    const env = structuredClone(ENV); delete env.mobile
    expect(msgs(env)).toContain('A mobile repository needs mobile.packageId (the app id, e.g. com.example.app).')
    const renamed = structuredClone(ENV); renamed.repositories.app = renamed.repositories.mobile; delete renamed.repositories.mobile
    expect(msgs(renamed)).toContain('The mobile app\'s repository must be named "mobile" (not "app").')
  })
  it('checks database and test sections against the repositories', () => {
    const env = structuredClone(ENV)
    env.database.sourceContainer = 'bad name'; env.database.databases = 'Orders_Local'
    env.test.defaultServices = ['mobile']; env.test.wiring = [{ from: 'nope', to: 'orders', key: '' }]
    const m = msgs(env)
    expect(m).toContain('database.sourceContainer must be a container name (letters, digits, _ . -).')
    expect(m).toContain('database.databases must be a list of names.')
    expect(m).toContain('test.defaultServices: "mobile" isn\'t a repository with a test block.')
    expect(m).toContain('test.wiring 1: from must be one of the repositories.')
    expect(m).toContain('test.wiring 1: key (the setting name) is required.')
  })
})

describe('validateMac', () => {
  it('checks host, user and sshKey', () => {
    expect(validateMac({ host: '10.0.0.5', user: 'me.name', sshKey: 'C:\\k' })).toEqual([])
    expect(validateMac({ host: 'bad host', user: 'a b' }).map(e => e.path)).toEqual(['host', 'user'])
    expect(validateMac([]).length).toBe(1)
  })
})

describe('validateProfileFile', () => {
  it('reports JSON syntax errors with a line', () => {
    const [e] = validateProfileFile('docker/x.json', '{\n  "a": 1,\n}')
    expect(e.line).toBe(3)
  })
  it('validates environment.json and mac.json at the profile root only', () => {
    expect(validateProfileFile('environment.json', '{}')[0].message).toBe('repositories needs at least one repository.')
    expect(validateProfileFile('mac.json', '{"host":"m","user":"u"}')).toEqual([])
    expect(validateProfileFile('docker/environment.json', '{}')).toEqual([])
  })
  it('reports YAML errors with a line and accepts compose files', () => {
    expect(validateProfileFile('docker/services.compose.yml', 'services:\n  api:\n    image: x\n    volumes:\n      - ${DEVENV_ROOT}/a:/a\n')).toEqual([])
    const [e] = validateProfileFile('a.yml', 'a: [1, 2\nb: 3\n')
    expect(e.line).toBeGreaterThan(0)
  })
  it('does not validate other files', () => { expect(validateProfileFile('commands.ps1', '{{{')).toEqual([]) })
})

describe('line endings', () => {
  it('detects, strips and restores CRLF', () => {
    expect(detectEol('a\r\nb')).toBe('\r\n'); expect(detectEol('a\nb')).toBe('\n')
    expect(toLf('a\r\nb\r\n')).toBe('a\nb\n')
    expect(fromLf('a\nb\n', '\r\n')).toBe('a\r\nb\r\n'); expect(fromLf('a\nb', '\n')).toBe('a\nb')
  })
})

describe('edit helpers', () => {
  it('setIn sets, creates and deletes without mutating', () => {
    const o = { a: { b: 1 }, list: [{ x: 1 }] }
    expect(setIn(o, ['a', 'c'], 2)).toEqual({ a: { b: 1, c: 2 }, list: [{ x: 1 }] })
    expect(setIn(o, ['a', 'b'], undefined)).toEqual({ a: {}, list: [{ x: 1 }] })
    expect(setIn(o, ['n', 'm'], 1).n).toEqual({ m: 1 })
    expect(setIn(o, ['list', 0, 'x'], 5).list).toEqual([{ x: 5 }])
    expect(o).toEqual({ a: { b: 1 }, list: [{ x: 1 }] })
  })
  it('formats JSON with two spaces and a final newline', () => { expect(formatJson({ a: 1 })).toBe('{\n  "a": 1\n}\n') })
  it('renames the repository key inside test.extraDbConn, in order', () => {
    const env = { repositories: { a: {}, b: {} }, test: { extraDbConn: { a: { x: 1 }, b: { y: 2 } } } }
    const renamed = renameRepository(env, 'a', 'c')
    expect(Object.entries(renamed.test.extraDbConn)).toEqual([['c', { x: 1 }], ['b', { y: 2 }]])
    expect(renameRepository({ repositories: { a: {} }, test: { extraDbConn: 5 } }, 'a', 'c').test.extraDbConn).toBe(5)
  })
  it('renames repository keys used as test.collectionPatterns values, leaving the regex keys and order alone', () => {
    const env = { repositories: { a: {}, b: {} }, test: { collectionPatterns: { '^a-': 'a', other: 'b', '^a2': 'a' } } }
    const renamed = renameRepository(env, 'a', 'c')
    expect(Object.entries(renamed.test.collectionPatterns)).toEqual([['^a-', 'c'], ['other', 'b'], ['^a2', 'c']])
    expect(renameRepository({ repositories: { a: {} }, test: { collectionPatterns: 5 } }, 'a', 'c').test.collectionPatterns).toBe(5)
    expect(env.test.collectionPatterns['^a-']).toBe('a')
  })
  it('reports test.collectionPatterns values that are not repositories', () => {
    const env = structuredClone(ENV)
    env.test.collectionPatterns = { order: 'orders', gone: 'ghost', num: 5 }
    const errs = validateEnvironment(env)
    expect(errs.map(e => e.message)).toEqual([
      'test.collectionPatterns "gone" points at "ghost", which isn\'t a repository.',
      'test.collectionPatterns "num" points at "5", which isn\'t a repository.',
    ])
    expect(errs[0].path).toBe('test.collectionPatterns.gone')
  })
  it('adds, renames (in order, with references) and removes repositories', () => {
    const added = addRepository(ENV, 'billing')
    expect(added.repositories.billing).toEqual(newRepository())
    const renamed = renameRepository(ENV, 'orders', 'ordering')
    expect(Object.keys(renamed.repositories)).toEqual(['ordering', 'mobile'])
    expect(renamed.test.defaultServices).toEqual(['ordering'])
    expect(renamed.test.wiring[0]).toMatchObject({ from: 'ordering', to: 'ordering' })
    const removed = removeRepository(ENV, 'orders')
    expect(Object.keys(removed.repositories)).toEqual(['mobile'])
    expect(removed.test.defaultServices).toEqual([])
    expect(ENV.repositories.orders).toBeTruthy()
  })
  it('removeRepository drops wiring, extraDbConn and collectionPatterns that point at it', () => {
    const env = {
      repositories: { a: { source: 'x', ref: 'main', project: 'p', kind: 'api' }, b: { source: 'y', ref: 'main', project: 'q', kind: 'api' } },
      test: {
        defaultServices: ['a', 'b'],
        wiring: [{ from: 'a', to: 'b', key: 'S1' }, { from: 'b', to: 'a', key: 'S2' }, { from: 'b', to: 'b', key: 'S3' }],
        extraDbConn: { a: { K: 'DbA' }, b: { K: 'DbB' } },
        collectionPatterns: { 'x|y': 'a', z: 'b' },
      },
    }
    const next = removeRepository(env, 'a')
    expect(Object.keys(next.repositories)).toEqual(['b'])
    expect(next.test.defaultServices).toEqual(['b'])
    expect(next.test.wiring).toEqual([{ from: 'b', to: 'b', key: 'S3' }])
    expect(next.test.extraDbConn).toEqual({ b: { K: 'DbB' } })
    expect(next.test.collectionPatterns).toEqual({ z: 'b' })
    expect(env.test.wiring).toHaveLength(3)
  })
  it('removeRepository leaves odd test values alone', () => {
    const env = { repositories: { a: {} }, test: { wiring: 'nope', extraDbConn: 5, collectionPatterns: null } }
    expect(removeRepository(env, 'a').test).toEqual({ wiring: 'nope', extraDbConn: 5, collectionPatterns: null })
  })
})
