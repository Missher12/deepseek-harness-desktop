import type { MenuItemConstructorOptions } from 'electron'
import type { DesktopCommand } from '../preload-api.ts'

/**
 * Build the native application menu for macOS or Windows.
 * @param appName - Display name registered by Electron.
 * @param sendCommand - Narrow bridge to the focused Harness renderer.
 * @param platform - Node platform identifier for native menu conventions.
 * @returns Native roles plus three product commands.
 */
export function createMenuTemplate(
  appName: string,
  sendCommand: (command: DesktopCommand) => void,
  platform: NodeJS.Platform = process.platform,
): MenuItemConstructorOptions[] {
  const applicationMenu: MenuItemConstructorOptions = {
    label: appName,
    submenu: [
      { role: 'about' },
      { type: 'separator' },
      {
        label: 'Settings…',
        accelerator: 'CmdOrCtrl+,',
        click: () => { sendCommand('open-settings') },
      },
      { type: 'separator' },
      { role: 'services' },
      { type: 'separator' },
      { role: 'hide' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      { type: 'separator' },
      { role: 'quit' },
    ],
  }
  const fileMenu: MenuItemConstructorOptions = {
    label: 'File',
    submenu: [
      {
        label: 'New Session',
        accelerator: 'CmdOrCtrl+N',
        click: () => { sendCommand('new-session') },
      },
      { type: 'separator' },
      ...(platform === 'darwin'
        ? [{ role: 'close' as const }]
        : [
          {
            label: 'Settings…',
            accelerator: 'CmdOrCtrl+,',
            click: () => { sendCommand('open-settings') },
          },
          { type: 'separator' as const },
          { role: 'quit' as const },
        ]),
    ],
  }
  const shared: MenuItemConstructorOptions[] = [
    fileMenu,
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Command Menu',
          accelerator: 'CmdOrCtrl+K',
          click: () => { sendCommand('open-command-menu') },
        },
        { type: 'separator' },
        { role: 'reload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
      ],
    },
  ]
  if (platform === 'darwin') return [applicationMenu, ...shared]
  return [
    ...shared,
    {
      label: 'Help',
      submenu: [{ role: 'about' }],
    },
  ]
}
