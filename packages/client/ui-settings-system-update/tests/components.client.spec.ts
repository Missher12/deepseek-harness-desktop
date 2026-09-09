// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {} from '../src/client/index.ts'
import { SystemUpdateSection, type SystemUpdateSectionProps } from '../src/client/SystemUpdateSection.tsx'
import type { DesktopUpdatePresentation, DesktopUpdateSnapshot } from '../src/client/contracts.ts'
import { en, zh, type SystemUpdateLocaleKey } from '../src/client/locales.ts'
import { EMPTY_UPDATE_SNAPSHOT } from '../src/client/store.ts'

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
  assetName: null,
  downloadedBytes: null,
  downloadTotalBytes: null,
  platform: 'darwin',
  arch: 'x64',
  packageFormat: 'dmg',
  installAction: 'protected-replace',
  supportReason: null,
}

function props(
  snapshot: DesktopUpdateSnapshot,
  operations: Partial<Pick<SystemUpdateSectionProps, 'retryStatus' | 'check' | 'download' | 'cancelDownload' | 'install'>> = {},
  statusLoad: 'loading' | 'ready' | 'error' = 'ready',
): SystemUpdateSectionProps {
  return {
    close: vi.fn(),
    t,
    useSessions: unusedHook,
    useSessionPendingInteraction: unusedHook,
    useWorkspaces: unusedHook,
    useStore: selector => selector({ snapshot, statusLoad }),
    actions: unusedHook,
    retryStatus: operations.retryStatus ?? vi.fn(async () => {}),
    check: operations.check ?? vi.fn(async () => {}),
    download: operations.download ?? vi.fn(async () => {}),
    cancelDownload: operations.cancelDownload ?? vi.fn(async () => {}),
    install: operations.install ?? vi.fn(async () => {}),
  }
}

