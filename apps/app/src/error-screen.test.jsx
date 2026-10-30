import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import fs from 'node:fs'
import path from 'node:path'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { ErrorBoundary, ErrorScreen, describeError } from './error-screen.jsx'
import { showFatalError } from './fatal-error.js'

afterEach(cleanup)

function Boom({ message = 'kaboom' }) { throw new Error(message) }

describe('describeError', () => {
  it('has the message, a trimmed stack and the device', () => {
    const e = new Error('bad thing')
    e.stack = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n')
    const text = describeError(e, { componentStack: '\n at A\n at B' })
    expect(text).toContain('Error: bad thing')
    expect(text).toContain('line 11')
    expect(text).not.toContain('line 12')
    expect(text).toContain('at A')
  })

  it('copes with a thrown string or nothing at all', () => {
    expect(describeError('plain')).toContain('plain')
    expect(describeError(undefined)).toContain('Unknown error')
  })
})

describe('ErrorBoundary', () => {
  beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}) })

  it('shows the error instead of a blank page', () => {
    render(<ErrorBoundary><Boom message="StatusBar is not defined" /></ErrorBoundary>)
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getByText('Something went wrong')).toBeTruthy()
    expect(screen.getByTestId('error-details').textContent).toContain('StatusBar is not defined')
  })

  it('renders its children when nothing is wrong', () => {
    render(<ErrorBoundary><p>all good</p></ErrorBoundary>)
    expect(screen.getByText('all good')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('reloads on request', () => {
    const onReload = vi.fn()
    render(<ErrorBoundary onReload={onReload}><Boom /></ErrorBoundary>)
    fireEvent.click(screen.getByText('Reload'))
    expect(onReload).toHaveBeenCalledOnce()
  })

  it('copies the details', async () => {
    const writeText = vi.fn().mockResolvedValue()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(<ErrorScreen error={new Error('copy me')} />)
    fireEvent.click(screen.getByText('Copy details'))
    await screen.findByText('Copied')
    expect(writeText.mock.calls[0][0]).toContain('copy me')
  })

  it('is wrapped around the whole app', () => {
    const app = fs.readFileSync(path.resolve(import.meta.dirname, 'app.jsx'), 'utf8')
    expect(app).toMatch(/<ErrorBoundary>\s*<NexusDataProvider/)
  })
})

describe('showFatalError', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    document.body.replaceChildren(Object.assign(document.createElement('div'), { id: 'root' }))
  })

  it('puts the error on screen without React', () => {
    showFatalError(new Error('chunk failed to load'))
    expect(document.getElementById('root').textContent).toContain('The app could not start')
    expect(document.querySelector('[data-testid="fatal-details"]').textContent).toContain('chunk failed to load')
  })

  it('shows the error as text, not markup', () => {
    showFatalError(new Error('<img src=x onerror=alert(1)>'))
    expect(document.querySelector('img')).toBeNull()
  })

  it('is what a failed app import ends in', () => {
    const main = fs.readFileSync(path.resolve(import.meta.dirname, 'main.jsx'), 'utf8')
    expect(main).toMatch(/import\('\.\/app\.jsx'\)\.catch\(showFatalError\)/)
  })
})
