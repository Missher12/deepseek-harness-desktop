import type { BrowserWindowConstructorOptions } from 'electron'
import type { WindowBounds } from './state.ts'

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
): BrowserWindowConstructorOptions {
  return {
    ...bounds,
    minWidth: 900,
    minHeight: 620,
    show: false,
    title: 'DeepSeek Harness',
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
