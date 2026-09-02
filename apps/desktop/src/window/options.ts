import type { BrowserWindowConstructorOptions } from 'electron'
import type { WindowBounds } from './state.ts'

const WINDOWS_TRAY_ICON_SIZES = [16, 20, 24, 32] as const
export type WindowsTrayIconSize = typeof WINDOWS_TRAY_ICON_SIZES[number]

function usesHiddenInsetTitlebar(platform: NodeJS.Platform): boolean {
  return platform === 'darwin'
}

/**
 * Match renderer chrome reservation to the BrowserWindow's native title bar.
 * @param url - Owned Harness renderer URL.
 * @param platform - Native Electron platform for the current window.
 * @returns URL whose presentation marker cannot retain a spoofed stale value.
 */
export function desktopRendererUrl(
  url: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const target = new URL(url)
  if (usesHiddenInsetTitlebar(platform)) target.searchParams.set('titlebar', 'hidden-inset')
  else target.searchParams.delete('titlebar')
  return target.href
}

/** Select the smallest dedicated tray bitmap that covers the current DPI. */
export function selectWindowsTrayIconSize(scaleFactor: number): WindowsTrayIconSize {
  if (!Number.isFinite(scaleFactor) || scaleFactor <= 0) {
    throw new Error('Windows tray icon scale factor must be a positive finite number.')
  }
  const physicalPixels = 16 * scaleFactor
  return WINDOWS_TRAY_ICON_SIZES.find(size => size >= physicalPixels) ?? 32
}

/**
 * Create the hardened BrowserWindow configuration shared by dev and package builds.
 * @param bounds - Validated window geometry.
 * @param preload - Absolute path to the bundled preload entry.
 * @returns Electron constructor options with no Node renderer privileges.
 */
export function createWindowOptions(
  bounds: WindowBounds,
  preload: string,
  platform: NodeJS.Platform = process.platform,
  windowsIcon?: string,
): BrowserWindowConstructorOptions {
  let iconOptions: Pick<BrowserWindowConstructorOptions, 'icon'> = {}
  if (platform === 'win32') {
    if (windowsIcon === undefined || windowsIcon.length === 0) {
      throw new Error('Windows BrowserWindow requires its dedicated icon.')
    }
    iconOptions = { icon: windowsIcon }
  }
  return {
    ...bounds,
    minWidth: 900,
    minHeight: 620,
    show: false,
    title: 'DeepSeek Harness',
    ...iconOptions,
    ...(usesHiddenInsetTitlebar(platform)
      ? {
        titleBarStyle: 'hiddenInset' as const,
        trafficLightPosition: { x: 16, y: 16 },
      }
      : {}),
    webPreferences: {
      preload,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      partition: 'persist:dsh-desktop',
    },
  }
}
