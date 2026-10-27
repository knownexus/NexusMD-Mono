import { describe, it, expect } from 'vitest'
import { parseBru, importBrunoCollection } from '../../src/modules/api-client/bruno-import.js'
import { memFile } from '../helpers/memory-adapters.js'

const GET_USER = `meta {
  name: Get user
  type: http
  seq: 2
}

get {
  url: {{baseUrl}}/users/1?verbose=true
  body: none
  auth: bearer
}

params:query {
  verbose: true
  ~debug: 1
}

headers {
  Accept: application/json
  ~X-Old: gone
}

auth:bearer {
  token: {{token}}
}

tests {
  test("ok", function () {
    expect(res.status).to.equal(200);
  });
}
`

const LIST_USERS = `meta {
  name: List users
  type: http
  seq: 1
}

get {
  url: {{baseUrl}}/users
  body: none
  auth: none
}
`

const CREATE_ORDER = `meta {
  name: Create order
  type: http
  seq: 1
}

post {
  url: {{baseUrl}}/orders
  body: json
  auth: basic
}

auth:basic {
  username: admin
  password: {{password}}
}

body:json {
  {
    "sku": "abc",
    "nested": { "a": 1 }
  }
}

script:pre-request {
  bru.setVar("x", 1);
}
`

const LOGIN = `meta {
  name: Login
  type: http
  seq: 2
}

post {
  url: {{baseUrl}}/login
  body: formUrlEncoded
  auth: apikey
}

auth:apikey {
  key: X-Api-Key
  value: {{apiKey}}
  placement: queryparams
}

body:form-urlencoded {
  user: me
  ~remember: true
}
`

const LOCAL_ENV = `vars {
  baseUrl: http://localhost:3000
  ~unused: x
}
vars:secret [
  token,
  password
]
`

function brunoFixture() {
  return memFile({
    '/bru/bruno.json': JSON.stringify({ version: '1', name: 'Demo API', type: 'collection' }),
    '/bru/collection.bru': 'auth {\n  mode: none\n}\n',
    '/bru/Get user.bru': GET_USER,
    '/bru/List users.bru': LIST_USERS,
    '/bru/orders/folder.bru': 'meta {\n  name: Orders\n}\n',
    '/bru/orders/Create order.bru': CREATE_ORDER,
    '/bru/orders/Login.bru': LOGIN,
    '/bru/environments/Local.bru': LOCAL_ENV,
  })
}

describe('parseBru', () => {
  it('parses dictionary blocks, marking ~-prefixed entries disabled', () => {
    const blocks = parseBru(GET_USER)
    expect(blocks.meta).toEqual([
      { key: 'name', value: 'Get user', enabled: true },
      { key: 'type', value: 'http', enabled: true },
      { key: 'seq', value: '2', enabled: true },
    ])
    expect(blocks.headers).toEqual([
      { key: 'Accept', value: 'application/json', enabled: true },
      { key: 'X-Old', value: 'gone', enabled: false },
    ])
  })

  it('keeps text blocks verbatim, minus the two-space block indent', () => {
    const blocks = parseBru(CREATE_ORDER)
    expect(blocks['body:json']).toBe('{\n  "sku": "abc",\n  "nested": { "a": 1 }\n}')
  })

  it('parses list blocks', () => {
    expect(parseBru(LOCAL_ENV)['vars:secret']).toEqual(['token', 'password'])
  })

  it('splits only on the first colon, so URLs survive', () => {
    expect(parseBru(LIST_USERS).get).toContainEqual({ key: 'url', value: '{{baseUrl}}/users', enabled: true })
  })
})

