import { describe, it, expect } from 'vitest'
import { screenKey, colsFor, entriesFor, flow, layoutFor, sourceFor, withLayout, withoutLayout } from './dashboard-layout.js'

const display = (pw, ph, scale = 1) => ({ width: Math.round(pw / scale), height: Math.round(ph / scale), scaleFactor: scale, physicalWidth: pw, physicalHeight: ph })

describe('screens', () => {
  it('keys a screen by its real resolution', () => {
    expect(screenKey(display(3840, 2160, 1.5))).toBe('3840x2160')
    expect(screenKey(display(1920, 1080))).toBe('1920x1080')
  })

  it('gives one column per ~320 laid-out px, so Windows scaling counts', () => {
    expect(colsFor(display(1920, 1080))).toBe(6)
    expect(colsFor(display(3840, 2160, 1.5))).toBe(8)
    expect(colsFor(display(3840, 1600))).toBe(12)
    expect(colsFor(display(5120, 1440))).toBe(16)
    expect(colsFor(display(1024, 768))).toBe(4)
    expect(colsFor(display(7680, 2160))).toBe(16)
  })
})

describe('entries and flow', () => {
  const cards = [{ id: 'review', span: 1 }, { id: 'team', span: 2 }]
  const widgets = [{ id: 'a', half: true }, { id: 'b', half: false }]

  it('lists the cards then the added widgets, sized from the old width/height settings', () => {
    const e = entriesFor({ cards, widgets, widgetWidths: { review: true }, widgetHeights: { team: 600 } })
    expect(e.map(x => x.key)).toEqual(['card:review', 'card:team', 'w:a', 'w:b'])
    expect(e[0].wide).toBe(true)
    expect(e[1].rows).toBe(11)
    expect(e[2]).toMatchObject({ wide: false, rows: 6 })
  })

  it('flows narrow widgets side by side and wraps', () => {
    const items = flow(entriesFor({ cards: [{ id: 'a', span: 1 }, { id: 'b', span: 1 }, { id: 'c', span: 1 }] }), 6)
    expect(items.map(({ x, y, w }) => [x, y, w])).toEqual([[0, 0, 3], [3, 0, 3], [0, 8, 3]])
  })
})

describe('layoutFor', () => {
  const entries = entriesFor({ cards: [{ id: 'review', span: 1 }], widgets: [{ id: 'time', half: true }] })

  it('flows everything when nothing is saved', () => {
    const { items, own } = layoutFor({}, '1920x1080', 6, entries)
    expect(own).toBe(false)
    expect(items).toEqual([{ i: 'card:review', x: 0, y: 0, w: 3, h: 8 }, { i: 'w:time', x: 3, y: 0, w: 3, h: 6 }])
  })

  it("uses the screen's own layout", () => {
    const saved = { '1920x1080': { cols: 6, items: [{ i: 'card:review', x: 2, y: 4, w: 4, h: 5 }, { i: 'w:time', x: 0, y: 0, w: 2, h: 4 }] } }
    const { items, own } = layoutFor(saved, '1920x1080', 6, entries)
    expect(own).toBe(true)
    expect(items).toEqual(saved['1920x1080'].items)
  })

  it('starts a new screen from the nearest resolution, scaled to its columns', () => {
    const saved = {
      '3840x1600': { cols: 12, items: [{ i: 'card:review', x: 6, y: 0, w: 6, h: 8 }, { i: 'w:time', x: 0, y: 0, w: 4, h: 6 }] },
      '1280x720': { cols: 4, items: [{ i: 'card:review', x: 0, y: 0, w: 4, h: 8 }] },
    }
    expect(sourceFor(saved, '2560x1440').key).toBe('3840x1600')
    const { items, own } = layoutFor(saved, '2560x1440', 8, entries)
    expect(own).toBe(false)
    expect(items).toEqual([{ i: 'card:review', x: 4, y: 0, w: 4, h: 8 }, { i: 'w:time', x: 0, y: 0, w: 3, h: 6 }])
  })

  it('drops widgets that are gone, adds new ones below, and fits widths to the columns', () => {
    const saved = { '1920x1080': { cols: 6, items: [{ i: 'card:gone', x: 0, y: 0, w: 6, h: 8 }, { i: 'card:review', x: 4, y: 0, w: 9, h: 1 }] } }
    const { items } = layoutFor(saved, '1920x1080', 6, entries)
    expect(items).toEqual([{ i: 'card:review', x: 0, y: 0, w: 6, h: 3 }, { i: 'w:time', x: 0, y: 3, w: 3, h: 6 }])
  })

  it('ignores a broken saved value', () => {
    expect(layoutFor({ '1920x1080': { cols: 6 } }, '1920x1080', 6, entries).own).toBe(false)
    expect(layoutFor(null, '1920x1080', 6, entries).items).toHaveLength(2)
  })
})

describe('saving', () => {
  it('sets and clears one screen, leaving the others', () => {
    const other = { cols: 12, items: [] }
    const next = withLayout({ '3840x1600': other }, '1920x1080', 6, [{ i: 'w:a', x: 0, y: 0, w: 2, h: 3, moved: false, static: false }])
    expect(next).toEqual({ '3840x1600': other, '1920x1080': { cols: 6, items: [{ i: 'w:a', x: 0, y: 0, w: 2, h: 3 }] } })
    expect(withoutLayout(next, '1920x1080')).toEqual({ '3840x1600': other })
  })
})
