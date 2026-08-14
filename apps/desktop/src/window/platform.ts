/** Native desktop behavior that differs between macOS and Windows. */
export interface DesktopPlatformBehavior {
  hideWindowOnClose: boolean
  setDockIcon: boolean
}

/**
 * Resolve native window lifecycle features for one host platform.
 * @param platform - Node platform identifier for the running Electron host.
 * @returns The close and Dock behavior supported by that platform.
 */
export function desktopPlatformBehavior(platform: NodeJS.Platform): DesktopPlatformBehavior {
  const macOS = platform === 'darwin'
  return {
    hideWindowOnClose: macOS,
    setDockIcon: macOS,
  }
}
