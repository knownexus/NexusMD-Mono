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
    expect(e[1].rows).toBe(18)
    expect(e[2]).toMatchObject({ wide: false, rows: 9 })
  })

  it('flows narrow widgets side by side and wraps', () => {
    const items = flow(entriesFor({ cards: [{ id: 'a', span: 1 }, { id: 'b', span: 1 }, { id: 'c', span: 1 }] }), 6)
    expect(items.map(({ x, y, w }) => [x, y, w])).toEqual([[0, 0, 3], [3, 0, 3], [0, 12, 3]])
  })

  it("sizes the page's head parts by their share of the columns", () => {
    const parts = [
      { id: 'page-greeting', bare: true, top: true, frac: 0.5, rows: 2 },
      { id: 'page-actions', bare: true, top: true, frac: 0.5, rows: 2 },
      ...['a', 'b', 'c', 'd', 'e'].map(id => ({ id: `stat-${id}`, bare: true, top: true, frac: 0.25, rows: 4 })),
    ]
    const items = flow(entriesFor({ cards: parts }), 12)
    expect(items.map(({ i, x, y, w, h }) => [i, x, y, w, h])).toEqual([
      ['card:page-greeting', 0, 0, 6, 2], ['card:page-actions', 6, 0, 6, 2],
      ['card:stat-a', 0, 2, 3, 4], ['card:stat-b', 3, 2, 3, 4], ['card:stat-c', 6, 2, 3, 4], ['card:stat-d', 9, 2, 3, 4],
      ['card:stat-e', 0, 6, 3, 4],
    ])
  })
})

describe('layoutFor', () => {
  const entries = entriesFor({ cards: [{ id: 'review', span: 1 }], widgets: [{ id: 'time', half: true }] })

  it('flows everything when nothing is saved', () => {
    const { items, own } = layoutFor({}, '1920x1080', 6, entries)
    expect(own).toBe(false)
    expect(items).toEqual([{ i: 'card:review', x: 0, y: 0, w: 3, h: 12 }, { i: 'w:time', x: 3, y: 0, w: 3, h: 9 }])
  })

  it("uses the screen's own layout", () => {
    const saved = { '1920x1080': { cols: 6, rowHeight: 20, items: [{ i: 'card:review', x: 2, y: 4, w: 4, h: 5 }, { i: 'w:time', x: 0, y: 0, w: 2, h: 4 }] } }
    const { items, own } = layoutFor(saved, '1920x1080', 6, entries)
    expect(own).toBe(true)
    expect(items).toEqual(saved['1920x1080'].items)
  })

  it('starts a new screen from the nearest resolution, scaled to its columns', () => {
    const saved = {
      '3840x1600': { cols: 12, rowHeight: 20, items: [{ i: 'card:review', x: 6, y: 0, w: 6, h: 8 }, { i: 'w:time', x: 0, y: 0, w: 4, h: 6 }] },
      '1280x720': { cols: 4, rowHeight: 20, items: [{ i: 'card:review', x: 0, y: 0, w: 4, h: 8 }] },
    }
    expect(sourceFor(saved, '2560x1440').key).toBe('3840x1600')
    const { items, own } = layoutFor(saved, '2560x1440', 8, entries)
    expect(own).toBe(false)
    expect(items).toEqual([{ i: 'card:review', x: 4, y: 0, w: 4, h: 8 }, { i: 'w:time', x: 0, y: 0, w: 3, h: 6 }])
  })

  it('keeps a layout saved with 40px rows the same size on screen', () => {
    const saved = { '1920x1080': { cols: 6, items: [{ i: 'card:review', x: 0, y: 9, w: 3, h: 9 }, { i: 'w:time', x: 3, y: 0, w: 3, h: 6 }] } }
    const { items } = layoutFor(saved, '1920x1080', 6, entries)
    // 40px rows + 16px gaps = 56px a row; 20px rows + 16px = 36px: × 1.56.
    expect(items).toEqual([{ i: 'card:review', x: 0, y: 14, w: 3, h: 14 }, { i: 'w:time', x: 3, y: 0, w: 3, h: 9 }])
  })

  it("puts head parts the layout doesn't have above it, and moves everything else down", () => {
    const withHead = entriesFor({
      cards: [
        { id: 'page-greeting', bare: true, top: true, frac: 0.5, rows: 2 },
        { id: 'page-actions', bare: true, top: true, frac: 0.5, rows: 2 },
        { id: 'review', span: 1 },
      ],
      widgets: [{ id: 'time', half: true }],
    })
    const saved = { '1920x1080': { cols: 6, rowHeight: 20, items: [{ i: 'card:review', x: 0, y: 0, w: 3, h: 12 }, { i: 'w:time', x: 3, y: 0, w: 3, h: 9 }] } }
    expect(layoutFor(saved, '1920x1080', 6, withHead).items).toEqual([
      { i: 'card:page-greeting', x: 0, y: 0, w: 3, h: 2 },
      { i: 'card:page-actions', x: 3, y: 0, w: 3, h: 2 },
      { i: 'card:review', x: 0, y: 2, w: 3, h: 12 },
      { i: 'w:time', x: 3, y: 2, w: 3, h: 9 },
    ])
  })

  it('drops widgets that are gone, adds new ones below, and fits widths to the columns', () => {
    const saved = { '1920x1080': { cols: 6, rowHeight: 20, items: [{ i: 'card:gone', x: 0, y: 0, w: 6, h: 8 }, { i: 'card:review', x: 4, y: 0, w: 9, h: 0 }] } }
    const { items } = layoutFor(saved, '1920x1080', 6, entries)
    expect(items).toEqual([{ i: 'card:review', x: 0, y: 0, w: 6, h: 1 }, { i: 'w:time', x: 0, y: 1, w: 3, h: 9 }])
  })

  it('ignores a broken saved value', () => {
    expect(layoutFor({ '1920x1080': { cols: 6 } }, '1920x1080', 6, entries).own).toBe(false)
    expect(layoutFor(null, '1920x1080', 6, entries).items).toHaveLength(2)
  })
})

describe('saving', () => {
  it('sets and clears one screen, leaving the others', () => {
    const other = { cols: 12, rowHeight: 20, items: [] }
    const next = withLayout({ '3840x1600': other }, '1920x1080', 6, [{ i: 'w:a', x: 0, y: 0, w: 2, h: 3, moved: false, static: false }])
    expect(next).toEqual({ '3840x1600': other, '1920x1080': { cols: 6, rowHeight: 20, items: [{ i: 'w:a', x: 0, y: 0, w: 2, h: 3 }] } })
    expect(withoutLayout(next, '1920x1080')).toEqual({ '3840x1600': other })
  })
})