describe('importBrunoCollection', () => {
  it('takes the collection name from bruno.json', async () => {
    const { meta } = await importBrunoCollection(brunoFixture(), '/bru', { idPrefix: 'b' })
    expect(meta).toEqual({ name: 'Demo API', description: '' })
  })

  it('builds the tree folders-first, with requests ordered by seq', async () => {
    const { tree } = await importBrunoCollection(brunoFixture(), '/bru', { idPrefix: 'b' })
    expect(tree.map(n => n.name)).toEqual(['Orders', 'List users', 'Get user'])
    expect(tree[0].type).toBe('folder')
    expect(tree[0].children.map(n => n.name)).toEqual(['Create order', 'Login'])
  })

  it('gives every request a unique refId under the prefix', async () => {
    const { requests } = await importBrunoCollection(brunoFixture(), '/bru', { idPrefix: 'b' })
    const ids = Object.keys(requests)
    expect(ids).toHaveLength(4)
    expect(ids.every(id => id.startsWith('b-'))).toBe(true)
  })

  it('maps method, url, enabled params/headers and bearer auth', async () => {
    const { tree, requests } = await importBrunoCollection(brunoFixture(), '/bru', { idPrefix: 'b' })
    const req = requests[tree[2].refId]
    expect(req.method).toBe('GET')
    // The query string moves into params so it isn't sent twice.
    expect(req.url).toBe('{{baseUrl}}/users/1')
    expect(req.params).toEqual({ verbose: 'true' })
    expect(req.headers).toEqual({ Accept: 'application/json' })
    expect(req.auth).toEqual({ type: 'bearer', token: '{{token}}' })
    expect(req.bodyType).toBe('none')
  })

  it('maps a JSON body and basic auth', async () => {
    const { tree, requests } = await importBrunoCollection(brunoFixture(), '/bru', { idPrefix: 'b' })
    const req = requests[tree[0].children[0].refId]
    expect(req.method).toBe('POST')
    expect(req.bodyType).toBe('raw')
    expect(req.bodyLanguage).toBe('json')
    expect(JSON.parse(req.body)).toEqual({ sku: 'abc', nested: { a: 1 } })
    expect(req.auth).toEqual({ type: 'basic', username: 'admin', password: '{{password}}' })
  })

  it('maps a form-urlencoded body and query-placed api key auth', async () => {
    const { tree, requests } = await importBrunoCollection(brunoFixture(), '/bru', { idPrefix: 'b' })
    const req = requests[tree[0].children[1].refId]
    expect(req.bodyType).toBe('urlencoded')
    expect(req.body).toEqual([{ key: 'user', value: 'me' }])
    expect(req.auth).toEqual({ type: 'apikey', key: 'X-Api-Key', value: '{{apiKey}}', in: 'query' })
  })

  it('does not import scripts or tests, but warns that they existed', async () => {
    const { requests, warnings } = await importBrunoCollection(brunoFixture(), '/bru', { idPrefix: 'b' })
    for (const req of Object.values(requests)) {
      expect(req.preRequestScript).toBe('')
      expect(req.postResponseScript).toBe('')
      expect(req.tests).toBe('')
    }
    // One grouped line naming both requests, not a line per script.
    const scriptLines = warnings.filter(w => w.startsWith('Scripts and tests were not imported'))
    expect(scriptLines).toHaveLength(1)
    expect(scriptLines[0]).toContain('2 affected')
    expect(scriptLines[0]).toContain('"Create order"')
    expect(scriptLines[0]).toContain('"Get user"')
  })

  it('groups a repeated problem into one line, listing a few names and counting the rest', async () => {
    const files = { '/bru/bruno.json': JSON.stringify({ name: 'Big' }) }
    for (let i = 1; i <= 8; i++) {
      files[`/bru/r${i}.bru`] = `meta {\n  name: R${i}\n  seq: ${i}\n}\n\nget {\n  url: /r${i}\n  body: none\n  auth: none\n}\n\ntests {\n  test("x", () => {});\n}\n`
    }
    const { warnings } = await importBrunoCollection(memFile(files), '/bru', { idPrefix: 'b' })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('8 affected: "R1", "R2", "R3", "R4", "R5" and 3 more')
  })

  it('warns once about collection- and folder-level scripts', async () => {
    const file = memFile({
      '/bru/bruno.json': JSON.stringify({ name: 'X' }),
      '/bru/collection.bru': 'script:pre-request {\n  bru.setVar("a", 1);\n}\n',
      '/bru/f/folder.bru': 'meta {\n  name: F\n}\n\nscript:pre-request {\n  req.setHeader("a", "b");\n}\n',
      '/bru/f/a.bru': 'meta {\n  name: A\n  seq: 1\n}\n\nget {\n  url: /a\n  body: none\n  auth: none\n}\n',
    })
    const { warnings } = await importBrunoCollection(file, '/bru', { idPrefix: 'b' })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/^Collection- and folder-level scripts/)
    expect(warnings[0]).toContain('2 affected: "X", "f"')
  })

  it('imports environments, with secret vars marked secret and disabled vars skipped', async () => {
    const { environments } = await importBrunoCollection(brunoFixture(), '/bru', { idPrefix: 'b' })
    expect(environments).toEqual({
      Local: {
        variables: {
          baseUrl:  { value: 'http://localhost:3000' },
          token:    { secret: true },
          password: { secret: true },
        },
      },
    })
  })

  it('treats inherited auth as none when nothing up the tree sets auth, without a warning', async () => {
    const file = memFile({
      '/bru/bruno.json': JSON.stringify({ name: 'X' }),
      '/bru/a.bru': 'meta {\n  name: A\n  type: http\n  seq: 1\n}\n\nget {\n  url: /a\n  body: none\n  auth: inherit\n}\n',
    })
    const { requests, warnings } = await importBrunoCollection(file, '/bru', { idPrefix: 'b' })
    expect(Object.values(requests)[0].auth).toEqual({ type: 'none' })
    expect(warnings).toEqual([])
  })

  it('warns about GraphQL requests and bodies', async () => {
    const file = memFile({
      '/bru/bruno.json': JSON.stringify({ name: 'X' }),
      '/bru/g.bru': 'meta {\n  name: G\n  type: graphql\n  seq: 2\n}\n\npost {\n  url: /gql\n  body: graphql\n  auth: none\n}\n\nbody:graphql {\n  { me { id } }\n}\n',
    })
    const { warnings } = await importBrunoCollection(file, '/bru', { idPrefix: 'b' })
    expect(warnings.some(w => w.startsWith('GraphQL requests') && w.includes('"G"'))).toBe(true)
    expect(warnings.some(w => w.startsWith('GraphQL bodies') && w.includes('"G"'))).toBe(true)
  })

  describe('inheritance from collection.bru and folder.bru', () => {
    const req = (name, auth, extra = '') =>
      `meta {\n  name: ${name}\n  seq: 1\n}\n\nget {\n  url: /${name}\n  body: none\n  auth: ${auth}\n}\n${extra}`

    function inheritFixture() {
      return memFile({
        '/bru/bruno.json': JSON.stringify({ name: 'X' }),
        '/bru/collection.bru': 'auth {\n  mode: bearer\n}\n\nauth:bearer {\n  token: {{token}}\n}\n\nheaders {\n  Content-Type: application/json\n  X-Scope: collection\n}\n',
        '/bru/root.bru': req('root', 'inherit'),
        '/bru/own.bru': req('own', 'none', '\nheaders {\n  X-Scope: request\n}\n'),
        '/bru/keyed/folder.bru': 'meta {\n  name: Keyed\n}\n\nauth {\n  mode: apikey\n}\n\nauth:apikey {\n  key: X-Api-Key\n  value: {{serviceApiKey}}\n  placement: header\n}\n\nheaders {\n  X-Scope: folder\n}\n',
        '/bru/keyed/nested/deep.bru': req('deep', 'inherit'),
        '/bru/plain/inner.bru': req('inner', 'inherit'),
      })
    }
    const byUrl = (requests, url) => Object.values(requests).find(r => r.url === url)

    it('gives inherit requests the collection auth', async () => {
      const { requests } = await importBrunoCollection(inheritFixture(), '/bru', { idPrefix: 'b' })
      expect(byUrl(requests, '/root').auth).toEqual({ type: 'bearer', token: '{{token}}' })
      // A folder with no auth of its own passes the collection's through.
      expect(byUrl(requests, '/inner').auth).toEqual({ type: 'bearer', token: '{{token}}' })
    })

    it('lets the nearest folder that sets auth win over the collection', async () => {
      const { requests } = await importBrunoCollection(inheritFixture(), '/bru', { idPrefix: 'b' })
      expect(byUrl(requests, '/deep').auth).toEqual({ type: 'apikey', key: 'X-Api-Key', value: '{{serviceApiKey}}', in: 'header' })
    })

    it('leaves a request with its own auth mode alone', async () => {
      const { requests } = await importBrunoCollection(inheritFixture(), '/bru', { idPrefix: 'b' })
      expect(byUrl(requests, '/own').auth).toEqual({ type: 'none' })
    })

    it('layers headers collection, then folder, then request', async () => {
      const { requests } = await importBrunoCollection(inheritFixture(), '/bru', { idPrefix: 'b' })
      expect(byUrl(requests, '/root').headers).toEqual({ 'Content-Type': 'application/json', 'X-Scope': 'collection' })
      expect(byUrl(requests, '/deep').headers).toEqual({ 'Content-Type': 'application/json', 'X-Scope': 'folder' })
      expect(byUrl(requests, '/own').headers).toEqual({ 'Content-Type': 'application/json', 'X-Scope': 'request' })
    })
  })

  describe('folders', () => {
    const req = (name) => `meta {\n  name: ${name}\n  seq: 1\n}\n\nget {\n  url: /${name}\n  body: none\n  auth: none\n}\n`

    it('orders by directory name when only some folders have a seq', async () => {
      const file = memFile({
        '/bru/bruno.json': JSON.stringify({ name: 'X' }),
        '/bru/01-auth/a.bru': req('a'),
        '/bru/07-secure/folder.bru': 'meta {\n  name: Secure\n  seq: 7\n}\n',
        '/bru/07-secure/s.bru': req('s'),
        '/bru/90-surface/z.bru': req('z'),
      })
      const { tree } = await importBrunoCollection(file, '/bru', { idPrefix: 'b' })
      expect(tree.map(n => n.name)).toEqual(['01-auth', 'Secure', '90-surface'])
    })

    it('orders by seq when every folder has one', async () => {
      const file = memFile({
        '/bru/bruno.json': JSON.stringify({ name: 'X' }),
        '/bru/a/folder.bru': 'meta {\n  name: A\n  seq: 2\n}\n',
        '/bru/a/a.bru': req('a'),
        '/bru/b/folder.bru': 'meta {\n  name: B\n  seq: 1\n}\n',
        '/bru/b/b.bru': req('b'),
      })
      const { tree } = await importBrunoCollection(file, '/bru', { idPrefix: 'b' })
      expect(tree.map(n => n.name)).toEqual(['B', 'A'])
    })

    it('skips folders that hold no requests', async () => {
      const file = memFile({
        '/bru/bruno.json': JSON.stringify({ name: 'X' }),
        '/bru/tools/seed.sql': 'select 1',
        '/bru/requests/bruno-1.json': '{}',
        '/bru/empty/inner/notes.md': 'hi',
        '/bru/api/a.bru': req('a'),
      })
      const { tree } = await importBrunoCollection(file, '/bru', { idPrefix: 'b' })
      expect(tree.map(n => n.name)).toEqual(['api'])
    })
  })

  it('rejects a folder that is not a Bruno collection', async () => {
    const file = memFile({ '/x/readme.md': 'hi' })
    await expect(importBrunoCollection(file, '/x')).rejects.toThrow(/bruno\.json/)
  })
})
