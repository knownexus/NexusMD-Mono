// Links in the Documents preview: web links open outside the app, #anchors scroll to their
// heading, and nothing navigates the app window itself.
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within, cleanup, waitFor } from '@testing-library/react'
import { MarkdownViewer, slugifyHeading, addHeadingAnchors, followPreviewLink } from './MarkdownViewer.jsx'

function preview(html) {
  const el = document.createElement('div')
  el.innerHTML = html
  document.body.appendChild(el)
  addHeadingAnchors(el)
  return el
}

// Clicks the first link matching `selector` and reports what followPreviewLink did.
function click(container, selector = 'a') {
  const open = vi.fn()
  const openExternal = vi.fn()
  const e = { target: container.querySelector(selector), preventDefault: vi.fn() }
  followPreviewLink(e, container, { open, openExternal })
  return { open, openExternal, prevented: e.preventDefault.mock.calls.length > 0 }
}

beforeEach(() => { document.body.innerHTML = '' })

describe('slugifyHeading', () => {
  it('makes GitHub-style anchors', () => {
    expect(slugifyHeading('Getting Started')).toBe('getting-started')
    expect(slugifyHeading('  What’s new in v1.2?  ')).toBe('whats-new-in-v12')
    expect(slugifyHeading('A - B')).toBe('a---b')
    expect(slugifyHeading('snake_case & more')).toBe('snake_case--more')
  })
})

describe('addHeadingAnchors', () => {
  it('numbers repeated headings like GitHub does', () => {
    const el = preview('<h2>Setup</h2><h3>Setup</h3><h2>Setup</h2>')
    expect([...el.querySelectorAll('h2, h3')].map(h => h.getAttribute('data-anchor'))).toEqual(['setup', 'setup-1', 'setup-2'])
  })
})

describe('followPreviewLink', () => {
  it('opens a web link outside the app', () => {
    const r = click(preview('<p><a href="https://example.com/docs">docs</a></p>'))
    expect(r.prevented).toBe(true)
    expect(r.open).toHaveBeenCalledWith('https://example.com/docs')
  })

  it('opens a link clicked on its inner text', () => {
    const r = click(preview('<p><a href="http://example.com"><strong>bold</strong></a></p>'), 'strong')
    expect(r.open).toHaveBeenCalledWith('http://example.com/')
  })

  it('opens mailto links in the mail app', () => {
    const r = click(preview('<a href="mailto:a@b.com">mail</a>'))
    expect(r.openExternal).toHaveBeenCalledWith('mailto:a@b.com')
    expect(r.open).not.toHaveBeenCalled()
  })

  it('scrolls to the heading an #anchor names', () => {
    const el = preview('<h2>Intro</h2><h2>Getting Started</h2><p><a href="#getting-started">go</a></p>')
    const heading = el.querySelectorAll('h2')[1]
    heading.scrollIntoView = vi.fn()
    const r = click(el)
    expect(r.prevented).toBe(true)
    expect(heading.scrollIntoView).toHaveBeenCalled()
    expect(r.open).not.toHaveBeenCalled()
  })

  it('matches an encoded or differently cased anchor', () => {
    const el = preview('<h2>Café Notes</h2><a href="#Caf%C3%A9-Notes">go</a>')
    const heading = el.querySelector('h2')
    heading.scrollIntoView = vi.fn()
    click(el)
    expect(heading.scrollIntoView).toHaveBeenCalled()
  })

  it('never lets a relative or file link navigate the app', () => {
    for (const href of ['other.md', '../x', 'file:///C:/secret.txt', 'javascript:alert(1)']) {
      const r = click(preview(`<a href="${href}">x</a>`))
      expect(r.prevented).toBe(true)
      expect(r.open).not.toHaveBeenCalled()
      expect(r.openExternal).not.toHaveBeenCalled()
    }
  })

  it('leaves clicks that are not on a link alone', () => {
    const r = click(preview('<p>plain <em>text</em></p>'), 'em')
    expect(r.prevented).toBe(false)
  })
})

describe('MarkdownViewer compare view', () => {
  const HLJS = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js'
  const docs = [
    { id: 'a', name: null, autoName: 'Release notes', content: '# Release notes\n\nShipped it.', createdAt: 1, updatedAt: 3 },
    { id: 'b', name: null, autoName: 'Setup guide', content: '# Setup guide\n\nInstall it.', createdAt: 1, updatedAt: 2 },
    { id: 'c', name: 'Old plan', autoName: 'Plan', content: '# Plan\n\nThink first.', createdAt: 1, updatedAt: 1 },
  ]

  beforeEach(() => {
    // Mark highlight.js as loaded, so the previews render.
    const s = document.createElement('script')
    s.src = HLJS
    document.head.appendChild(s)
    window.hljs = { highlightElement: () => {} }
    localStorage.setItem('md_documents', JSON.stringify({ docs }))
  })
  afterEach(() => {
    cleanup()
    localStorage.clear()
    document.head.querySelectorAll(`script[src="${HLJS}"]`).forEach(s => s.remove())
    delete window.hljs
  })

  const comparePane = () => screen.getByTestId('compare-preview')
  function openDoc(name) {
    fireEvent.click(screen.getByText(/^Documents \(/))
    // The card's title, not the compare picker's option or the card's thumbnail heading.
    fireEvent.click(screen.getAllByText(name).find(el => el.tagName === 'DIV'))
  }

  it('shows the most recently edited other document beside the open one', async () => {
    render(<MarkdownViewer />)
    openDoc('Setup guide')
    fireEvent.click(screen.getByRole('button', { name: 'compare' }))
    await waitFor(() => expect(within(comparePane()).getByRole('heading', { name: 'Release notes' })).toBeTruthy())
    expect(screen.getByLabelText('Document to compare').value).toBe('a')
    // The open document isn't offered as the other one.
    expect([...screen.getByLabelText('Document to compare').options].map(o => o.textContent)).toEqual(['Release notes', 'Old plan'])
  })

  it('switches the other document from the picker', async () => {
    render(<MarkdownViewer />)
    openDoc('Setup guide')
    fireEvent.click(screen.getByRole('button', { name: 'compare' }))
    fireEvent.change(screen.getByLabelText('Document to compare'), { target: { value: 'c' } })
    await waitFor(() => expect(within(comparePane()).getByRole('heading', { name: 'Plan' })).toBeTruthy())
  })

  it('swaps which document is open', async () => {
    render(<MarkdownViewer />)
    openDoc('Setup guide')
    fireEvent.click(screen.getByRole('button', { name: 'compare' }))
    fireEvent.click(screen.getByRole('button', { name: /Swap/ }))
    await waitFor(() => expect(within(comparePane()).getByRole('heading', { name: 'Setup guide' })).toBeTruthy())
    expect(screen.getByLabelText('Document to compare').value).toBe('b')
    fireEvent.click(screen.getByRole('button', { name: 'split' }))
    expect(screen.getByPlaceholderText(/Start writing/).value).toBe('# Release notes\n\nShipped it.')
  })

  it('can’t swap away an unsaved document', () => {
    render(<MarkdownViewer />)
    fireEvent.click(screen.getByRole('button', { name: 'compare' }))
    expect(screen.getByRole('button', { name: /Swap/ }).disabled).toBe(true)
  })

  it('says when there is nothing to compare with', () => {
    localStorage.setItem('md_documents', JSON.stringify({ docs: [docs[0]] }))
    render(<MarkdownViewer />)
    openDoc('Release notes')
    fireEvent.click(screen.getByRole('button', { name: 'compare' }))
    expect(screen.getByText('No other documents to compare with yet.')).toBeTruthy()
  })
})
