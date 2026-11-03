import { test, expect } from '@playwright/test'
import { launchApp } from './launch.js'

// The Dashboard's widgets move and resize, with a layout per screen. A test machine has one monitor, so
// the main process is given a stand-in screen (NEXUSMD_E2E_DISPLAY) and switched to another
// (__nexusmdSetDisplay), as moving the window to another monitor would.
const SHOTS = process.env.NEXUSMD_E2E_SHOTS

async function start() {
  process.env.NEXUSMD_E2E_DISPLAY = '3840x1600@1'
  try {
    return await launchApp({ seed: { 'nexusmd.tweaks': { homeWidgets: [{ id: 'n1', type: 'notes', config: {} }, { id: 't1', type: 'time', config: {} }] } } })
  } finally {
    delete process.env.NEXUSMD_E2E_DISPLAY
  }
}

const tweaks = win => win.evaluate(() => JSON.parse(localStorage.getItem('nexusmd.tweaks') || '{}'))
const box = (win, key) => win.locator(`[data-key="${key}"]`).boundingBox()

// react-grid-layout eases widgets into place over 200ms.
const settled = win => win.waitForTimeout(400)

async function noOverlap(win) {
  const cells = await win.locator('[data-testid="dash-cell"]').evaluateAll(els => els.map(e => e.getBoundingClientRect()).map(r => ({ l: r.left, t: r.top, r: r.right, b: r.bottom })))
  for (let i = 0; i < cells.length; i++) for (let j = i + 1; j < cells.length; j++) {
    const a = cells[i], b = cells[j]
    expect(a.r <= b.l + 1 || b.r <= a.l + 1 || a.b <= b.t + 1 || b.b <= a.t + 1).toBe(true)
  }
}

async function shot(win, name) {
  if (!SHOTS) return
  await settled(win)
  await win.locator('.dash-grid').evaluate(e => e.scrollIntoView())
  await win.screenshot({ path: `${SHOTS}/${name}.png` })
}

async function drag(win, from, dx, dy) {
  await from.hover()
  const b = await from.boundingBox()
  const x = b.x + b.width / 2, y = b.y + b.height / 2
  await win.mouse.move(x, y)
  await win.mouse.down()
  for (let i = 1; i <= 10; i++) await win.mouse.move(x + (dx * i) / 10, y + (dy * i) / 10)
  await win.mouse.up()
}

