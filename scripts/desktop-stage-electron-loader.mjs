/** Import-only Electron facade used by the stage-shaped Desktop main smoke. */
const ELECTRON_STUB_URL = 'dsh-desktop-stage-smoke:electron'

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'electron') return { url: ELECTRON_STUB_URL, shortCircuit: true }
  return await nextResolve(specifier, context)
}

export async function load(url, context, nextLoad) {
  if (url !== ELECTRON_STUB_URL) return await nextLoad(url, context)
  return {
    format: 'module',
    shortCircuit: true,
    source: `
      const noop = () => undefined
      export const app = Object.freeze({
        dock: Object.freeze({ setIcon: noop }),
        isPackaged: false,
        setName: noop,
        getPath: () => process.env.DSH_DESKTOP_STAGE_SMOKE_USER_DATA,
        getVersion: () => 'stage-import-smoke',
        requestSingleInstanceLock: () => false,
        whenReady: async () => undefined,
        on: noop,
        quit: () => { globalThis.__DSH_DESKTOP_STAGE_IMPORT_QUIT__ = true },
        exit: noop,
      })
      export class BrowserWindow {}
      export class Tray {}
      export class WebContentsView {}
      export const ipcMain = Object.freeze({ on: noop, handle: noop })
      export const Menu = Object.freeze({ buildFromTemplate: () => Object.freeze([]), setApplicationMenu: noop })
      export const screen = Object.freeze({ getAllDisplays: () => Object.freeze([]) })
      export const shell = Object.freeze({
        openExternal: async () => undefined,
        openPath: async () => '',
        showItemInFolder: noop,
      })
    `,
  }
}
