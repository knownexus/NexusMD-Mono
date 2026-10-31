import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BuildArtifactsSheet } from './build-artifacts-sheet.jsx'

const build = { id: 9, pipeline: 'CI', source: 'ado', projectName: 'P' }
const items = [
  { provider: 'ado', name: 'drop', size: 2048, url: 'https://dev.azure.com/a', filename: 'drop.zip', expired: false },
  { provider: 'ado', name: 'old', size: 1, url: 'https://dev.azure.com/b', filename: 'old.zip', expired: true },
]

describe('BuildArtifactsSheet', () => {
  it('lists artifacts and saves the one you pick', async () => {
    const save = vi.fn(async () => ({ bytes: 2048 }))
    render(<BuildArtifactsSheet build={build} onClose={() => {}} list={async () => items} save={save} supported={() => true} />)
    await screen.findByText('drop')
    const buttons = screen.getAllByRole('button', { name: /Download/ })
    expect(buttons[1].disabled).toBe(true)          // expired
    fireEvent.click(buttons[0])
    await waitFor(() => expect(save).toHaveBeenCalledWith(items[0]))
  })

  it('says when there is nothing to download', async () => {
    render(<BuildArtifactsSheet build={build} onClose={() => {}} list={async () => []} save={vi.fn()} supported={() => true} />)
    await screen.findByText('This build published no artifacts.')
  })

  it('shows why the list could not load', async () => {
    render(<BuildArtifactsSheet build={build} onClose={() => {}} list={async () => { throw new Error('Azure DevOps answered 403') }} save={vi.fn()} supported={() => true} />)
    await screen.findByText('Azure DevOps answered 403')
  })

  it('cannot download outside the Android app', async () => {
    render(<BuildArtifactsSheet build={build} onClose={() => {}} list={async () => [items[0]]} save={vi.fn()} supported={() => false} />)
    await screen.findByText('drop')
    expect(screen.getByRole('button', { name: /Download/ }).disabled).toBe(true)
  })
})
