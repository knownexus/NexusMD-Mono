import { describe, it, expect } from 'vitest'
import {
  profileFileKind, isProfilePath, textStyle, parseJsonText, formatJson, validateEnvironment, validateMacConfig,
  validateProfileFile, setIn, addRepository, removeRepository, moveRepository, renameRepository,
  unknownEnvironmentFields, unknownMacFields,
} from './profile.js'

// devenv's profile.example/environment.json, verbatim.
const EXAMPLE = "{\n  \"name\": \"example\",\n  \"repositories\": {\n    \"orders\": {\n      \"source\": \"../orders-api/main\",\n      \"ref\": \"main\",\n      \"project\": \"src/Orders.Api/Orders.Api.csproj\",\n      \"label\": \"Orders\",\n      \"kind\": \"api\",\n      \"port\": 5101,\n      \"dll\": \"Orders.Api.dll\",\n      \"docker\": true,\n      \"start\": true,\n      \"migrationGuard\": true,\n      \"test\": { \"port\": 5201, \"db\": \"Orders_Local\" }\n    },\n    \"mobile\": {\n      \"source\": \"../mobile-app/main\",\n      \"ref\": \"main\",\n      \"project\": \"src/Example.App/Example.App.csproj\",\n      \"label\": \"Mobile\",\n      \"kind\": \"mobile\",\n      \"start\": true\n    }\n  },\n  \"database\": {\n    \"name\": \"Orders_Local\",\n    \"databases\": [ \"Orders_Local\" ],\n    \"sourceContainer\": \"some-existing-sql-container\"\n  },\n  \"mobile\": {\n    \"packageId\": \"com.example.app\"\n  },\n  \"test\": {\n    \"defaultServices\": [ \"orders\" ],\n    \"collection\": \"api-tests\",\n    \"collectionEnv\": \"docker\",\n    \"wiring\": [],\n    \"extraDbConn\": {},\n    \"collectionPatterns\": { \"order\": \"orders\" }\n  }\n}\n"
const example = () => JSON.parse(EXAMPLE)
const at = r => r.errors.map(e => e.at)
const warnAt = r => r.warnings.map(e => e.at)
const withRepo = (patch, key = 'orders') => { const e = example(); e.repositories[key] = { ...e.repositories[key], ...patch }; return e }

describe('profileFileKind', () => {
  it('knows the two structured files, case-insensitively', () => {
    expect(profileFileKind('environment.json')).toBe('environment')
    expect(profileFileKind('Environment.JSON')).toBe('environment')
    expect(profileFileKind('mac.json')).toBe('mac')
  })
  it('sorts the rest by extension, wherever they are', () => {
    expect(profileFileKind('docker/test/servicebus-config.json')).toBe('json')
    expect(profileFileKind('docker\\environment.json')).toBe('json')
    expect(profileFileKind('docker/services.compose.yml')).toBe('yaml')
    expect(profileFileKind('x.YAML')).toBe('yaml')
    expect(profileFileKind('commands.ps1')).toBe('text')
  })
})

describe('isProfilePath', () => {
  it('accepts plain relative paths', () => {
    expect(isProfilePath('sql/new.sql')).toBe(true)
    expect(isProfilePath('docker\\a.env')).toBe(true)
  })
  it.each(['../x', 'a/../x', 'C:\\x', '/x', '\\\\s\\x', 'a//b', './a', '', 'a\u0000'])('refuses %j', p => {
    expect(isProfilePath(p)).toBe(false)
  })
})

describe('text style and JSON', () => {
  it('detects BOM and line endings', () => {
    expect(textStyle('\uFEFF{\r\n}')).toEqual({ bom: true, eol: '\r\n' })
    expect(textStyle('{\n}')).toEqual({ bom: false, eol: '\n' })
    expect(textStyle('{}')).toEqual({ bom: false, eol: '\n' })
  })
  it('parses past a BOM and reports where JSON breaks', () => {
    expect(parseJsonText('\uFEFF{"a":1}').value).toEqual({ a: 1 })
    const r = parseJsonText('{\n  "a": 1,\n  oops\n}')
    expect(r.error).toMatch(/^Not valid JSON/)
    expect(r.error).toMatch(/line 3/)
  })
  it('formats with 2 spaces in the file\'s own style', () => {
    expect(formatJson({ a: [1] }, { bom: true, eol: '\r\n' })).toBe('\uFEFF{\r\n  "a": [\r\n    1\r\n  ]\r\n}\r\n')
    expect(formatJson({}, { bom: false, eol: '\n' })).toBe('{}\n')
  })
})

