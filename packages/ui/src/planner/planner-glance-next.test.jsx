import React from 'react'
import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import { GlanceView } from './planner-glance.jsx'

afterEach(cleanup)

const sections = [
  { id: 'tasks', title: 'My tasks', type: 'table', cols: [{ k: 'task', l: 'Task', main: true }, { k: 'due', l: 'Due', t: 'date' }, { k: 'status', t: 'status' }] },
  { id: 'eow', title: 'End of week', type: 'table', cols: [{ k: 'item', l: 'Item', main: true }] },
]
const groups = [
  { id: 'week', label: 'My week', icon: 'planner', ids: ['tasks'] },
  { id: 'wrap', label: 'Wrap-up', icon: 'check', ids: ['eow'] },
]
const mount = (data) => render(
  <GlanceView data={data} themes={{}} sections={sections} groups={groups}
    onOpenGroup={() => {}} onOpenSection={() => {}} rowVisible={() => true} carryCount={0} onOpenCarry={() => {}}/>
)

describe('Planner group cards', () => {
  it('show the next thing due in the group: the earliest open item with a date', () => {
    mount({ tasks: [
      { id: 'a', task: 'Later job', due: '2031-12-20', status: 'To do' },
      { id: 'b', task: 'Sooner job', due: '2031-12-05', status: 'To do' },
      { id: 'c', task: 'Finished job', due: '2031-11-01', status: 'Done' },
    ] })
    expect(screen.getByText(/Next: Sooner job · Dec 5/)).toBeTruthy()
    expect(screen.queryByText(/Finished job/)).toBeNull()
  })

  it('show nothing for a group with nothing dated and open', () => {
    mount({ tasks: [{ id: 'a', task: 'Undated', due: '', status: 'To do' }], eow: [] })
    expect(document.querySelector('.gg-next')).toBeNull()
  })
})
