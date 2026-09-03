// @vitest-environment jsdom
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en } from '../src/client/locales.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: ({ children, disabled, onClick }: ButtonHTMLAttributes<HTMLButtonElement> & { children?: ReactNode }) => (
    <span role="button" aria-disabled={disabled} onClick={onClick}>{children}</span>
  ),
}))

import {
  PersonalizationSection, type PersonalizationSectionProps,
} from '../src/client/PersonalizationSection.tsx'

afterEach(cleanup)

const unusedHook = (() => { throw new Error('unused') }) as never
const base = {
  instructions: '', style: 'default' as const, revision: 'r',
  hasExternalContent: false, writable: true,
}

function props(load: PersonalizationSectionProps['load'], save: PersonalizationSectionProps['save']): PersonalizationSectionProps {
  return {
    close: vi.fn(), useSessions: unusedHook, useSessionPendingInteraction: unusedHook,
    useWorkspaces: unusedHook,
    t: makeTranslate(en), load, save,
  }
}

describe('PersonalizationSection submit guards', () => {
  it('ignores clicks before loading and while a loaded draft is unchanged', async () => {
    let resolveLoad!: (value: typeof base) => void
    const load = vi.fn(() => new Promise<typeof base>((resolve) => { resolveLoad = resolve }))
    const save = vi.fn(async () => base)
    render(<PersonalizationSection {...props(load, save)} />)
    const button = screen.getByRole('button', { name: 'Save' })

    fireEvent.click(button)
    expect(save).not.toHaveBeenCalled()
    resolveLoad(base)
    await waitFor(() => { expect(button.getAttribute('aria-disabled')).toBe('true') })
    fireEvent.click(button)
    expect(save).not.toHaveBeenCalled()
  })
})