describe('validateEnvironment', () => {
  it('accepts devenv\'s example as it is', () => {
    expect(validateEnvironment(example())).toEqual({ errors: [], warnings: [] })
  })
  it('needs an object with repositories', () => {
    expect(at(validateEnvironment([]))).toEqual([''])
    expect(at(validateEnvironment({ name: 'x' }))).toEqual(['repositories'])
    expect(warnAt(validateEnvironment({ repositories: {} }))).toEqual(['repositories'])
  })
  it('needs a usable repository key', () => {
    const e = example()
    e.repositories['my api'] = e.repositories.orders
    expect(at(validateEnvironment(e))).toContain('repositories.my api')
  })
  it('needs source, ref and project', () => {
    expect(at(validateEnvironment(withRepo({ source: '', ref: 3, project: undefined })))).toEqual([
      'repositories.orders.source', 'repositories.orders.ref', 'repositories.orders.project',
    ])
  })
  it('needs a known kind', () => {
    expect(at(validateEnvironment(withRepo({ kind: 'service' })))).toEqual(['repositories.orders.kind'])
  })
  it('the mobile app must be keyed mobile', () => {
    const e = example()
    e.repositories.app = e.repositories.mobile
    delete e.repositories.mobile
    expect(at(validateEnvironment(e))).toEqual(['repositories.app'])
  })
  it('warns when a mobile app has no package id', () => {
    const e = example()
    delete e.mobile
    const r = validateEnvironment(e)
    expect(r.errors).toEqual([])
    expect(warnAt(r)).toEqual(['mobile.packageId'])
  })
  it('checks ports and warns about clashes', () => {
    expect(at(validateEnvironment(withRepo({ port: 70000 })))).toEqual(['repositories.orders.port'])
    expect(at(validateEnvironment(withRepo({ port: '5101' })))).toEqual(['repositories.orders.port'])
    expect(warnAt(validateEnvironment(withRepo({ port: 5201 })))).toEqual(['repositories.orders.test.port'])
  })
  it('needs real booleans for the switches', () => {
    expect(at(validateEnvironment(withRepo({ docker: 'false', start: 1 })))).toEqual(['repositories.orders.docker', 'repositories.orders.start'])
  })
  it('checks the test block', () => {
    expect(at(validateEnvironment(withRepo({ test: { port: 5201 } })))).toEqual(['repositories.orders.test.db'])
    expect(at(validateEnvironment(withRepo({ test: true })))).toEqual(['repositories.orders.test'])
  })
  it('default services must be repositories with a test block', () => {
    const e = example()
    e.test.defaultServices = ['orders', 'mobile', 'nope']
    expect(at(validateEnvironment(e))).toEqual(['test.defaultServices.1', 'test.defaultServices.2'])
  })
  it('wiring must join real repositories', () => {
    const e = example()
    e.test.wiring = [{ from: 'orders', to: 'mobile', key: 'Api:Url' }, { from: 'orders', to: 'x', key: '' }, 'junk']
    expect(at(validateEnvironment(e))).toEqual(['test.wiring.1.to', 'test.wiring.1.key', 'test.wiring.2'])
  })
  it('extraDbConn and collectionPatterns are objects of text', () => {
    const e = example()
    e.test.extraDbConn = { Conn: 1 }
    e.test.collectionPatterns = []
    expect(at(validateEnvironment(e))).toEqual(['test.extraDbConn', 'test.collectionPatterns'])
  })
  it('database.databases is a list of names', () => {
    const e = example()
    e.database.databases = 'Orders_Local'
    expect(at(validateEnvironment(e))).toEqual(['database.databases'])
  })
})

describe('validateMacConfig', () => {
  it('uses Get-MacConfig\'s rules', () => {
    expect(validateMacConfig({ host: 'mac.local', user: 'me', sshKey: 'C:\\k' }).errors).toEqual([])
    expect(validateMacConfig({ host: '10.0.0.5', user: 'first.last' }).errors).toEqual([])
    expect(at(validateMacConfig({ host: 'mac local', user: 'me; rm' }))).toEqual(['host', 'user'])
    expect(at(validateMacConfig({ host: 'm', user: 'u', sshKey: 5 }))).toEqual(['sshKey'])
    expect(at(validateMacConfig(null))).toEqual([''])
  })
})

