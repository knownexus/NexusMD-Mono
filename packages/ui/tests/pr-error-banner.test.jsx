import { it, expect, afterEach } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
import React from 'react'
import { NexusDataProvider, PRView } from '../src/index.js'

function memStorage(seed = {}) {
  const m = new Map(Object.entries(seed))
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }
}

afterEach(cleanup)

function renderView(data) {
  return render(
    <NexusDataProvider value={{ storage: memStorage(), getProfileKey: k => k, pushPref: () => {}, data: { ORG: 'o', TEAM: [], ...data } }}>
      <PRView prs={[]} onOpen={() => {}} needsMeCriteria={{ votes: [0] }} setNeedsMeCriteria={() => {}} />
    </NexusDataProvider>
  )
}

const MSG = 'PRs unavailable (HTTP 401) — check the ADO PAT has Code (Read) scope'

it('shows the PR load error as a banner, with the detail as its tooltip', () => {
  renderView({ PR_ERROR: MSG, PR_ERROR_DETAIL: 'ADO GET proj/_apis/git/repositories → 401' })
  const banner = screen.getByRole('alert')
  expect(banner.textContent).toContain(MSG)
  expect(banner.getAttribute('title')).toBe('ADO GET proj/_apis/git/repositories → 401')
})

it('falls back to the ADO provider warning', () => {
  renderView({ WORK_ITEM_PROVIDERS: [{ id: 'ado', label: 'Azure DevOps', status: 'ok', warning: MSG }] })
  expect(screen.getByRole('alert').textContent).toContain(MSG)
})

it('shows no banner when PRs loaded fine', () => {
  renderView({ PR_ERROR: null })
  expect(screen.queryByRole('alert')).toBeNull()
})
