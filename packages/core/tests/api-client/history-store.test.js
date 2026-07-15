import { describe, it, expect } from 'vitest'
import { appendHistoryEntry, readHistory, clearHistory } from '../../src/modules/api-client/history-store.js'
import { memFile } from '../helpers/memory-adapters.js'

describe('history-store', () => {
  it('readHistory returns an empty array when no history file exists yet', async () => {
    const file = memFile()
    expect(await readHistory(file, '/col', 'req1')).toEqual([])
  })

  it('appendHistoryEntry stores and returns entries in order, newest last', async () => {
    const file = memFile()
    await appendHistoryEntry(file, '/col', 'req1', { sentAt: 1, status: 'passed' })
    const next = await appendHistoryEntry(file, '/col', 'req1', { sentAt: 2, status: 'failed' })

    expect(next).toEqual([{ sentAt: 1, status: 'passed' }, { sentAt: 2, status: 'failed' }])
    expect(await readHistory(file, '/col', 'req1')).toEqual(next)
  })

  it('caps history at 50 entries, dropping the oldest first (FIFO)', async () => {
    const file = memFile()
    for (let i = 0; i < 55; i++) {
      await appendHistoryEntry(file, '/col', 'req1', { sentAt: i })
    }
    const history = await readHistory(file, '/col', 'req1')
    expect(history).toHaveLength(50)
    expect(history[0]).toEqual({ sentAt: 5 })
    expect(history[49]).toEqual({ sentAt: 54 })
  })

  it('writes a self-excluding .gitignore in the history dir on first append, and does not clobber it later', async () => {
    const file = memFile()
    await appendHistoryEntry(file, '/col', 'req1', { sentAt: 1 })
    expect(await file.read('/col/.history/.gitignore')).toBe('*\n')

    await appendHistoryEntry(file, '/col', 'req1', { sentAt: 2 })
    expect(await file.read('/col/.history/.gitignore')).toBe('*\n')
  })

  it('keeps separate history per refId', async () => {
    const file = memFile()
    await appendHistoryEntry(file, '/col', 'req1', { sentAt: 1 })
    await appendHistoryEntry(file, '/col', 'req2', { sentAt: 2 })

    expect(await readHistory(file, '/col', 'req1')).toEqual([{ sentAt: 1 }])
    expect(await readHistory(file, '/col', 'req2')).toEqual([{ sentAt: 2 }])
  })

  it('clearHistory removes stored entries so readHistory goes back to empty', async () => {
    const file = memFile()
    await appendHistoryEntry(file, '/col', 'req1', { sentAt: 1 })
    await clearHistory(file, '/col', 'req1')
    expect(await readHistory(file, '/col', 'req1')).toEqual([])
  })

  it('clearHistory on a refId with no history is a safe no-op', async () => {
    const file = memFile()
    await expect(clearHistory(file, '/col', 'missing')).resolves.toBeUndefined()
  })
})