describe('validateProfileFile', () => {
  it('runs the structured rules on the two known files', () => {
    expect(validateProfileFile('environment.json', EXAMPLE).errors).toEqual([])
    expect(validateProfileFile('mac.json', '{"host":"m"}').errors.map(e => e.at)).toEqual(['user'])
  })
  it('checks other JSON parses', () => {
    expect(validateProfileFile('docker/mobile-proxy/routes.json', '{').errors[0].message).toMatch(/Not valid JSON/)
    expect(validateProfileFile('docker/mobile-proxy/routes.json', '[]').errors).toEqual([])
  })
  it('uses the injected YAML parser', () => {
    const parseYaml = () => { throw new Error('bad indentation at line 2') }
    expect(validateProfileFile('docker/services.compose.yml', 'a: [', { parseYaml }).errors).toEqual([
      { at: '', message: 'Not valid YAML: bad indentation at line 2' },
    ])
    expect(validateProfileFile('docker/services.compose.yml', 'a: 1', { parseYaml: () => ({}) }).errors).toEqual([])
  })
  it('anything else is plain text', () => {
    expect(validateProfileFile('commands.ps1', '{{{')).toEqual({ errors: [], warnings: [] })
  })
})

describe('edits', () => {
  it('a form edit keeps unknown fields, key order, BOM and CRLF', () => {
    const text = '\uFEFF{\r\n  "notes": "keep",\r\n  "repositories": {\r\n    "orders": { "envFile": "x.env", "port": 5101, "source": "s" }\r\n  },\r\n  "test": { "future": 1 }\r\n}\r\n'
    const next = formatJson(setIn(parseJsonText(text).value, ['repositories', 'orders', 'port'], 5102), textStyle(text))
    expect(next).toBe('\uFEFF{\r\n  "notes": "keep",\r\n  "repositories": {\r\n    "orders": {\r\n      "envFile": "x.env",\r\n      "port": 5102,\r\n      "source": "s"\r\n    }\r\n  },\r\n  "test": {\r\n    "future": 1\r\n  }\r\n}\r\n')
  })
  it('setIn creates missing parents and never mutates', () => {
    const e = { a: 1 }
    expect(setIn(e, ['database', 'name'], 'x')).toEqual({ a: 1, database: { name: 'x' } })
    expect(e).toEqual({ a: 1 })
  })
  it('setIn with undefined deletes, and drops a parent the delete emptied', () => {
    expect(setIn({ r: { docker: true, port: 1 } }, ['r', 'docker'], undefined)).toEqual({ r: { port: 1 } })
    expect(setIn({ test: { port: 1 } }, ['test', 'port'], undefined)).toEqual({})
  })
  it('setIn keeps an empty object that was already in the file', () => {
    expect(setIn({ test: {} }, ['test', 'nope'], undefined)).toEqual({ test: {} })
  })
  it('setIn edits and removes list items', () => {
    expect(setIn({ l: ['a', 'b', 'c'] }, ['l', 1], undefined)).toEqual({ l: ['a', 'c'] })
    expect(setIn({ l: [{ k: 1 }] }, ['l', 0, 'k'], 2)).toEqual({ l: [{ k: 2 }] })
  })
  it('adds, moves and removes repositories in place', () => {
    let e = addRepository(example(), 'billing')
    expect(Object.keys(e.repositories)).toEqual(['orders', 'mobile', 'billing'])
    expect(e.repositories.billing).toEqual({ source: '', ref: 'main', project: '', kind: 'api' })
    expect(() => addRepository(e, 'orders')).toThrow('already a repository')
    e = moveRepository(e, 'billing', -2)
    expect(Object.keys(e.repositories)).toEqual(['billing', 'orders', 'mobile'])
    expect(moveRepository(e, 'billing', -1)).toEqual(e)
    e = removeRepository(e, 'orders')
    expect(Object.keys(e.repositories)).toEqual(['billing', 'mobile'])
    // References are left for validation to point out.
    expect(at(validateEnvironment(e))).toContain('test.defaultServices.0')
  })
  it('renaming keeps the position and follows test references', () => {
    const e = example()
    e.test.wiring = [{ from: 'orders', to: 'orders', key: 'Self' }]
    const r = renameRepository(e, 'orders', 'sales')
    expect(Object.keys(r.repositories)).toEqual(['sales', 'mobile'])
    expect(r.test.defaultServices).toEqual(['sales'])
    expect(r.test.wiring).toEqual([{ from: 'sales', to: 'sales', key: 'Self' }])
    expect(r.test.collectionPatterns).toEqual({ order: 'orders' })
    expect(() => renameRepository(e, 'orders', 'mobile')).toThrow('already a repository')
  })
})

describe('unknown fields', () => {
  it('lists what the forms don\'t edit', () => {
    const e = example()
    e.notes = 1
    e.repositories.orders.envFile = 'x'
    e.repositories.orders.test.extra = true
    e.test.future = 1
    expect(unknownEnvironmentFields(e)).toEqual(['notes', 'repositories.orders.envFile', 'repositories.orders.test.extra', 'test.future'])
    expect(unknownEnvironmentFields(example())).toEqual([])
    expect(unknownMacFields({ host: 'h', user: 'u', port: 22 })).toEqual(['port'])
  })
})
