import React from 'react'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  SettField, SetupScreen, LoadingScreen, ProfileMenu, WidgetOrderEditor, Mini,
} from './shell-parts.jsx'
import { ProjectAreasModal } from './project-areas-modal.jsx'
import { DEFAULT_PROJECT_AREAS } from '../project-areas.js'

afterEach(cleanup)

describe('shell parts', () => {
  it('SettField shows its label and hint', () => {
    render(<SettField label="Org" hint="after dev.azure.com/"><input /></SettField>)
    expect(screen.getByText('Org')).toBeTruthy()
    expect(screen.getByText('after dev.azure.com/')).toBeTruthy()
  })

  it('SetupScreen opens settings from its button', () => {
    const onOpenSettings = vi.fn()
    render(<SetupScreen onOpenSettings={onOpenSettings} />)
    fireEvent.click(screen.getByText(/Configure connection/))
    expect(onOpenSettings).toHaveBeenCalled()
  })

  it('LoadingScreen and Mini render their text', () => {
    render(<><LoadingScreen /><Mini label="Open" value={7} /></>)
    expect(screen.getByText(/Loading data/)).toBeTruthy()
    expect(screen.getByText('7')).toBeTruthy()
  })

  it('WidgetOrderEditor lists every widget in order', () => {
    render(<WidgetOrderEditor order={['sprint', 'triage']} onChange={() => {}} />)
    expect(screen.getByText('Sprint progress')).toBeTruthy()
    expect(screen.getByText('Triage queue')).toBeTruthy()
  })

  it('ProfileMenu toggles the theme from its popover', () => {
    const setTweak = vi.fn()
    render(<ProfileMenu name="Ada Lovelace" role="Lead" tweaks={{ theme: 'light' }} setTweak={setTweak}
      onOpenSettings={() => {}} onOpenProjectAreas={() => {}} />)
    fireEvent.click(screen.getByTitle('Profile & settings'))
    fireEvent.click(screen.getByText('Dark mode'))
    expect(setTweak).toHaveBeenCalledWith('theme', 'dark')
  })
})

describe('ProjectAreasModal', () => {
  it('renders the area tree when open and nothing when closed', () => {
    const { container, rerender } = render(
      <ProjectAreasModal open={false} onClose={() => {}} areas={DEFAULT_PROJECT_AREAS} setAreas={() => {}} />)
    expect(container.textContent).not.toContain('DriveFurther.API')
    rerender(<ProjectAreasModal open onClose={() => {}} areas={DEFAULT_PROJECT_AREAS} setAreas={() => {}} />)
    expect(container.textContent).toContain('DriveFurther.API')
  })
})
