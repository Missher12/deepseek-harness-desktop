import { contextBridge, ipcRenderer } from 'electron'
import {
  type DesktopApi,
  isDesktopCommand,
  isDesktopUpdateSnapshot,
  isRecoveryAction,
} from './preload-api.ts'
import {
  isDesktopBrowserBounds, isDesktopBrowserRequest, isDesktopBrowserSnapshot,
} from './browser/contracts.ts'

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
  async getUpdateStatus() {
    const value: unknown = await ipcRenderer.invoke('desktop:update-status')
    if (!isDesktopUpdateSnapshot(value)) throw new Error('Invalid Desktop update status.')
    return value
  },
  async checkForUpdates() {
    const value: unknown = await ipcRenderer.invoke('desktop:update-check')
    if (!isDesktopUpdateSnapshot(value)) throw new Error('Invalid Desktop update status.')
    return value
  },
  async downloadUpdate() {
    const value: unknown = await ipcRenderer.invoke('desktop:update-download')
    if (!isDesktopUpdateSnapshot(value)) throw new Error('Invalid Desktop update status.')
    return value
  },
  async installUpdate() {
    const value: unknown = await ipcRenderer.invoke('desktop:update-install')
    if (typeof value !== 'object' || value === null || !('opened' in value) || typeof value.opened !== 'boolean') {
      throw new Error('Invalid Desktop installer result.')
    }
    return value as { opened: boolean; message?: string }
  },
  onUpdateStatus(listener) {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      if (isDesktopUpdateSnapshot(value)) listener(value)
    }
    ipcRenderer.on('desktop:update-state', handler)
    return () => { ipcRenderer.off('desktop:update-state', handler) }
  },
  async showWorkbenchBrowser(bounds) {
    if (!isDesktopBrowserBounds(bounds)) throw new Error('Invalid workbench Browser bounds.')
    const value: unknown = await ipcRenderer.invoke('desktop:workbench-browser-show', bounds)
    if (!isDesktopBrowserSnapshot(value)) throw new Error('Invalid workbench Browser state.')
    return value
  },
  async hideWorkbenchBrowser() {
    await ipcRenderer.invoke('desktop:workbench-browser-hide')
  },
  async controlWorkbenchBrowser(request) {
    if (!isDesktopBrowserRequest(request)) throw new Error('Invalid workbench Browser request.')
    const value: unknown = await ipcRenderer.invoke('desktop:workbench-browser-control', request)
    if (!isDesktopBrowserSnapshot(value)) throw new Error('Invalid workbench Browser state.')
    return value
  },
  onWorkbenchBrowserState(listener) {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      if (isDesktopBrowserSnapshot(value)) listener(value)
    }
    ipcRenderer.on('desktop:workbench-browser-state', handler)
    return () => { ipcRenderer.off('desktop:workbench-browser-state', handler) }
  },
}

contextBridge.exposeInMainWorld('dshDesktop', api)
