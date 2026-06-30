import { describe, it, expect } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import React from 'react'
import { NexusDataProvider, SectionCard } from '../src/index.js'
import { PLANNER_SECTIONS } from '@nexusmd/core'

// Regression: the meetNotes section is the only one that is BOTH hasNotes:true
// and has a meeting column. Its row actions call plRowNotes()/plOpenCtx(), which
// must be imported into planner-editors.jsx — a missing import there throws a
// ReferenceError at render/right-click and white-screens the whole app.
const meetNotes = PLANNER_SECTIONS.find(s => s.id === 'meetNotes')

function withProvider(ui) {
  return render(
    <NexusDataProvider value={{ data: {}, namespace: 'nexusmd', getProfileKey: (k) => k, storage: window.localStorage }}>
      {ui}
    </NexusDataProvider>,
  )
}

describe('planner meetNotes section', () => {
  it('renders rows and opens the notes modal without throwing', () => {
    let data = {
      meetNotes: [{ id: 'r1', meeting: 'Standup' }],
      meetSched: [{ id: 'm1', meeting: 'Standup', dayTime: 'Mon 9' }],
    }
    const setData = (next) => { data = typeof next === 'function' ? next(data) : next }

    const { container } = withProvider(
      <SectionCard section={meetNotes} data={data} setData={setData} themes={{}} setThemes={() => {}}
        entryStyle="table" domId="sec-meetNotes" sessionUnlocked={true}
        meetingOptions={data.meetSched} />,
    )

    // "Add notes" button is rendered for hasNotes rows (relies on plRowNotes import).
    const notesBtn = container.querySelector('.notes-btn')
    expect(notesBtn).toBeTruthy()
    fireEvent.click(notesBtn)

    // Modal opened and "New note" is available (no ReferenceError thrown).
    const addNote = [...document.querySelectorAll('button')].find(b => /new note|first note/i.test(b.textContent))
    expect(addNote).toBeTruthy()
  })
})
