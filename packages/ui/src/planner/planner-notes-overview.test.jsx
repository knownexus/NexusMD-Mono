import { describe, it, expect, vi, beforeEach } from 'vitest'

const store = { notes: [] }
vi.mock('./planner-notes.jsx', () => ({
  plRowNotes: (row) => Array.isArray(row._notesList) ? row._notesList : [],
  loadGlobalNotes: () => store.notes,
  saveGlobalNotes: (n) => { store.notes = n },
  RowNotesModal: () => null,
}))

import { collectRowNotes, promoteRowNoteToLibrary } from './planner-notes-overview.jsx'

const SECTIONS = [
  { id: 'tasks', title: 'My tasks', type: 'table', hasNotes: true,
    cols: [{ k: 'task', l: 'Task', main: true }] },
  { id: 'meetNotes', title: 'Meetings - notes & decisions', type: 'table', hasNotes: true,
    cols: [{ k: 'meeting', l: 'Meeting', main: true }] },
  { id: 'themes', title: 'Themes', type: 'keyval' },
]

beforeEach(() => { store.notes = [] })

describe('collectRowNotes', () => {
  it('collects only rows that have notes, labelled by section + main col', () => {
    const data = {
      tasks: [
        { id: 'r1', task: 'Ship it', _notesList: [{ id: 'n1', title: 'Plan', body: 'do' }] },
        { id: 'r2', task: 'No notes', _notesList: [] },
      ],
      meetNotes: [
        { id: 'r3', meeting: 'Standup', _notesList: [{ id: 'n2', title: '', body: 'x' }] },
      ],
    }
    const out = collectRowNotes(data, SECTIONS)
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ sectionId: 'tasks', rowId: 'r1', rowLabel: 'Ship it' })
    expect(out[0].notes).toHaveLength(1)
    expect(out[1]).toMatchObject({ sectionId: 'meetNotes', rowId: 'r3', rowLabel: 'Standup' })
  })

  it('ignores non-table and note-less sections', () => {
    const out = collectRowNotes({ themes: { a: 'b' } }, SECTIONS)
    expect(out).toEqual([])
  })

  it('falls back to a placeholder label when the main column is empty', () => {
    const out = collectRowNotes({ tasks: [{ id: 'r1', task: '', _notesList: [{ id: 'n', title: 't', body: '' }] }] }, SECTIONS)
    expect(out[0].rowLabel).toBe('(untitled)')
  })
})

describe('promoteRowNoteToLibrary', () => {
  it('appends a copy to the library with open status', () => {
    const entry = promoteRowNoteToLibrary({ id: 'n1', title: 'Decision', body: 'ship' })
    expect(store.notes).toHaveLength(1)
    expect(store.notes[0]).toMatchObject({ title: 'Decision', body: 'ship', status: 'open', completedWeek: null })
    expect(store.notes[0].id).not.toBe('n1') // fresh library id
    expect(entry).toBe(store.notes[0])
  })

  it('derives a title from the body when the note has no title', () => {
    const entry = promoteRowNoteToLibrary({ id: 'n2', title: '', body: '# Heading\nmore text' })
    expect(entry.title.length).toBeGreaterThan(0)
  })
})
