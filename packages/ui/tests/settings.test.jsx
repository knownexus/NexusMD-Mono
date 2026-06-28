import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import React from 'react'
import {
  NexusDataProvider, PlToggle, VsRow, VsSeg, VsProfileEditor, VsProfiles, PROFILE_COLORS,
} from '../src/index.js'

afterEach(cleanup)

function withProvider(ui, value = {}) {
  return render(
    <NexusDataProvider value={{ data: {}, namespace: 'nexusmd', getProfileKey: (k) => k, ...value }}>
      {ui}
    </NexusDataProvider>,
  )
}

describe('shared settings primitives (web + app)', () => {
  it('PlToggle reflects checked state and fires onChange', () => {
    const onChange = vi.fn()
    const { container } = render(<PlToggle checked={true} onChange={onChange} />)
    const box = container.querySelector('input[type="checkbox"]')
    expect(box).toBeTruthy()
    expect(box.checked).toBe(true)
    box.click()
    expect(onChange).toHaveBeenCalled()
  })

  it('VsRow renders its title and description', () => {
    const { container } = render(<VsRow title="Density" desc="How compact the UI is" />)
    expect(container.textContent).toContain('Density')
    expect(container.textContent).toContain('How compact the UI is')
  })

  it('VsSeg renders one button per option and marks the active one', () => {
    const { container } = render(
      <VsSeg value="b" options={[['a', 'A'], ['b', 'B'], ['c', 'C']]} onChange={() => {}} />,
    )
    const btns = container.querySelectorAll('button')
    expect(btns).toHaveLength(3)
    expect(container.querySelector('button.active')?.textContent).toBe('B')
  })

  it('VsProfileEditor shows the Organisation-label field only when showOrgLabel', () => {
    const web = withProvider(
      <VsProfileEditor profile={{ name: 'X', initials: 'X', color: PROFILE_COLORS[0] }}
        onSave={() => {}} onDelete={() => {}} onExport={() => {}} onClose={() => {}} />,
    )
    expect(web.container.textContent).toContain('Organisation label')
    cleanup()
    const app = withProvider(
      <VsProfileEditor profile={{ name: 'X', initials: 'X', color: PROFILE_COLORS[0] }}
        onSave={() => {}} onDelete={() => {}} onExport={() => {}} onClose={() => {}} showOrgLabel={false} />,
    )
    expect(app.container.textContent).not.toContain('Organisation label')
  })

  it('VsProfileEditor omits orgLabel from onSave payload when showOrgLabel=false (app)', () => {
    const onSave = vi.fn()
    const { container } = withProvider(
      <VsProfileEditor profile={{ name: 'Acme', initials: 'AC', color: PROFILE_COLORS[0], type: 'ado' }}
        onSave={onSave} onDelete={() => {}} onExport={() => {}} onClose={() => {}} showOrgLabel={false} />,
    )
    // Click "Save" (the primary footer button).
    const save = [...container.querySelectorAll('button')].find(b => b.textContent === 'Save')
    save.click()
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0][0]).not.toHaveProperty('orgLabel')
  })

  it('VsProfiles renders the injected profile list (profileApi prop seam)', () => {
    const profileApi = {
      profiles: [{ id: 'p1', name: 'Work', initials: 'WK', color: '#9a7e22', type: 'ado' }],
      activeId: 'p1',
      switchProfile: vi.fn(), createProfile: vi.fn(), updateProfile: vi.fn(),
      deleteProfile: vi.fn(), exportProfile: vi.fn(), importProfile: vi.fn(),
    }
    const { container } = withProvider(<VsProfiles profileApi={profileApi} />)
    expect(container.textContent).toContain('Work')
    expect(container.textContent).toContain('Active')
  })
})