describe('SystemUpdateSection', () => {
  it.each([
    ['en', en, 'Reading update status', 'Retry status', 'Unable to read update status. Retry to confirm this installation before checking, downloading, or installing updates.'],
    ['zh', zh, '正在读取更新状态', '重试读取状态', '无法读取更新状态。请重试以确认当前安装信息；确认前无法检查、下载或安装更新。'],
  ] as const)('offers only a safe localized status retry before the %s native target is known', async (_language, dictionary, loading, retry, error) => {
    const retryStatus = vi.fn(async () => {})
    const check = vi.fn(async () => {})
    const download = vi.fn(async () => {})
    const install = vi.fn(async () => {})
    const localized = (statusLoad: 'loading' | 'ready' | 'error', snapshot = EMPTY_UPDATE_SNAPSHOT): SystemUpdateSectionProps => ({
      ...props(snapshot, { retryStatus, check, download, install }, statusLoad),
      t: ((key: SystemUpdateLocaleKey): string => dictionary[key]) as SystemUpdateSectionProps['t'],
    })
    const view = render(createElement(SystemUpdateSection, localized('loading')))
    expect(screen.getByRole<HTMLButtonElement>('button', { name: loading }).disabled).toBe(true)
    expect(screen.queryByText(dictionary.unsupportedRuntime)).toBeNull()

    view.rerender(createElement(SystemUpdateSection, localized('error')))
    expect(screen.getByRole('alert').textContent).toContain(error)
    const retryButton = screen.getByRole<HTMLButtonElement>('button', { name: retry })
    expect(retryButton.disabled).toBe(false)
    expect(screen.getAllByRole('button')).toHaveLength(1)
    fireEvent.click(retryButton)
    await waitFor(() => { expect(retryButton.disabled).toBe(false) })
    expect(retryStatus.mock.calls).toEqual([[]])
    expect(check).not.toHaveBeenCalled()
    expect(download).not.toHaveBeenCalled()
    expect(install).not.toHaveBeenCalled()

    view.rerender(createElement(SystemUpdateSection, localized('ready', IDLE)))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText(error)).toBeNull()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: dictionary.check }).disabled).toBe(false)
  })

  it('shows a stable localized failure when an operation rejects without an Error', async () => {
    render(createElement(SystemUpdateSection, props(IDLE, { check: vi.fn().mockRejectedValue(null) })))
    fireEvent.click(screen.getByRole('button', { name: en.check }))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain(en.operationFailed) })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en.check }).disabled).toBe(false)
  })

  it('renders sanitized versions and invokes the fixed check operation', () => {
    const check = vi.fn(async () => {})
    render(createElement(SystemUpdateSection, props(IDLE, { check })))

    expect(screen.getByText('v0.2.1')).toBeTruthy()
    expect(screen.getByText('v0.1.0-rc.8')).toBeTruthy()
    expect(screen.queryByText(en.current)).toBeNull()
    expect(screen.getByText(en.prerelease)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.check }))
    expect(check).toHaveBeenCalledOnce()
  })

  it.each([
    ['en', en, 'Save your work first. Selecting Restart and install prepares the protected update helper, then quits Desktop to install the verified DMG.', 'native confirmation'],
    ['zh', zh, '请先保存工作。点击“重启并安装”会准备受保护的更新辅助程序，然后退出 Desktop 以安装已校验的 DMG。', '原生确认'],
  ] as const)('describes the explicit Mac install action and reserves confirmation guidance for Windows in %s', (_language, dictionary, macGuidance, confirmation) => {
    const localized = (snapshot: DesktopUpdateSnapshot): SystemUpdateSectionProps => ({
      ...props(snapshot),
      t: ((key: SystemUpdateLocaleKey): string => dictionary[key]) as SystemUpdateSectionProps['t'],
    })
    const view = render(createElement(SystemUpdateSection, localized({ ...IDLE, phase: 'ready' })))
    expect(screen.getByText(macGuidance)).toBeTruthy()
    expect(view.container.textContent).not.toContain(confirmation)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: dictionary.install }).disabled).toBe(false)

    view.rerender(createElement(SystemUpdateSection, localized({
      ...IDLE, phase: 'ready', platform: 'win32', packageFormat: 'nsis', installAction: 'open-setup-wizard',
    })))
    expect(screen.getByText(dictionary.windowsSetupGuidance).textContent).toContain(confirmation)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: dictionary.openSetup }).disabled).toBe(false)
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
    ['idle', en.idle],
    ['current', en.current],
    ['checking', en.checking],
    ['upstream-available', en.upstream],
    ['desktop-available', en.desktopReady],
    ['downloading', 'Downloading…'],
    ['verifying', en.verifying],
    ['ready', en.ready],
    ['installing', en.installing],
    ['error', en.error],
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
      downloadedBytes: 426,
      downloadTotalBytes: 1000,
      lastCheckedAt: 1_700_000_000_000,
    })))

    expect(screen.getByText('Official latest · v0.1.1')).toBeTruthy()
    expect(screen.getByText('Downloading 43%')).toBeTruthy()
    expect(screen.getByRole('progressbar').getAttribute('value')).toBe('43')
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
    expect(screen.getByRole('alert').textContent).toContain(en.operationFailed)
    expect(screen.getByText('offline')).toBeTruthy()
  })

  it('shows the Desktop target before allowing its download', () => {
    render(createElement(SystemUpdateSection, props({
      ...IDLE, phase: 'desktop-available', latestDesktop: '0.5.6',
    })))
    expect(screen.getByText('Available update · v0.5.6')).toBeTruthy()
    expect(screen.getByRole('link', { name: en.desktopRelease }).getAttribute('href'))
      .toBe('https://github.com/Missher12/deepseek-harness-desktop/releases')
  })

  it('shows verification as indeterminate progress and cannot install early', () => {
    render(createElement(SystemUpdateSection, props({ ...IDLE, phase: 'verifying', downloadProgress: 1 })))
    expect(screen.getByRole('progressbar').hasAttribute('value')).toBe(false)
    expect(screen.queryByRole('button', { name: en.install })).toBeNull()
  })

  it.each(['checking', 'downloading', 'verifying', 'installing'] as const)(
    'disables the action while %s is in progress',
    (phase) => {
      render(createElement(SystemUpdateSection, props({ ...IDLE, phase })))
      expect(screen.getAllByRole('button')[0]!.hasAttribute('disabled')).toBe(true)
    },
  )

  it.each([
    [{ platform: 'darwin', arch: 'x64', packageFormat: 'dmg', installAction: 'protected-replace', supportReason: null }, 'macOS · Intel · DMG', 'Restart and install'],
    [{ platform: 'win32', arch: 'x64', packageFormat: 'nsis', installAction: 'open-setup-wizard', supportReason: null }, 'Windows · x64 · Setup', 'Open Setup'],
    [{ platform: 'linux', arch: 'x64', packageFormat: 'deb', installAction: 'reveal-package', supportReason: null }, 'Linux · x64 · .deb', 'Reveal installation package'],
    [{ platform: 'linux', arch: 'x64', packageFormat: 'appimage', installAction: 'reveal-package', supportReason: null }, 'Linux · x64 · AppImage', 'Reveal installation package'],
  ] satisfies [DesktopUpdatePresentation, string, string][])(
    'derives the native platform and install action from %j',
    async (presentation, platformLabel, actionLabel) => {
      const install = vi.fn(async () => {})
      const view = render(createElement(SystemUpdateSection, props({ ...IDLE, ...presentation, phase: 'ready' }, { install })))
      expect(screen.getByText(platformLabel)).toBeTruthy()
      expect(view.container.querySelectorAll('[data-update-version]')).toHaveLength(2)
      fireEvent.click(screen.getByRole('button', { name: actionLabel }))
      await waitFor(() => { expect(install).toHaveBeenCalledExactlyOnceWith() })
    },
  )

  it.each([
    { platform: 'linux', arch: 'x64', packageFormat: 'unknown', installAction: null, supportReason: 'detecting' },
    { platform: 'linux', arch: 'x64', packageFormat: 'unknown', installAction: null, supportReason: 'unknown-package' },
    { platform: 'unsupported', arch: 'unsupported', packageFormat: 'unknown', installAction: null, supportReason: 'unsupported-runtime' },
  ] satisfies DesktopUpdatePresentation[])(
    'disables update operations while the native target is %j',
    (presentation) => {
      const check = vi.fn(async () => {})
      render(createElement(SystemUpdateSection, props({ ...IDLE, ...presentation }, { check })))
      const button = screen.getByRole<HTMLButtonElement>('button', { name: en.check })
      expect(button.disabled).toBe(true)
      fireEvent.click(button)
      expect(check).not.toHaveBeenCalled()
      expect(screen.queryByText('macOS · Intel')).toBeNull()
      expect(screen.getByRole('status').textContent).toMatch(/Detecting|not recognized|not supported/u)
    },
  )

  it('keeps an unknown download percentage indeterminate instead of inventing zero', () => {
    render(createElement(SystemUpdateSection, props({ ...IDLE, phase: 'downloading' })))
    expect(screen.getByRole('progressbar').hasAttribute('value')).toBe(false)
    expect(screen.queryByText(/0%/u)).toBeNull()
  })

  it('shows observed bytes and the validated payload basename', () => {
    render(createElement(SystemUpdateSection, props({
      ...IDLE, phase: 'downloading', downloadProgress: 0.426,
      assetName: 'DeepSeek-Harness-0.5.7-mac-x64.dmg', downloadedBytes: 426, downloadTotalBytes: 1000,
    })))
    expect(screen.getByText('DeepSeek-Harness-0.5.7-mac-x64.dmg')).toBeTruthy()
    expect(screen.getByText('426 / 1,000 bytes downloaded')).toBeTruthy()
  })

  it('allows cancellation while the download invocation is still pending', async () => {
    let finishDownload!: () => void
    const download = vi.fn(() => new Promise<void>((resolve) => { finishDownload = resolve }))
    const cancelDownload = vi.fn(async () => {})
    const view = render(createElement(SystemUpdateSection, props({ ...IDLE, phase: 'desktop-available' }, { download, cancelDownload })))
    fireEvent.click(screen.getByRole('button', { name: en.download }))
    view.rerender(createElement(SystemUpdateSection, props({ ...IDLE, phase: 'downloading' }, { download, cancelDownload })))
    const cancelButton = screen.getByRole<HTMLButtonElement>('button', { name: 'Cancel download' })
    expect(cancelButton.disabled).toBe(false)
    fireEvent.click(cancelButton)
    await waitFor(() => { expect(cancelDownload).toHaveBeenCalledExactlyOnceWith() })
    finishDownload()
    view.rerender(createElement(SystemUpdateSection, props({ ...IDLE, phase: 'desktop-available' }, { download, cancelDownload })))
    await waitFor(() => { expect(screen.getByRole<HTMLButtonElement>('button', { name: en.download }).disabled).toBe(false) })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Cancel download' })).toBeNull()
  })

  it('allows cancellation during verification', async () => {
    const cancelDownload = vi.fn(async () => {})
    render(createElement(SystemUpdateSection, props({ ...IDLE, phase: 'verifying' }, { cancelDownload })))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel download' }))
    await waitFor(() => { expect(cancelDownload).toHaveBeenCalledExactlyOnceWith() })
  })

  it.each(['idle', 'checking', 'current', 'upstream-available', 'desktop-available', 'ready', 'installing', 'error'] as const)(
    'offers no download cancellation in %s',
    (phase) => {
      render(createElement(SystemUpdateSection, props({ ...IDLE, phase })))
      expect(screen.queryByRole('button', { name: 'Cancel download' })).toBeNull()
    },
  )

  it('describes Windows handoff without claiming the update has been installed', () => {
    const view = render(createElement(SystemUpdateSection, props({
      ...IDLE, platform: 'win32', packageFormat: 'nsis', installAction: 'open-setup-wizard',
      phase: 'installing', latestDesktop: '0.5.7',
    })))
    expect(screen.getByRole('status').textContent).toContain('Setup handoff requested')
    expect(screen.getByRole('status').textContent).toContain('not confirmed')
    expect(screen.queryByText(en.installingDetail)).toBeNull()
    expect(view.container.querySelectorAll('[data-update-version]')).toHaveLength(2)
    expect(screen.getByText('v0.2.1')).toBeTruthy()
    expect(screen.getByText('v0.1.0-rc.8')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Cancel download' })).toBeNull()
  })

  it.each(['deb', 'appimage'] as const)('allows repeated manual package reveal for Linux %s', async (packageFormat) => {
    const install = vi.fn(async () => {})
    const view = render(createElement(SystemUpdateSection, props({
      ...IDLE, platform: 'linux', packageFormat, installAction: 'reveal-package',
      phase: 'manual-install-ready', latestDesktop: '0.5.7',
    }, { install })))
    const button = screen.getByRole<HTMLButtonElement>('button', { name: 'Reveal installation package' })
    fireEvent.click(button)
    await waitFor(() => { expect(button.disabled).toBe(false) })
    fireEvent.click(button)
    await waitFor(() => { expect(install).toHaveBeenCalledTimes(2) })
    expect(screen.getByRole('status').textContent).toContain('Manual installation is still required')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Cancel download' })).toBeNull()
    expect(view.container.querySelectorAll('[data-update-version]')).toHaveLength(2)
    expect(screen.getByText('v0.2.1')).toBeTruthy()
    expect(screen.getByText('v0.1.0-rc.8')).toBeTruthy()
  })

  it.each([en, zh])('localizes format-specific manual guidance and safety limits', (dictionary) => {
    const localized = ((key: SystemUpdateLocaleKey): string => dictionary[key]) as SystemUpdateSectionProps['t']
    const view = render(createElement(SystemUpdateSection, {
      ...props({ ...IDLE, platform: 'linux', packageFormat: 'deb', installAction: 'reveal-package', phase: 'ready' }),
      t: localized,
    }))
    expect(screen.getByText(dictionary === zh ? /退出 Desktop.*软件包管理器/u : /Quit Desktop.*package manager/u)).toBeTruthy()
    expect(screen.queryByText(/AppArmor/u)).toBeNull()
    view.rerender(createElement(SystemUpdateSection, {
      ...props({ ...IDLE, platform: 'linux', packageFormat: 'appimage', installAction: 'reveal-package', phase: 'ready' }),
      t: localized,
    }))
    expect(screen.getByText(dictionary === zh ? /稳定.*版本.*位置/u : /stable.*versioned location/u)).toBeTruthy()
    expect(screen.getByText(/ASCII.*AppArmor/u)).toBeTruthy()
    expect(screen.getByRole('button', { name: dictionary === zh ? '查看安装包' : 'Reveal installation package' })).toBeTruthy()
  })
})
