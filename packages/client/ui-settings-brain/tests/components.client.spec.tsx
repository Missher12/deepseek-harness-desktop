// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { BrainSettingsSection, type BrainSettingsProps } from '../src/client/BrainSettingsSection.tsx'
import { en, type BrainSettingsLocaleKey } from '../src/client/locales.ts'

afterEach(cleanup)
const t = ((key: BrainSettingsLocaleKey, params?: Record<string, string | number>): string => {
  let value: string = en[key]
  for (const [name, replacement] of Object.entries(params ?? {})) value = value.replace(`{${name}}`, String(replacement))
  return value
}) as BrainSettingsProps['t']

function props(load: BrainSettingsProps['load']): BrainSettingsProps {
  return { t, load } as BrainSettingsProps
}

describe('BrainSettingsSection', () => {
  it('shows stable placeholders before replacing them with provider facts', async () => {
    const pending = Promise.withResolvers<Awaited<ReturnType<BrainSettingsProps['load']>>>()
    const view = render(<BrainSettingsSection {...props(() => pending.promise)} />)
    expect(screen.getByRole('heading', { name: en.title, level: 2 })).toBeTruthy()
    expect(view.container.querySelectorAll('[data-brain-source]')).toHaveLength(3)
    expect(screen.queryByText(en.loading)).toBeNull()

    pending.resolve({
      generatedAt: 1,
      limits: { maxItems: 6, maxBytes: 4_000, timeoutMs: 150 },
      providers: [
        { id: 'memory', state: 'ready', count: 12, byteBudget: 3_000 },
        { id: 'evolution', state: 'disabled', count: 3, byteBudget: 2_000 },
      ],
    })

    expect(await screen.findByText('12 memories')).toBeTruthy()
    expect(screen.getByText(en.disabled)).toBeTruthy()
    expect(screen.getByText('Up to 6 items · 4 KB · 150 ms fail-open')).toBeTruthy()
    expect(screen.getByText(en.localOnly)).toBeTruthy()
  })

  it('keeps the safe feature explanation visible when status loading fails', async () => {
    render(<BrainSettingsSection {...props(async () => { throw new Error('/private/secret') })} />)
    expect((await screen.findByRole('alert')).textContent).toBe(en.error)
    expect(screen.getByText(en.consolidationDescription)).toBeTruthy()
    expect(screen.queryByText('/private/secret')).toBeNull()
  })
})
