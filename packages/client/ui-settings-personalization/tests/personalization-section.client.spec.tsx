// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { PersonalizationSection, type PersonalizationSectionProps } from '../src/client/PersonalizationSection.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const base = {
  instructions: 'Prefer concrete evidence.',
  style: 'default' as const,
  revision: 'a'.repeat(64),
  hasExternalContent: false,
  writable: true,
}
const unusedHook = (() => { throw new Error('unused by personalization components') }) as never

function props(overrides: Partial<PersonalizationSectionProps> = {}): PersonalizationSectionProps {
  return {
    close: vi.fn(),
    useSessions: unusedHook,
    useSessionPendingInteraction: unusedHook,
    useWorkspaces: unusedHook,
    t: makeTranslate(en),
    load: vi.fn(async () => base),
    save: vi.fn(async (input: Parameters<PersonalizationSectionProps['save']>[0]) => ({
      ...base, ...input, revision: 'b'.repeat(64),
    })),
    ...overrides,
  }
}

describe('PersonalizationSection', () => {
  it('paints stable controls, loads the saved value, and enables Save only when dirty', async () => {
    const save = vi.fn(async (input: Parameters<PersonalizationSectionProps['save']>[0]) => ({
      ...base, ...input, revision: 'b'.repeat(64),
    }))
    render(<PersonalizationSection {...props({ save })} />)
    const editor = screen.getByRole('textbox', { name: 'Custom instructions' }) as HTMLTextAreaElement
    const button = screen.getByRole('button', { name: 'Save' })
    expect(editor.disabled).toBe(true)
    expect((button as HTMLButtonElement).disabled).toBe(true)

    await waitFor(() => { expect(editor.value).toBe('Prefer concrete evidence.') })
    expect(editor.disabled).toBe(false)
    expect((button as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(editor, { target: { value: 'Lead with the result.' } })
    fireEvent.change(screen.getByRole('combobox', { name: /Reply style/ }), { target: { value: 'professional' } })
    expect((button as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(button)

    await waitFor(() => {
      expect(save).toHaveBeenCalledWith({
        instructions: 'Lead with the result.',
        style: 'professional',
        expectedRevision: 'a'.repeat(64),
      })
    })
    expect(screen.getByText('Saved')).toBeTruthy()
    expect((button as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows preserved external instructions and keeps an externally managed file read-only', async () => {
    render(<PersonalizationSection {...props({
      load: vi.fn(async () => ({ ...base, writable: false, hasExternalContent: true })),
    })} />)

    await waitFor(() => { expect(screen.getByText(/Existing manual instructions are preserved/)).toBeTruthy() })
    expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Custom instructions' }).disabled).toBe(true)
    expect(screen.getByText(/managed outside Desktop/)).toBeTruthy()
  })

  it('keeps the draft and gives a retryable status when save fails', async () => {
    render(<PersonalizationSection {...props({
      save: vi.fn(async () => { throw new Error('global personalization changed; reload before saving') }),
    })} />)
    const editor = screen.getByRole('textbox', { name: 'Custom instructions' }) as HTMLTextAreaElement
    await waitFor(() => { expect(editor.value).toBe(base.instructions) })
    fireEvent.change(editor, { target: { value: 'Do not lose this draft.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => { expect(screen.getByRole('status').textContent).toContain('Could not save') })
    expect(editor.value).toBe('Do not lose this draft.')
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save' }).disabled).toBe(false)
  })

  it('shows a retryable status when loading fails', async () => {
    render(<PersonalizationSection {...props({
      load: vi.fn(async () => { throw new Error('read failed') }),
    })} />)

    await waitFor(() => { expect(screen.getByRole('status').textContent).toContain('temporarily unavailable') })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save' }).disabled).toBe(true)
  })

  it('ignores a late load settlement after the section is unmounted', async () => {
    let resolveLoad!: (value: typeof base) => void
    const load = vi.fn(() => new Promise<typeof base>((resolve) => { resolveLoad = resolve }))
    const view = render(<PersonalizationSection {...props({ load })} />)
    view.unmount()

    await act(async () => { resolveLoad(base); await Promise.resolve() })
    expect(load).toHaveBeenCalledOnce()
  })

  it('ignores a late load rejection after the section is unmounted', async () => {
    let rejectLoad!: (error: Error) => void
    const load = vi.fn(() => new Promise<typeof base>((_resolve, reject) => { rejectLoad = reject }))
    const view = render(<PersonalizationSection {...props({ load })} />)
    view.unmount()

    await act(async () => { rejectLoad(new Error('late failure')); await Promise.resolve() })
    expect(load).toHaveBeenCalledOnce()
  })

  it('keeps oversized UTF-8 drafts unsaveable and guards forced disabled clicks', async () => {
    const save = vi.fn(props().save)
    render(<PersonalizationSection {...props({ save })} />)
    const editor = screen.getByRole('textbox', { name: 'Custom instructions' }) as HTMLTextAreaElement
    const button = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement

    button.disabled = false
    fireEvent.click(button)
    expect(save).not.toHaveBeenCalled()
    button.disabled = true

    await waitFor(() => { expect(editor.disabled).toBe(false) })
    fireEvent.change(editor, { target: { value: '界'.repeat(20_000) } })
    expect(button.disabled).toBe(true)
    button.disabled = false
    fireEvent.click(button)
    expect(save).not.toHaveBeenCalled()
  })
})
