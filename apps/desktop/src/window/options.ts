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
 * @param bounds - Geometry fitted to the selected display work area.
 * @param preload - Absolute path to the bundled preload entry.
 * @returns Electron constructor options with no Node renderer privileges.
 */
export function createWindowOptions(
  bounds: WindowBounds,
  preload: string,
  platform: NodeJS.Platform = process.platform,
  nativeIcon?: string,
): BrowserWindowConstructorOptions {
  let iconOptions: Pick<BrowserWindowConstructorOptions, 'icon'> = {}
  if (platform === 'win32' || platform === 'linux') {
    if (nativeIcon === undefined || nativeIcon.length === 0) {
      throw new Error(`${platform === 'win32' ? 'Windows' : 'Linux'} BrowserWindow requires its dedicated icon.`)
    }
    iconOptions = { icon: nativeIcon }
  }
  // Windows expands minimum dimensions through non-client pixel conversion.
  // Release an axis at or below its normal minimum instead of pinning it to
  // the available area, where that expansion can force the window outside it.
  return {
    ...bounds,
    minWidth: platform === 'win32' && bounds.width <= 900 ? 0 : Math.min(900, bounds.width),
    minHeight: platform === 'win32' && bounds.height <= 620 ? 0 : Math.min(620, bounds.height),
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
