// @vitest-environment jsdom
/** Local model defaults fill drafts without overwriting edits or late navigation. */
import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModelListEditor } from '../src/client/ModelListEditor.tsx'
import type { ModelDraft, ModelListEditorProps } from '../src/client/ModelListEditor.tsx'
import type { ModelsOperations } from '../src/client/operations.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const preset = {
  id: 'known', name: 'Known model', contextWindow: 128_000, maxTokens: 8192,
  configuration: { reasoningEfforts: { high: 'high', max: 'max' } },
}

function testOperations(discoverModels: ModelsOperations['discoverModels']): ModelsOperations {
  const unexpected = async (): Promise<never> => { throw new Error('Unexpected host operation') }
  return {
    discoverModels,
    describeCredential: unexpected,
    storeCredential: unexpected,
    removeCredential: unexpected,
    writeSettings: unexpected,
  }
}

function mount(discoverModels: ModelsOperations['discoverModels'], initial: ModelDraft = { id: 'known' }) {
  const changed = vi.fn<(models: ModelDraft[]) => void>()
  function Editor() {
    const [models, setModels] = useState([initial])
    return <ModelListEditor models={models} onChange={(next) => { changed(next); setModels(next) }}
      probe={{ settingsNs: 'llm-pi-ai', api: 'openai-completions', apiKey: 'must-not-be-sent' }}
      operations={testOperations(discoverModels)} t={key => en[key]} disabled={false} />
  }
  const view = render(<Editor />)
  return { ...view, changed }
}

