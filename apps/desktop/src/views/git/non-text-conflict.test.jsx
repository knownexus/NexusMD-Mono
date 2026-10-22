import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { conflictLabels } from '@nexusmd/core'
import { NonTextConflict, nonTextPill } from './non-text-conflict.jsx'

afterEach(cleanup)

const merge = { kind: 'merge', merging: { oid: 'a'.repeat(40), name: 'refs/heads/topic' } }
const labels = conflictLabels(merge, 'main')
const options = () => [...document.querySelectorAll('.nx-resolve-option')].map(b => b.getAttribute('aria-label'))
const mark = () => screen.getByRole('button', { name: /^Mark resolved/ })

describe('NonTextConflict', () => {
  it('delete/modify offers keep or accept as option cards, then Mark resolved', () => {
    const onTake = vi.fn()
    render(<NonTextConflict kind="deleted-by-left" labels={labels} op={merge} binary={false} onTake={onTake} path="src/f.txt" />)
    expect(screen.getByText(/^Your branch \(main\) deleted this file; topic \(being merged\) changed it\./)).toBeTruthy()
    expect(options()).toEqual(['Keep the file', 'Accept the deletion'])
    const keep = screen.getByRole('button', { name: 'Keep the file' })
    expect(keep.dataset.role).toBe('theirs')
    expect(keep.textContent).toContain('Incoming')
    expect(screen.getByRole('button', { name: 'Accept the deletion' }).dataset.role).toBe('mine')
    // Nothing happens until a choice is made and confirmed.
    expect(mark().disabled).toBe(true)
    expect(mark().title).toBe('Choose what happens to the file first')
    fireEvent.click(keep)
    expect(keep.getAttribute('aria-pressed')).toBe('true')
    expect(onTake).not.toHaveBeenCalled()
    fireEvent.click(mark())
    expect(onTake).toHaveBeenLastCalledWith('right')
    fireEvent.click(screen.getByRole('button', { name: 'Accept the deletion' }))
    fireEvent.click(mark())
    expect(onTake).toHaveBeenLastCalledWith('delete')
    cleanup()
    render(<NonTextConflict kind="deleted-by-right" labels={labels} op={merge} binary={false} onTake={onTake} path="f.txt" hasNext />)
    expect(screen.getByText(/^topic \(being merged\) deleted this file; Your branch \(main\) changed it\./)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Keep the file' }).getAttribute('aria-describedby')).toBeTruthy()
    expect(screen.getByText('Keeps your changed f.txt.')).toBeTruthy()
    expect(screen.getByText('Removes f.txt and drops your changes to it.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Keep the file' }))
    fireEvent.click(screen.getByRole('button', { name: 'Mark resolved & next' }))
    expect(onTake).toHaveBeenLastCalledWith('left')
    cleanup()
    render(<NonTextConflict kind="both-deleted" labels={labels} binary={false} onTake={onTake} />)
    expect(options()).toEqual(['Accept the deletion'])
  })

  it('binary offers one side or the other', () => {
    const onTake = vi.fn()
    render(<NonTextConflict kind="both-modified" labels={labels} op={merge} binary onTake={onTake} />)
    expect(screen.getByText(/binary file/)).toBeTruthy()
    expect(options()).toEqual(['Use my version', "Use topic's version"])
    fireEvent.click(screen.getByRole('button', { name: 'Use my version' }))
    fireEvent.click(mark())
    expect(onTake).toHaveBeenLastCalledWith('left')
    fireEvent.click(screen.getByRole('button', { name: "Use topic's version" }))
    fireEvent.click(mark())
    expect(onTake).toHaveBeenLastCalledWith('right')
    cleanup()
    render(<NonTextConflict kind="both-modified" labels={labels} symlink onTake={onTake} />)
    expect(screen.getByText(/symbolic link/)).toBeTruthy()
    expect(options()).toEqual(['Use my version', "Use topic's version"])
    cleanup()
    render(<NonTextConflict kind="added-by-right" labels={labels} binary={false} onTake={onTake} />)
    expect(options()).toEqual(['Use my version', "Use topic's version"])
  })

  it('buttons are disabled while busy', () => {
    render(<NonTextConflict kind="both-deleted" labels={labels} onTake={() => {}} busy />)
    expect(screen.getByRole('button', { name: 'Accept the deletion' }).disabled).toBe(true)
    expect(mark().disabled).toBe(true)
  })
})

describe('nonTextPill', () => {
  const rebase = { kind: 'rebase', onto: { oid: 'a'.repeat(40), name: 'main' }, replaying: { oid: 'b'.repeat(40), subject: 's' } }
  const rl = conflictLabels(rebase, 'x')
  it('says which side deleted the file, by meaning', () => {
    // In a rebase the incoming side (the new base) is on the left.
    expect(nonTextPill({ kind: 'deleted-by-left', labels: rl, op: rebase })).toEqual({ text: 'deleted upstream', tone: 'bad' })
    expect(nonTextPill({ kind: 'deleted-by-right', labels: rl, op: rebase })).toEqual({ text: 'deleted by you', tone: 'bad' })
    // In a merge your branch is on the left.
    expect(nonTextPill({ kind: 'deleted-by-right', labels, op: merge }).text).toBe('deleted upstream')
    expect(nonTextPill({ kind: 'both-deleted', labels }).text).toBe('deleted on both sides')
    expect(nonTextPill({ kind: 'both-modified', labels, binary: true }).text).toBe('binary')
    expect(nonTextPill({ kind: 'both-modified', labels })).toBeNull()
  })
})
