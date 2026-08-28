// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DesktopControlCapsule,
  DesktopControlSettings,
} from '../src/client/components.tsx'
import {
  isDesktopControlUiSnapshot,
  type DesktopControlUiSnapshot,
} from '../src/client/contracts.ts'
import { apply } from '../src/client/index.ts'
import { zh } from '../src/client/locales.ts'

const snapshot: DesktopControlUiSnapshot = {
  browser: { availability: 'available', enabled: false },
  computer: { availability: 'available', enabled: true },
  permissions: { screenViewing: 'granted', assistiveControl: 'denied' },
  refresh: { status: { state: 'ready' }, apps: { state: 'ready' } },
  ordinaryApps: [
    { appId: 'com.example.notes', name: 'Notes', allowed: true },
    { appId: 'com.example.mail', name: 'Mail', allowed: false },
  ],
  emergencyAccelerator: 'CommandOrControl+Shift+F12',
  active: { agentName: 'Agent', appName: 'Notes', action: 'Typing' },
  stopping: false,
}

afterEach(cleanup)

describe('Desktop control UI', () => {
  it('registers nothing when the Desktop preload/provider bridge is absent', () => {
    delete (window as unknown as { dshDesktop?: unknown }).dshDesktop
    const effect = vi.fn()
    const inject = vi.fn()
    expect(() => { apply({ effect, slots: { inject } } as never) }).not.toThrow()
    expect(effect).not.toHaveBeenCalled()
    expect(inject).not.toHaveBeenCalled()
  })

  it('shows the current Agent, app, action, and approval-free Stop without Pause', () => {
    const stop = vi.fn()
    const view = render(<DesktopControlCapsule snapshot={snapshot} onStop={stop} />)
    expect(view.getByText('Agent')).toBeTruthy()
    expect(view.getByText('Notes')).toBeTruthy()
    expect(view.getByText('Typing')).toBeTruthy()
    expect(view.queryByText(/pause/i)).toBeNull()
    fireEvent.click(view.getByRole('button', { name: 'Stop' }))
    expect(stop).toHaveBeenCalledOnce()
  })

  it('shows both OS permission states, the ordinary allowlist, and commits the shortcut on blur', () => {
    const mutate = vi.fn()
    const view = render(<DesktopControlSettings snapshot={snapshot} onMutation={mutate} />)
    fireEvent.click(view.getByRole('checkbox', { name: 'Browser control' }))
    expect(mutate).toHaveBeenCalledWith({ kind: 'set-browser-enabled', enabled: true })
    expect(view.getByText('Screen Viewing')).toBeTruthy()
    expect(view.getByText('Assistive Control')).toBeTruthy()
    expect(view.getByText('Granted')).toBeTruthy()
    expect(view.getByText('Denied')).toBeTruthy()
    expect(view.container.querySelector('[data-desktop-control-app-list]')).toBeTruthy()
    fireEvent.click(view.getByRole('checkbox', { name: 'Mail' }))
    expect(mutate).toHaveBeenCalledWith({ kind: 'set-app-allowed', appId: 'com.example.mail', allowed: true })
    fireEvent.change(view.getByLabelText('Emergency Stop shortcut'), { target: { value: 'CommandOrControl+Shift+F11' } })
    expect(mutate).not.toHaveBeenCalledWith({ kind: 'set-emergency-accelerator', accelerator: 'CommandOrControl+Shift+F11' })
    fireEvent.blur(view.getByLabelText('Emergency Stop shortcut'))
    expect(mutate).toHaveBeenCalledWith({ kind: 'set-emergency-accelerator', accelerator: 'CommandOrControl+Shift+F11' })
    expect(view.getByText('2 capabilities available')).toBeTruthy()
    expect(view.getByText('Available · Not enabled')).toBeTruthy()
    expect(view.getByText('Available · Enabled')).toBeTruthy()
  })

  it('keeps browser enablement in the strict renderer snapshot and Chinese settings', () => {
    expect(isDesktopControlUiSnapshot(snapshot)).toBe(true)
    expect(isDesktopControlUiSnapshot({ ...snapshot, supported: true })).toBe(false)
    expect(isDesktopControlUiSnapshot({
      ...snapshot, browser: { availability: new String('available'), enabled: false },
    })).toBe(false)
    const mutate = vi.fn()
    const view = render(<DesktopControlSettings snapshot={snapshot} onMutation={mutate} labels={zh} />)
    fireEvent.click(view.getByRole('checkbox', { name: '浏览器控制' }))
    expect(mutate).toHaveBeenCalledWith({ kind: 'set-browser-enabled', enabled: true })
  })

  it('keeps an unavailable provider as a local status instead of throwing', () => {
    const view = render(<DesktopControlSettings
      snapshot={{
        ...snapshot,
        computer: { availability: 'unavailable', enabled: false },
        ordinaryApps: [],
        active: null,
      }}
      onMutation={vi.fn()}
    />)
    expect(view.getByText('Unavailable · Not enabled')).toBeTruthy()
    expect(view.getByText('1 capability available')).toBeTruthy()
  })

  it('explains the application allowlist and the separate task approval before control can start', () => {
    const view = render(<DesktopControlSettings
      snapshot={{
        ...snapshot,
        ordinaryApps: snapshot.ordinaryApps.map(app => ({ ...app, allowed: false })),
        active: null,
      }}
      onMutation={vi.fn()}
    />)

    expect(view.getByRole('status').textContent).toContain('Select at least one application')
    expect(view.getByText('Listing an application does not authorize it.')).toBeTruthy()
    expect(view.getByText('Each new task uses a separate native approval. The Harness ask/never policy does not replace it.')).toBeTruthy()
  })

  it('keeps last-known rows visible and offers a bounded refresh retry', () => {
    const retry = vi.fn()
    const view = render(<DesktopControlSettings
      snapshot={{
        ...snapshot,
        refresh: {
          status: { state: 'failed', message: 'Computer status could not be refreshed.' },
          apps: { state: 'ready' },
        },
      }}
      onMutation={vi.fn()}
      onRetry={retry}
    />)
    expect(view.getByText('Computer status could not be refreshed.')).toBeTruthy()
    expect(view.getByText('Notes')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Retry status' }))
    expect(retry).toHaveBeenCalledOnce()
  })

  it('blocks duplicate mutations only for the affected row and reports rejection', async () => {
    let rejectBrowser: ((reason: Error) => void) | undefined
    const browserPending = new Promise<void>((_resolve, reject) => { rejectBrowser = reject })
    const mutate = vi.fn((mutation: { kind: string }) => mutation.kind === 'set-browser-enabled'
      ? browserPending
      : Promise.resolve())
    const view = render(<DesktopControlSettings snapshot={snapshot} onMutation={mutate} />)

    fireEvent.click(view.getByRole('checkbox', { name: 'Browser control' }))
    expect(view.getByRole('checkbox', { name: 'Browser control' })).toHaveProperty('disabled', true)
    expect(view.getByRole('checkbox', { name: 'Computer control' })).toHaveProperty('disabled', false)
    fireEvent.click(view.getByRole('checkbox', { name: 'Browser control' }))
    fireEvent.click(view.getByRole('checkbox', { name: 'Computer control' }))
    expect(mutate).toHaveBeenCalledTimes(2)

    rejectBrowser?.(new Error('private mutation detail'))
    await waitFor(() => { expect(view.getByRole('alert').textContent).toBe('The setting could not be changed.') })
    expect(view.queryByText(/private mutation/i)).toBeNull()
  })
})