test('widgets move and resize, and each screen keeps its own layout', async () => {
  const { app, win, close } = await start()
  try {
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(2400, 1400) })
    const grid = win.locator('.dash-grid')
    await expect(grid).toHaveAttribute('data-screen', '3840x1600', { timeout: 20_000 })
    await expect(grid).toHaveAttribute('data-cols', '12')
    await expect(win.locator('[data-key="w:n1"]')).toBeVisible()
    await expect(win.getByText(/Layout for this 3840×1600 screen \(not arranged yet\)/)).toBeVisible()

    // The page's head is in the grid too: the greeting, its buttons and the stat cards each have a grip.
    for (const key of ['card:page-greeting', 'card:page-actions', 'card:stat-prs', 'card:stat-blockers']) {
      await expect(win.locator(`[data-key="${key}"] > .widget-grab`)).toHaveCount(1)
    }
    const layout = async () => (await tweaks(win)).dashLayouts?.['3840x1600']?.items || []
    const item = async key => (await layout()).find(it => it.i === key)

    // Narrow the greeting from its right edge, to make room on the top row.
    const gb = await box(win, 'card:page-greeting')
    await drag(win, win.locator('[data-key="card:page-greeting"] > .react-resizable-handle-e'), -gb.width * 0.5, 0)
    await expect.poll(async () => (await item('card:page-greeting'))?.w ?? 99).toBeLessThanOrEqual(3)

    // Shrink the Quick note from its corner (it starts full width), then drop it on the top row, next to the greeting.
    const nb = await box(win, 'w:n1')
    await drag(win, win.locator('[data-key="w:n1"] > .react-resizable-handle-se'), -nb.width * 0.75, 120)
    await expect.poll(async () => (await item('w:n1')).w).toBeLessThanOrEqual(3)
    const sized = await item('w:n1')
    expect(sized.h).toBeGreaterThan(9)
    await settled(win)
    const greet = await box(win, 'card:page-greeting')
    // Its left edge goes just past the greeting's right edge (the grip is in the middle of its top).
    const note = await box(win, 'w:n1')
    await drag(win, win.locator('[data-key="w:n1"] > .widget-grab'), greet.x + greet.width + 24 - note.x, greet.y - note.y)
    await expect.poll(async () => (await item('w:n1')).y).toBe(0)
    const resized = await item('w:n1')
    expect(resized.x).toBeGreaterThanOrEqual((await item('card:page-greeting')).w)
    await settled(win)
    await noOverlap(win)
    await shot(win, 'dash-4k')

    // Another monitor: 1080p. Fewer columns, starts from the 4K layout scaled, and saves nothing yet.
    await app.evaluate(() => globalThis.__nexusmdSetDisplay('1920x1080@1'))
    await expect(grid).toHaveAttribute('data-screen', '1920x1080')
    await expect(grid).toHaveAttribute('data-cols', '6')
    await expect(win.getByText(/Layout for this 1920×1080 screen \(not arranged yet\)/)).toBeVisible()
    expect(Object.keys((await tweaks(win)).dashLayouts)).toEqual(['3840x1600'])
    const nAt1080 = await box(win, 'w:n1')
    const rAt1080 = await box(win, 'card:review')
    expect(nAt1080.y).toBeLessThan(rAt1080.y + 1)
    await settled(win)
    await noOverlap(win)

    // Arrange 1080p on its own: the Time widget to the top.
    const tb = await box(win, 'w:t1')
    await drag(win, win.locator('[data-key="w:t1"] > .widget-grab'), nAt1080.x - tb.x + 10, nAt1080.y - tb.y + 10)
    await expect.poll(async () => Object.keys((await tweaks(win)).dashLayouts).sort()).toEqual(['1920x1080', '3840x1600'])
    await settled(win)
    await noOverlap(win)
    await shot(win, 'dash-1080')

    // Back on the 4K screen, its layout is as it was left.
    await app.evaluate(() => globalThis.__nexusmdSetDisplay('3840x1600@1'))
    await expect(grid).toHaveAttribute('data-screen', '3840x1600')
    expect((await tweaks(win)).dashLayouts['3840x1600'].items.find(it => it.i === 'w:n1')).toEqual(resized)
    await expect.poll(async () => (await box(win, 'w:n1')).y).toBeLessThan((await box(win, 'card:stat-prs')).y)

    // Both survive a reload; Reset layout clears only the screen it's on.
    await win.reload()
    await expect(grid).toHaveAttribute('data-screen', '3840x1600', { timeout: 20_000 })
    expect(Object.keys((await tweaks(win)).dashLayouts).sort()).toEqual(['1920x1080', '3840x1600'])
    await win.getByRole('button', { name: 'Reset layout' }).click()
    await expect.poll(async () => Object.keys((await tweaks(win)).dashLayouts)).toEqual(['1920x1080'])
  } finally {
    await close()
  }
})

test('reads the real screen the window is on', async () => {
  const { app, win, close } = await launchApp()
  try {
    const real = await app.evaluate(({ screen, BrowserWindow }) => {
      const d = screen.getDisplayMatching(BrowserWindow.getAllWindows()[0].getBounds())
      return `${Math.round(d.size.width * d.scaleFactor)}x${Math.round(d.size.height * d.scaleFactor)}`
    })
    await expect(win.locator('.dash-grid')).toHaveAttribute('data-screen', real, { timeout: 20_000 })
  } finally {
    await close()
  }
})

test('a default part of the Dashboard can be hidden, stays hidden, and comes back from Show hidden', async () => {
  const { app, win, close } = await start()
  try {
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(2400, 1400) })
    const greeting = win.locator('[data-key="card:page-greeting"]')
    await expect(greeting).toBeVisible({ timeout: 20_000 })

    await greeting.hover()
    await win.getByRole('button', { name: 'Hide Greeting' }).click()
    await expect(greeting).toHaveCount(0)
    await win.locator('[data-key="card:stat-blockers"]').hover()
    await win.getByRole('button', { name: 'Hide Open blockers' }).click()
    await expect(win.locator('[data-key="card:stat-blockers"]')).toHaveCount(0)
    expect((await tweaks(win)).dashHiddenParts).toEqual(['page-greeting', 'stat-blockers'])
    await shot(win, 'hidden-parts')

    // Still hidden after a reload.
    await win.reload()
    await expect(win.locator('.dash-grid')).toBeVisible({ timeout: 20_000 })
    await expect(win.locator('[data-key="card:page-greeting"]')).toHaveCount(0)

    await win.getByRole('button', { name: /Show hidden/ }).click()
    await win.getByRole('menuitem', { name: 'Show Greeting' }).click()
    await expect(win.locator('[data-key="card:page-greeting"]')).toBeVisible()
    expect((await tweaks(win)).dashHiddenParts).toEqual(['stat-blockers'])
    await settled(win)
    await noOverlap(win)
  } finally {
    await close()
  }
})
