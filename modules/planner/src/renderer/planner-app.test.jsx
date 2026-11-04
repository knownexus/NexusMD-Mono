import React from 'react'
import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@nexusmd/shell-sdk', () => ({ getProfileKey: k => k }))
vi.mock('./planner-store.js', () => ({ usePlannerStore: () => [{}, vi.fn(), [], vi.fn()] }))
vi.mock('@nexusmd/ui', () => ({
  plannerExportDocx: vi.fn(),
  toast: vi.fn(),
  PlannerView: ({ onCloudSync }) => <div>{onCloudSync && <button onClick={onCloudSync}>cloud sync</button>}</div>,
}))

import { PlannerApp } from './planner-app.jsx'

afterEach(cleanup)

describe('Planner cloud sync button', () => {
  it('with the backup switch off the planner shows no cloud sync button', () => {
    render(<PlannerApp host={{ sync: { enabled: () => false, syncOnce: vi.fn() } }} />)
    expect(screen.queryByText('cloud sync')).toBeNull()
  })
  it('with the switch on the button shows', () => {
    render(<PlannerApp host={{ sync: { enabled: () => true, syncOnce: vi.fn() } }} />)
    expect(screen.getByText('cloud sync')).toBeTruthy()
  })
  it('a host without the switch (e.g. the phone app) keeps the button', () => {
    render(<PlannerApp host={{ sync: { syncOnce: vi.fn() } }} />)
    expect(screen.getByText('cloud sync')).toBeTruthy()
  })
})
