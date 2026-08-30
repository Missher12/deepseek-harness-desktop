// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {} from '../src/client/index.ts'
import { SystemUpdateSection, type SystemUpdateSectionProps } from '../src/client/SystemUpdateSection.tsx'
import type { DesktopUpdateSnapshot } from '../src/client/contracts.ts'
import { en, type SystemUpdateLocaleKey } from '../src/client/locales.ts'

afterEach(cleanup)

const t = ((key: SystemUpdateLocaleKey): string => en[key]) as SystemUpdateSectionProps['t']
const unusedHook = (() => { throw new Error('unused by system-update components') }) as never
const IDLE: DesktopUpdateSnapshot = {
  phase: 'idle',
  runningDesktop: '0.2.1',
  includedHarness: '0.1.0-rc.8',
  latestOfficialHarness: null,
  latestDesktop: null,
  lastCheckedAt: null,
  downloadProgress: null,
  message: null,
}

function props(
  snapshot: DesktopUpdateSnapshot,
  operations: Partial<Pick<SystemUpdateSectionProps, 'check' | 'download' | 'install'>> = {},
): SystemUpdateSectionProps {
  return {
    close: vi.fn(),
    t,
    useSessions: unusedHook,
    useSessionPendingInteraction: unusedHook,
    useWorkspaces: unusedHook,
    useStore: selector => selector({ snapshot }),
    actions: unusedHook,
    check: operations.check ?? vi.fn(async () => {}),
    download: operations.download ?? vi.fn(async () => {}),
    install: operations.install ?? vi.fn(async () => {}),
  }
}

describe('SystemUpdateSection', () => {
  it('renders sanitized versions and invokes the fixed check operation', () => {
    const check = vi.fn(async () => {})
    render(createElement(SystemUpdateSection, props(IDLE, { check })))

    expect(screen.getByText('v0.2.1')).toBeTruthy()
    expect(screen.getByText('Included 0.1.0-rc.8')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.check }))
    expect(check).toHaveBeenCalledOnce()
  })

  it('selects only the operation allowed by the current phase', () => {
    const download = vi.fn(async () => {})
    const view = render(createElement(SystemUpdateSection, props({
      ...IDLE,
      phase: 'desktop-available',
      latestDesktop: '0.2.2',
    }, { download })))
    fireEvent.click(screen.getByRole('button', { name: en.download }))
    expect(download).toHaveBeenCalledOnce()

    view.rerender(createElement(SystemUpdateSection, props({
      ...IDLE,
      phase: 'error',
      message: 'Verification failed.',
    })))
    expect(screen.getByText('Verification failed.')).toBeTruthy()
  })

  it.each([
    ['idle', en.current],
    ['current', en.current],
    ['checking', en.checking],
    ['upstream-available', en.upstream],
    ['desktop-available', en.desktopReady],
    ['downloading', 'Downloading 0%'],
    ['verifying', en.verifying],
    ['ready', en.ready],
    ['installing', en.installing],
    ['error', '—'],
  ] as const)('renders the %s status without inventing update facts', (phase, expected) => {
    render(createElement(SystemUpdateSection, props({ ...IDLE, phase })))

    expect(screen.getAllByText(expected).length).toBeGreaterThan(0)
  })

  it('renders progress, latest versions, and a completed check timestamp', () => {
    render(createElement(SystemUpdateSection, props({
      ...IDLE,
      phase: 'downloading',
      latestOfficialHarness: '0.1.1',
      downloadProgress: 0.426,
      lastCheckedAt: 1_700_000_000_000,
    })))

    expect(screen.getByText('Latest 0.1.1')).toBeTruthy()
    expect(screen.getByText('Downloading 43%')).toBeTruthy()
    expect(document.querySelector('[style="width: 43%;"]')).toBeTruthy()
    expect(screen.getByText(/^Last checked:/u)).toBeTruthy()
  })

  it('runs install only when ready and releases the busy state after rejection', async () => {
    const install = vi.fn(async () => {})
    const rejected = vi.fn(() => Promise.reject(new Error('offline')))
    const view = render(createElement(SystemUpdateSection, props({ ...IDLE, phase: 'ready' }, { install })))
    const installButton = screen.getByRole('button', { name: en.install }) as HTMLButtonElement
    fireEvent.click(installButton)
    expect(install).toHaveBeenCalledOnce()
    await waitFor(() => { expect(installButton.disabled).toBe(false) })

    view.rerender(createElement(SystemUpdateSection, props(IDLE, { check: rejected })))
    const button = screen.getByRole('button', { name: en.check })
    fireEvent.click(button)
    expect((button as HTMLButtonElement).disabled).toBe(true)
    await waitFor(() => { expect((button as HTMLButtonElement).disabled).toBe(false) })
  })

  it.each(['checking', 'downloading', 'verifying', 'installing'] as const)(
    'disables the action while %s is in progress',
    (phase) => {
      render(createElement(SystemUpdateSection, props({ ...IDLE, phase })))
      expect(screen.getByRole('button').hasAttribute('disabled')).toBe(true)
    },
  )
})
