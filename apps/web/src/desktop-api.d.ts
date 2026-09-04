/** Closed command bridge exposed by the Electron preload script. */
interface DshDesktopApi {
  readonly presentation?: unknown
  onCommand(listener: (command: unknown) => void): () => void
  getDesktopIntegrations?(): Promise<unknown>
}

declare global {
  interface Window {
    dshDesktop?: DshDesktopApi
  }
}

export {}
