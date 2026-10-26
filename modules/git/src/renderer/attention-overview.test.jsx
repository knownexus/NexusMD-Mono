import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { AttentionOverview } from './attention-overview.jsx'

afterEach(cleanup)

const tree = over => ({ repo: 'R', repoRoot: 'C:/r', path: 'C:/r', branch: 'feat', upstream: null, upstreamGone: false, ahead: 0, behind: 0, operation: '', error: '', changes: [], ...over })
const show = t => render(<AttentionOverview trees={[t]} repoCount={1} onOpen={() => {}} onAction={() => {}} />)

describe('AttentionOverview not published card', () => {
  it('prefixes the commits off the source', () => {
    show(tree({ source: { ref: 'refs/heads/master', count: 3 } }))
    expect(screen.getByText('3 commits off master · Only exists on this machine')).toBeTruthy()
  })
  it('is unchanged without commits off the source', () => {
    show(tree({ source: { ref: 'refs/heads/master', count: 0 } }))
    expect(screen.getByText('Only exists on this machine')).toBeTruthy()
  })
})
