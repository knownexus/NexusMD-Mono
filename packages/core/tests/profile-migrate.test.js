import { describe, it, expect } from 'vitest'
import { planProfileScopeMigration } from '../src/index.js'

describe('planProfileScopeMigration', () => {
  it('folds flat keys into the profile scope, leaving registry + scoped + foreign keys alone', () => {
    const keys = [
      'nexusmd.dash.widgetOrder',          // flat data → migrate
      'nexusmd.ado.config',                // flat data → migrate
      'nexusmd.profiles',                  // registry → keep
      'nexusmd.activeProfileId',           // app-level → keep
      'nexusmd.p.existing.tweaks',         // already scoped → keep
      'helm.dash.widgetOrder',             // other namespace → ignore
      'someThirdPartyKey',                 // foreign → ignore
    ]
    const moves = planProfileScopeMigration(keys, 'nexusmd', 'abc123')
    expect(moves).toEqual([
      { from: 'nexusmd.dash.widgetOrder', to: 'nexusmd.p.abc123.dash.widgetOrder' },
      { from: 'nexusmd.ado.config',       to: 'nexusmd.p.abc123.ado.config' },
    ])
  })

  it('returns an empty plan when there is nothing to migrate', () => {
    expect(planProfileScopeMigration([], 'nexusmd', 'id')).toEqual([])
    expect(planProfileScopeMigration(['nexusmd.profiles', 'nexusmd.p.id.x'], 'nexusmd', 'id')).toEqual([])
    expect(planProfileScopeMigration(undefined, 'nexusmd', 'id')).toEqual([])
  })
})
