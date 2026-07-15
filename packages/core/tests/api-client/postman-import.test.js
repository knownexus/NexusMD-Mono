import { describe, it, expect } from 'vitest'
import { importPostmanCollection } from '../../src/modules/api-client/postman-import.js'

// A small representative Postman v2.1 export: root request with bearer auth,
// a nested folder with a raw-JSON POST, and a test script using pm.* (should warn).
const POSTMAN_FIXTURE = {
  info: { name: 'Demo API', description: 'sample', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
  item: [
    {
      name: 'Get user',
      request: {
        method: 'GET',
        header: [{ key: 'Accept', value: 'application/json' }],
        url: { raw: '{{baseUrl}}/users/1?verbose=true', query: [{ key: 'verbose', value: 'true' }] },
        auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}' }] },
      },
      event: [],
    },
    {
      name: 'Orders',
      item: [
        {
          name: 'Create order',
          request: {
            method: 'post',
            header: [],
            url: { raw: '{{baseUrl}}/orders' },
            body: { mode: 'raw', raw: '{"sku":"abc"}' },
            auth: { type: 'noauth' },
          },
          event: [
            { listen: 'test', script: { exec: ["pm.test('status 200', function () { pm.response.to.have.status(200); });"] } },
          ],
        },
      ],
    },
  ],
}

describe('importPostmanCollection', () => {
  it('maps collection info into meta', () => {
    const { meta } = importPostmanCollection(POSTMAN_FIXTURE)
    expect(meta).toEqual({ name: 'Demo API', description: 'sample' })
  })

  it('maps a root-level request with query params and bearer auth', () => {
    const { tree, requests } = importPostmanCollection(POSTMAN_FIXTURE)
    const rootNode = tree[0]
    expect(rootNode.type).toBe('request')
    expect(rootNode.name).toBe('Get user')

    const req = requests[rootNode.refId]
    expect(req.method).toBe('GET')
    expect(req.url).toBe('{{baseUrl}}/users/1?verbose=true')
    expect(req.params).toEqual({ verbose: 'true' })
    expect(req.headers).toEqual({ Accept: 'application/json' })
    expect(req.auth).toEqual({ type: 'bearer', token: '{{token}}' })
  })

  it('preserves folder nesting and maps a raw-JSON body request inside it', () => {
    const { tree, requests } = importPostmanCollection(POSTMAN_FIXTURE)
    const folder = tree[1]
    expect(folder).toEqual(expect.objectContaining({ type: 'folder', name: 'Orders' }))
    expect(folder.children).toHaveLength(1)

    const child = folder.children[0]
    const req = requests[child.refId]
    expect(req.method).toBe('POST') // uppercased
    expect(req.body).toBe('{"sku":"abc"}')
    expect(req.auth).toEqual({ type: 'none' })
  })

  it('does not auto-import a test script (scripts run arbitrary code) but flags it with a warning', () => {
    const { tree, requests, warnings } = importPostmanCollection(POSTMAN_FIXTURE)
    const child = tree[1].children[0]
    expect(requests[child.refId].tests).toBeUndefined()
    expect(warnings.some(w => w.includes('Create order') && w.includes('not imported') && w.includes('arbitrary code'))).toBe(true)
  })

  it('handles an empty collection without throwing', () => {
    const result = importPostmanCollection({ info: { name: 'Empty' }, item: [] })
    expect(result.tree).toEqual([])
    expect(result.requests).toEqual({})
    expect(result.warnings).toEqual([])
  })

  it('warns on an unsupported body mode and unsupported auth type without throwing', () => {
    const fixture = {
      info: { name: 'X' },
      item: [{
        name: 'GraphQL thing',
        request: {
          method: 'POST',
          url: { raw: '/gql' },
          body: { mode: 'graphql', graphql: { query: '{ me }' } },
          auth: { type: 'digest' },
        },
      }],
    }
    const { requests, tree, warnings } = importPostmanCollection(fixture)
    const req = requests[tree[0].refId]
    expect(req.body).toBeUndefined()
    expect(req.auth).toEqual({ type: 'none' })
    expect(warnings.some(w => w.includes('graphql'))).toBe(true)
    expect(warnings.some(w => w.includes('digest'))).toBe(true)
  })
})
