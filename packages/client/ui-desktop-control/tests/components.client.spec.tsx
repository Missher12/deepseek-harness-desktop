// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DesktopControlCapsule,
  DesktopControlSettings,
} from '../src/client/components.tsx'
import type { DesktopControlUiSnapshot } from '../src/client/contracts.ts'
import { apply } from '../src/client/index.ts'

const snapshot: DesktopControlUiSnapshot = {
  supported: true,
  computerEnabled: true,
  permissions: { screenViewing: 'granted', assistiveControl: 'denied' },
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

  it('shows both OS permission states, the ordinary allowlist, and shortcut setting', () => {
    const mutate = vi.fn()
    const view = render(<DesktopControlSettings snapshot={snapshot} onMutation={mutate} />)
    expect(view.getByText('Screen Viewing')).toBeTruthy()
    expect(view.getByText('Assistive Control')).toBeTruthy()
    expect(view.getByText('Granted')).toBeTruthy()
    expect(view.getByText('Denied')).toBeTruthy()
    fireEvent.click(view.getByRole('checkbox', { name: 'Mail' }))
    expect(mutate).toHaveBeenCalledWith({ kind: 'set-app-allowed', appId: 'com.example.mail', allowed: true })
    fireEvent.change(view.getByLabelText('Emergency shortcut'), { target: { value: 'CommandOrControl+Shift+F11' } })
    expect(mutate).toHaveBeenCalledWith({ kind: 'set-emergency-accelerator', accelerator: 'CommandOrControl+Shift+F11' })
  })

  it('keeps an unavailable provider as a local status instead of throwing', () => {
    const view = render(<DesktopControlSettings
      snapshot={{ ...snapshot, supported: false, ordinaryApps: [], active: null }}
      onMutation={vi.fn()}
    />)
    expect(view.getByText('Unavailable')).toBeTruthy()
  })
})
