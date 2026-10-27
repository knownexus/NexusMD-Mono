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
    expect(warnings.some(w => w.includes('Create order') && w.includes('pre-request script'))).toBe(true)
    expect(warnings.some(w => w.includes('Get user') && w.includes('tests'))).toBe(true)
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

  it('warns about inherited auth and unsupported request types', async () => {
    const file = memFile({
      '/bru/bruno.json': JSON.stringify({ name: 'X' }),
      '/bru/a.bru': 'meta {\n  name: A\n  type: http\n  seq: 1\n}\n\nget {\n  url: /a\n  body: none\n  auth: inherit\n}\n',
      '/bru/g.bru': 'meta {\n  name: G\n  type: graphql\n  seq: 2\n}\n\npost {\n  url: /gql\n  body: graphql\n  auth: none\n}\n\nbody:graphql {\n  { me { id } }\n}\n',
    })
    const { requests, warnings } = await importBrunoCollection(file, '/bru', { idPrefix: 'b' })
    expect(Object.values(requests).find(r => r.url === '/a').auth).toEqual({ type: 'none' })
    expect(warnings.some(w => w.includes('"A"') && w.includes('inherit'))).toBe(true)
    expect(warnings.some(w => w.includes('"G"') && w.includes('GraphQL'))).toBe(true)
  })

  it('rejects a folder that is not a Bruno collection', async () => {
    const file = memFile({ '/x/readme.md': 'hi' })
    await expect(importBrunoCollection(file, '/x')).rejects.toThrow(/bruno\.json/)
  })
})
