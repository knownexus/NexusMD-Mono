import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'
import React from 'react'
import { NexusDataProvider, WorkItemDetail } from '../src/index.js'

afterEach(cleanup)

describe('WorkItemDetail (shared via injected workItemSource)', () => {
  it('loads detail + comments from the injected source and renders them', async () => {
    const source = {
      loadDetail: vi.fn(async () => ({
        description: 'The description text',
        acceptanceCriteria: null,
        reproSteps: null,
      })),
      loadComments: vi.fn(async () => [
        { id: 1, author: 'Alice', text: '<p>Looks good</p>', createdDate: '2026-01-01' },
      ]),
      saveField: vi.fn(),
      addComment: vi.fn(),
      loadRawFields: vi.fn(),
    }

    const { container } = render(
      <NexusDataProvider value={{ data: {}, workItemSource: source }}>
        <WorkItemDetail id={42} project="Proj" />
      </NexusDataProvider>,
    )

    // The source is consulted with the id/project from props.
    await waitFor(() => expect(source.loadDetail).toHaveBeenCalledWith(42, 'Proj'))
    expect(source.loadComments).toHaveBeenCalledWith(42, 'Proj')

    // Rendered output reflects the normalised shapes the source returned.
    await waitFor(() => expect(container.textContent).toContain('The description text'))
    expect(container.textContent).toContain('Looks good')
  })
})

describe('WorkItemDetail failure handling', () => {
  const wrap = (source, id = 43) => render(
    <NexusDataProvider value={{ data: {}, workItemSource: source }}>
      <WorkItemDetail id={id} project="Proj" />
    </NexusDataProvider>,
  )

  it('still shows the item when only the comments fail to load', async () => {
    const { container } = wrap({
      loadDetail: vi.fn(async () => ({ description: 'Body survives', acceptanceCriteria: null, reproSteps: null })),
      loadComments: vi.fn(async () => { throw new Error('comments down') }),
    })
    await waitFor(() => expect(container.textContent).toContain('Body survives'))
    expect(container.textContent).not.toContain('comments down')
  })

  it('shows the error when the detail itself fails', async () => {
    const { container } = wrap({
      loadDetail: vi.fn(async () => { throw new Error('HTTP 404') }),
      loadComments: vi.fn(async () => []),
    }, 44)
    await waitFor(() => expect(container.textContent).toContain('HTTP 404'))
  })
})
