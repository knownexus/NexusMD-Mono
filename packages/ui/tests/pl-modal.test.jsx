import { it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import React from 'react'
import { PlModal } from '../src/planner-chips.jsx'

afterEach(cleanup)

it('closes on a backdrop click by default', () => {
  const onClose = vi.fn()
  render(<PlModal open onClose={onClose} title="T">body</PlModal>)
  fireEvent.mouseDown(document.querySelector('.plm-veil'))
  expect(onClose).toHaveBeenCalledTimes(1)
})

it('closeOnBackdrop={false} ignores backdrop clicks but still closes on Esc', () => {
  const onClose = vi.fn()
  render(<PlModal open onClose={onClose} title="T" closeOnBackdrop={false}>body</PlModal>)
  fireEvent.mouseDown(document.querySelector('.plm-veil'))
  expect(onClose).not.toHaveBeenCalled()
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(onClose).toHaveBeenCalledTimes(1)
})
