import { describe, it, expect } from 'vitest'
import { buildBranchArgv } from './source-branch.js'

describe('buildBranchArgv', () => {
  it('changes a source branch by repository key', () => {
    expect(buildBranchArgv('mobile')).toEqual(['source', 'branch', 'mobile'])
    expect(() => buildBranchArgv('-x')).toThrow()
    expect(() => buildBranchArgv(undefined)).toThrow()
  })
})
