import { test, expect } from '@playwright/test'
import { launchApp } from './launch.js'

const toggle = (win, title) => win.locator('.set-card-toggle', { hasText: title })

test('Settings sections collapse from their title bar and stay collapsed after a reload', async () => {
  const { win, close } = await launchApp()
  try {
    await win.getByText('Settings').first().click()
    await win.getByText('Profiles', { exact: true }).click()
    const backup = toggle(win, 'Backup & Restore')
    await expect(backup).toHaveAttribute('aria-expanded', 'true')
    await expect(win.getByText('Back up all profiles')).toBeVisible()

    await backup.click()
    await expect(backup).toHaveAttribute('aria-expanded', 'false')
    await expect(win.getByText('Back up all profiles')).toBeHidden()
    // The Profiles section next to it is untouched, and its header button still works.
    await expect(toggle(win, 'Profiles')).toHaveAttribute('aria-expanded', 'true')

    await win.reload()
    await win.getByText('Settings').first().click()
    await win.getByText('Profiles', { exact: true }).click()
    await expect(toggle(win, 'Backup & Restore')).toHaveAttribute('aria-expanded', 'false')
    await expect(win.getByText('Back up all profiles')).toBeHidden()

    await toggle(win, 'Backup & Restore').click()
    await expect(win.getByText('Back up all profiles')).toBeVisible()
  } finally { await close() }
})

test('the Integrations connection cards collapse like the rest, each on its own, and stay collapsed after a reload', async () => {
  const { win, close } = await launchApp()
  try {
    const open = async () => {
      await win.getByText('Settings').first().click()
      await win.getByText('Integrations', { exact: true }).click()
    }
    await open()
    const cards = ['Azure DevOps Connection', 'Jira Cloud Connection', 'GitHub Connection', 'Work Items Display']
    for (const title of cards) await expect(toggle(win, title)).toHaveAttribute('aria-expanded', 'true', { timeout: 30_000 })

    // Folding one hides its fields and leaves the others alone.
    const ado = toggle(win, 'Azure DevOps Connection')
    const adoBody = win.locator(`[id="${await ado.getAttribute('aria-controls')}"]`)
    await expect(adoBody).toBeVisible()
    await ado.click()
    await expect(ado).toHaveAttribute('aria-expanded', 'false')
    await expect(adoBody).toBeHidden()
    for (const title of cards.slice(1)) await expect(toggle(win, title)).toHaveAttribute('aria-expanded', 'true')

    // Still folded after a reload, and the others are still open.
    await win.reload()
    await open()
    await expect(toggle(win, 'Azure DevOps Connection')).toHaveAttribute('aria-expanded', 'false', { timeout: 30_000 })
    for (const title of cards.slice(1)) await expect(toggle(win, title)).toHaveAttribute('aria-expanded', 'true')

    await toggle(win, 'Azure DevOps Connection').click()
    await expect(toggle(win, 'Azure DevOps Connection')).toHaveAttribute('aria-expanded', 'true')
  } finally { await close() }
})

test('Data & sync says where profiles go and is ready for Save and Load, with no Sync now for the account', async () => {
  const { win, close } = await launchApp()
  try {
    await win.getByText('Settings').first().click()
    await win.getByText('Data & sync', { exact: true }).click()
    // Not signed in here (the test profile opts out of an account), so the card says so rather than offering buttons.
    await expect(win.getByText('Profile sync')).toBeVisible({ timeout: 30_000 })
    await expect(win.getByText(/Sign in to an account to sync your profiles/)).toBeVisible()
    await expect(win.getByRole('button', { name: /to the server|from the server/ })).toHaveCount(0)
    // The old both-ways button is gone from the account's cards; the Google Drive / OneDrive one is a different card.
    const profileSync = win.locator('.set-card', { has: win.locator('.set-card-toggle', { hasText: 'Profile sync' }) })
    await expect(profileSync.getByRole('button', { name: /sync now/i })).toHaveCount(0)
  } finally { await close() }
})
