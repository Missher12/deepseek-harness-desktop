// @vitest-environment jsdom
// Memory & Learning over the BUILT client graph: open the real Settings shell,
// select the shipped section, and pin only its bounded user-visible projection.
// FixtureApiClient deliberately has no brain Remote endpoint, so this lane also
// proves the section fails closed without exposing provider or filesystem facts.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { expect, it } from 'vitest'
import { installAssembledBootEnv, mountAssembledApp } from './assembled-boot.ts'

installAssembledBootEnv()

it('renders the built Memory & Learning settings without internal identities', async () => {
  mountAssembledApp()

  const settings = await screen.findByRole('button', { name: 'Settings' }, { timeout: 10_000 })
  fireEvent.click(settings)
  const dialog = await screen.findByRole('dialog', { name: 'Settings' })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Memory & Learning' }))

  const section = await waitFor(() => {
    const element = dialog.querySelector<HTMLElement>('[data-brain-settings]')
    if (element === null) throw new Error('Memory & Learning settings section missing')
    return element
  }, { timeout: 10_000 })
  await within(section).findByRole('alert')

  const sources = [...section.querySelectorAll<HTMLElement>('[data-brain-source]')]
    .map(row => ({
      title: row.querySelector('strong')?.textContent,
      description: row.querySelector('small')?.textContent,
      status: row.lastElementChild?.textContent,
    }))
  expect({
    title: within(section).getByRole('heading', { level: 2 }).textContent,
    sources,
    explanation: [...section.querySelectorAll<HTMLElement>('div > strong')]
      .map(title => title.textContent),
    alert: within(section).getByRole('alert').textContent,
  }).toMatchInlineSnapshot(`
    {
      "alert": "Memory & Learning status is temporarily unavailable; messages continue with safe fail-open behavior.",
      "explanation": [
        "How it works",
        "Safe learning",
      ],
      "sources": [
        {
          "description": "Recall reviewed facts, decisions, and durable progress within the matching project only.",
          "status": "—",
          "title": "Project memory",
        },
        {
          "description": "Learn working methods only from successful outcomes; validated workflows can help with later tasks.",
          "status": "—",
          "title": "Learned workflows",
        },
      ],
      "title": "Memory & Learning",
    }
  `)

  const visibleText = section.textContent ?? ''
  expect(visibleText).not.toContain('External Brain')
  expect(visibleText).not.toMatch(/missher-brain|memory-sqlite|\bevolution\b/i)
  expect(visibleText).not.toMatch(/\/Users\/|\/home\/|\/private\/|[A-Z]:\\/)
})
