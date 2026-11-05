// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRequire } from 'node:module'
import { installClickCapture, accessibleName } from './clicks.js'

const nxt = createRequire(import.meta.url)('../../../trace/src/runtime.js')
let uninstall
beforeEach(() => { document.body.innerHTML = ''; nxt.start({ proc: 'renderer', win: 1 }); nxt.drain() })
afterEach(() => { uninstall?.(); uninstall = undefined; nxt.stop(); nxt.drain() })

const page = () => 'Pull Requests'
const put = (html) => { document.body.innerHTML = html; return document.body.firstElementChild }
const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
const clicks = () => nxt.drain().filter(e => e.k === 'click')

describe('installClickCapture', () => {
  it('a click on a labelled button emits a click event named from its accessible name, with the page', () => {
    uninstall = installClickCapture(document, page)
    click(put('<button aria-label="Merge PR 4411">M</button>'))
    const [ev] = clicks()
    expect(ev.d).toMatchObject({ name: 'Merge PR 4411', page: 'Pull Requests', tag: 'button' })
    expect(ev.p).toBeNull()
  })

  it('names a click on something inside a button after the button', () => {
    uninstall = installClickCapture(document, page)
    click(put('<button>Complete <span id="inner">merge</span></button>').querySelector('#inner'))
    expect(clicks()[0].d).toMatchObject({ name: 'Complete merge', tag: 'button' })
  })

  it('a function called by the click handler is a child of the click node', () => {
    uninstall = installClickCapture(document, page)
    const button = put('<button>Merge</button>')
    button.addEventListener('click', () => { const f = nxt.enter('h.js:1:0:onMerge', null, []); nxt.ret(f, 0) })
    click(button)
    const evs = nxt.drain()
    const c = evs.find(e => e.k === 'click')
    expect(evs.find(e => e.k === 'enter').p).toBe(c.id)
  })

  it('two quick clicks make two separate roots, and work after a click is not under it', () => {
    uninstall = installClickCapture(document, page)
    const button = put('<button>Go</button>')
    button.addEventListener('click', () => { const f = nxt.enter('h.js:1:0:handler', null, []); nxt.ret(f, 0) })
    click(button); click(button)
    const evs = nxt.drain()
    const [c1, c2] = evs.filter(e => e.k === 'click')
    const [h1, h2] = evs.filter(e => e.k === 'enter')
    expect([h1.p, h2.p]).toEqual([c1.id, c2.id])
    expect(c2.p).toBeNull()
    const later = nxt.enter('x.js:1:0:later', null, [])
    expect(nxt.drain().find(e => e.k === 'enter').p).toBeNull()
    nxt.ret(later, 0)
  })

  it('a handler that throws does not leave the click holding the running frame', () => {
    uninstall = installClickCapture(document, page)
    const button = put('<button>Boom</button>')
    const onError = vi.fn(e => e.preventDefault())
    window.addEventListener('error', onError)
    button.addEventListener('click', () => { throw new Error('handler broke') })
    click(button)
    window.removeEventListener('error', onError)
    expect(nxt.current()).toBeNull()
  })

  it('a click on something that is not a control emits nothing', () => {
    uninstall = installClickCapture(document, page)
    click(put('<div><p>just text</p></div>').querySelector('p'))
    expect(clicks()).toEqual([])
  })

  it('submitting a form is a node too, named from the form or its button', () => {
    uninstall = installClickCapture(document, page)
    const form = put('<form aria-label="Comment"><button type="submit">Post</button></form>')
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    expect(clicks()[0].d).toMatchObject({ name: 'Comment', tag: 'form' })
  })

  it('not recording: nothing is emitted and the handlers still run', () => {
    nxt.stop(); nxt.drain()
    uninstall = installClickCapture(document, page)
    const ran = vi.fn()
    const button = put('<button>Go</button>'); button.addEventListener('click', ran)
    click(button)
    expect(ran).toHaveBeenCalledTimes(1)
    expect(nxt.drain()).toEqual([])
  })

  it('uninstall stops it', () => {
    uninstall = installClickCapture(document, page)
    uninstall(); uninstall = undefined
    click(put('<button>Go</button>'))
    expect(clicks()).toEqual([])
  })

  it('a page name that cannot be worked out does not stop the click being recorded', () => {
    uninstall = installClickCapture(document, () => { throw new Error('no page') })
    click(put('<button>Go</button>'))
    expect(clicks()[0].d).toMatchObject({ name: 'Go', page: '' })
  })
})

describe('accessibleName', () => {
  const name = (html) => accessibleName(put(html))
  it('prefers aria-label, then aria-labelledby, then the text, then the title, then alt/value/placeholder', () => {
    expect(name('<button aria-label="Close dialog">x</button>')).toBe('Close dialog')
    document.body.innerHTML = '<span id="l">Delete branch</span><button aria-labelledby="l">!</button>'
    expect(accessibleName(document.querySelector('button'))).toBe('Delete branch')
    expect(name('<button>  Merge \n  now </button>')).toBe('Merge now')
    expect(name('<button title="Refresh"><svg></svg></button>')).toBe('Refresh')
    expect(name('<input type="submit" value="Save changes">')).toBe('Save changes')
    expect(name('<input placeholder="Search PRs">')).toBe('Search PRs')
    expect(name('<a href="#"><img alt="Home"></a>')).toBe('Home')
  })
  it('leaves out what is marked aria-hidden (a shortcut badge, an icon), as a screen reader does', () => {
    expect(name('<button><svg aria-hidden="true"><title>icon</title></svg>Pull Requests<span aria-hidden="true">4</span></button>')).toBe('Pull Requests')
  })
  it('is cut at 80 characters and falls back to the tag when there is nothing to say', () => {
    expect(name(`<button>${'x'.repeat(200)}</button>`).length).toBeLessThanOrEqual(81)
    expect(name('<button><svg></svg></button>')).toBe('button')
  })
})

