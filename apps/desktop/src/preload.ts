import { contextBridge, ipcRenderer } from 'electron'
import {
  type DesktopApi,
  isDesktopCommand,
  isRecoveryAction,
} from './preload-api.ts'

const api: DesktopApi = {
  onCommand(listener) {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      if (isDesktopCommand(value)) listener(value)
    }
    ipcRenderer.on('desktop:command', handler)
    return () => { ipcRenderer.off('desktop:command', handler) }
  },
  recover(action) {
    if (!isRecoveryAction(action)) throw new Error('Unknown desktop recovery action.')
    ipcRenderer.send('desktop:recovery', action)
  },
}

contextBridge.exposeInMainWorld('dshDesktop', api)
