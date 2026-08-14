import type { BrowserWindowConstructorOptions } from 'electron'
import type { WindowBounds } from './state.ts'

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
    ...(platform === 'darwin'
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