describe('automatic local model presets', () => {
  it('fills an exact ID on blur without sending a credential', async () => {
    const discover = vi.fn(async () => ({ kind: 'found' as const, models: [preset] }))
    const { changed } = mount(discover)
    fireEvent.blur(screen.getByLabelText(`${en.modelId} 1`))
    await waitFor(() => { expect(changed).toHaveBeenCalled() })
    expect(discover).toHaveBeenCalledWith('llm-pi-ai', { modelId: 'known', api: 'openai-completions' })
    expect(changed.mock.lastCall?.[0]).toEqual([{ id: 'known', name: 'Known model', contextWindow: 128_000, maxTokens: 8192, reasoningEfforts: { high: 'high', max: 'max' } }])
  })

  it('keeps manual capacities and disabled reasoning while changing a recognized ID', async () => {
    const { changed } = mount(async () => ({ kind: 'found', models: [preset] }), {
      id: 'known', contextWindow: 64_000, reasoningEfforts: false,
    })
    fireEvent.blur(screen.getByLabelText(`${en.modelId} 1`))
    await waitFor(() => { expect(changed).toHaveBeenCalled() })
    expect(changed.mock.lastCall?.[0][0]).toMatchObject({ contextWindow: 64_000, maxTokens: 8192, reasoningEfforts: false })
    fireEvent.change(screen.getByLabelText(`${en.modelId} 1`), { target: { value: 'unknown' } })
    expect(changed.mock.lastCall?.[0]).toEqual([{ id: 'unknown', contextWindow: 64_000, reasoningEfforts: false }])
  })

  it('ignores a preset that finishes after the row was edited or removed', async () => {
    const pending = Promise.withResolvers<Awaited<ReturnType<ModelsOperations['discoverModels']>>>()
    const { changed, unmount } = mount(async () => await pending.promise)
    fireEvent.blur(screen.getByLabelText(`${en.modelId} 1`))
    fireEvent.change(screen.getByLabelText(`${en.modelId} 1`), { target: { value: 'other' } })
    pending.resolve({ kind: 'found', models: [preset] })
    await pending.promise
    await waitFor(() => { expect(changed.mock.lastCall?.[0]).toEqual([{ id: 'other' }]) })
    unmount()
  })

  it('ignores a pending lookup after the editor unmounts', async () => {
    const pending = Promise.withResolvers<Awaited<ReturnType<ModelsOperations['discoverModels']>>>()
    const { changed, unmount } = mount(async () => await pending.promise)
    fireEvent.blur(screen.getByLabelText(`${en.modelId} 1`))
    unmount()
    pending.resolve({ kind: 'found', models: [preset] })
    await pending.promise
    expect(changed).not.toHaveBeenCalled()
  })

  it('discards a pending preset when the owning adapter changes', async () => {
    const pending = Promise.withResolvers<Awaited<ReturnType<ModelsOperations['discoverModels']>>>()
    const changed = vi.fn()
    const props = {
      models: [{ id: 'known' }], onChange: changed, disabled: false,
      operations: testOperations(async () => await pending.promise),
      t: (key: keyof typeof en) => en[key],
    }
    const view = render(<ModelListEditor {...props} probe={{ settingsNs: 'llm-pi-ai' }} />)
    fireEvent.blur(screen.getByLabelText(`${en.modelId} 1`))
    view.rerender(<ModelListEditor {...props} probe={{ settingsNs: 'another-adapter' }} />)
    await act(async () => {
      pending.resolve({ kind: 'found', models: [preset] })
      await pending.promise
    })
    expect(changed).not.toHaveBeenCalled()
  })

  it.each(['unknown', 'refused', 'offline'])('keeps manual entry usable when the preset is %s', async (kind) => {
    const { changed } = mount(async () => {
      if (kind === 'offline') throw new Error('Host unavailable')
      return kind === 'refused' ? { kind: 'refused', message: 'Preset unavailable' } : { kind: 'found', models: [] }
    })
    await act(async () => { fireEvent.blur(screen.getByLabelText(`${en.modelId} 1`)) })
    expect(changed).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText(`${en.modelName} 1`), { target: { value: 'Manual name' } })
    await waitFor(() => { expect(changed.mock.lastCall?.[0]).toEqual([{ id: 'known', name: 'Manual name' }]) })
  })

  it('keeps an explicitly edited automatic capacity when the model ID changes', async () => {
    const { changed } = mount(async () => ({ kind: 'found', models: [preset] }))
    fireEvent.blur(screen.getByLabelText(`${en.modelId} 1`))
    await waitFor(() => { expect(changed).toHaveBeenCalled() })
    fireEvent.click(screen.getByLabelText(`${en.modelAdvanced} 1`))
    fireEvent.change(screen.getByLabelText(`${en.modelContextWindow} 1`), { target: { value: '90000' } })
    fireEvent.change(screen.getByLabelText(`${en.modelId} 1`), { target: { value: 'other' } })
    expect(changed.mock.lastCall?.[0]).toEqual([{ id: 'other', contextWindow: 90_000 }])
  })
  it.each([
    { disabled: true, settingsNs: 'llm-pi-ai', id: 'known' },
    { disabled: false, settingsNs: 'another-adapter', id: 'known' },
    { disabled: false, settingsNs: 'llm-pi-ai', id: '' },
  ])('does not query presets for an ineligible model input: %j', async ({ disabled, settingsNs, id }) => {
    const discover = vi.fn(async () => ({ kind: 'found' as const, models: [preset] }))
    render(<ModelListEditor models={[{ id }]} onChange={vi.fn()} disabled={disabled}
      probe={{ settingsNs }} operations={testOperations(discover)} t={key => en[key]} />)
    await act(async () => { fireEvent.blur(screen.getByLabelText(`${en.modelId} 1`)) })
    expect(discover).not.toHaveBeenCalled()
  })

  it('keeps a fully populated model unchanged after a matching preset returns', async () => {
    const { changed } = mount(async () => ({ kind: 'found', models: [preset] }), {
      id: 'known', name: 'Manual name', contextWindow: 64_000, maxTokens: 4096,
      reasoningEfforts: false,
    })
    await act(async () => { fireEvent.blur(screen.getByLabelText(`${en.modelId} 1`)) })
    expect(changed).not.toHaveBeenCalled()
  })

  it('passes provider and endpoint hints while preserving neighboring models', async () => {
    const discover = vi.fn(async () => ({ kind: 'found' as const, models: [preset] }))
    const changed = vi.fn<(models: ModelDraft[]) => void>()
    const other = { id: 'other', name: 'Keep me' }
    const props: ModelListEditorProps = {
      models: [{ id: 'known' }, other], onChange: changed, disabled: false,
      probe: { settingsNs: 'llm-pi-ai', provider: 'openai', baseURL: 'https://example.test/v1' },
      operations: testOperations(discover), t: key => en[key],
    }
    render(<ModelListEditor {...props} />)
    await act(async () => { fireEvent.blur(screen.getByLabelText(`${en.modelId} 1`)) })
    expect(discover).toHaveBeenCalledWith('llm-pi-ai', {
      modelId: 'known', provider: 'openai', baseURL: 'https://example.test/v1',
    })
    expect(changed.mock.lastCall?.[0][0]).toMatchObject({ id: 'known', maxTokens: 8192 })
    expect(changed.mock.lastCall?.[0][1]).toBe(other)
  })

})
