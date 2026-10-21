import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { conflictLabels } from '@nexusmd/core'
import { NonTextConflict } from './non-text-conflict.jsx'

afterEach(cleanup)

const labels = conflictLabels({ kind: 'merge', merging: { oid: 'a'.repeat(40), name: 'refs/heads/topic' } }, 'main')
const buttons = () => screen.getAllByRole('button').map(b => b.textContent)

describe('NonTextConflict', () => {
  it('delete/modify offers keep or accept', () => {
    const onTake = vi.fn()
    render(<NonTextConflict kind="deleted-by-left" labels={labels} binary={false} onTake={onTake} />)
    expect(screen.getByText('Your branch (main) deleted this file; topic (being merged) changed it.')).toBeTruthy()
    expect(buttons()).toEqual(["Keep topic's version", 'Accept the deletion'])
    fireEvent.click(screen.getByRole('button', { name: "Keep topic's version" }))
    expect(onTake).toHaveBeenLastCalledWith('right')
    fireEvent.click(screen.getByRole('button', { name: 'Accept the deletion' }))
    expect(onTake).toHaveBeenLastCalledWith('delete')
    cleanup()
    render(<NonTextConflict kind="deleted-by-right" labels={labels} binary={false} onTake={onTake} />)
    expect(screen.getByText('topic (being merged) deleted this file; Your branch (main) changed it.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Keep my version' }))
    expect(onTake).toHaveBeenLastCalledWith('left')
    cleanup()
    render(<NonTextConflict kind="both-deleted" labels={labels} binary={false} onTake={onTake} />)
    expect(buttons()).toEqual(['Accept the deletion'])
  })

  it('binary offers one side or the other', () => {
    const onTake = vi.fn()
    render(<NonTextConflict kind="both-modified" labels={labels} binary onTake={onTake} />)
    expect(screen.getByText(/binary file/)).toBeTruthy()
    expect(buttons()).toEqual(['Use my version', "Use topic's version"])
    fireEvent.click(screen.getByRole('button', { name: 'Use my version' }))
    expect(onTake).toHaveBeenLastCalledWith('left')
    fireEvent.click(screen.getByRole('button', { name: "Use topic's version" }))
    expect(onTake).toHaveBeenLastCalledWith('right')
    cleanup()
    render(<NonTextConflict kind="both-modified" labels={labels} symlink onTake={onTake} />)
    expect(screen.getByText(/symbolic link/)).toBeTruthy()
    expect(buttons()).toEqual(['Use my version', "Use topic's version"])
    cleanup()
    render(<NonTextConflict kind="added-by-right" labels={labels} binary={false} onTake={onTake} />)
    expect(buttons()).toEqual(['Use my version', "Use topic's version"])
  })

  it('buttons are disabled while busy', () => {
    render(<NonTextConflict kind="both-deleted" labels={labels} onTake={() => {}} busy />)
    expect(screen.getByRole('button', { name: 'Accept the deletion' }).disabled).toBe(true)
  })
})
