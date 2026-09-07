// @vitest-environment jsdom
// The built application must not keep settings navigation for retired plugins.
import { fireEvent, screen, within } from '@testing-library/react'
import { expect, it } from 'vitest'
import { installAssembledBootEnv, mountAssembledApp } from './assembled-boot.ts'

installAssembledBootEnv()

it('omits retired Brain and learning settings from the built application', async () => {
  mountAssembledApp('?fixture', { exclude: ['@deepseek-ai/dsh-client-ui-settings-personalization'] })

  fireEvent.click(await screen.findByRole('button', { name: 'Settings' }, { timeout: 10_000 }))
  const dialog = await screen.findByRole('dialog', { name: 'Settings' })
  expect(within(dialog).getByRole('button', { name: 'General' })).toBeTruthy()
  expect(within(dialog).queryByRole('button', { name: 'Memory & Learning' })).toBeNull()
  expect(dialog.querySelector('[data-brain-settings]')).toBeNull()
  expect(dialog.textContent).not.toMatch(/External Brain|Media@Missher|BrowserSkill|Open Design/)
})
