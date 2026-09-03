/** Closed command bridge exposed by the Electron preload script. */
interface DshDesktopApi {
  onCommand(listener: (command: unknown) => void): () => void
}

declare global {
  interface Window {
    dshDesktop?: DshDesktopApi
  }
}

export {}
