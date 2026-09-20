/** Linux installers carrying the official prepared Desktop shell and complete runtime. */
import { join, resolve } from 'node:path'
import { desktopTargetBuildPaths } from '../apps/desktop/scripts/desktop-build-paths.mjs'

const appRoot = resolve(import.meta.dirname, '../apps/desktop')
const paths = desktopTargetBuildPaths('linux-x64')
const appId = 'com.deepseek.harness'

export default {
  appId,
  extraMetadata: { dshDesktopAppId: appId, homepage: 'https://github.com/Missher12/deepseek-harness-desktop' },
  productName: 'DeepSeek Harness',
  artifactName: 'deepseek-harness-${version}-linux-x64.${ext}',
  directories: { app: appRoot, output: paths.artifacts },
  asar: true,
  electronDist: paths.electron,
  electronFuses: { runAsNode: true },
  files: [
    'lib/main.js', 'lib/preload-app.cjs', 'lib/preload-mandatory.cjs', 'lib/preload-update-dialog.cjs',
    'renderer/**/*', 'package.json',
    { from: paths.dsh, to: 'dsh', filter: ['**/*'] },
    { from: join(paths.dsh, 'node_modules'), to: 'dsh/node_modules', filter: ['**/*'] },
  ],
  asarUnpack: ['**/*.{node,dylib,dll,so,exe}', '**/*.so.*', '**/spawn-helper', '**/@vscode/ripgrep/bin/rg'],
  extraResources: [
    { from: paths.runtime, to: 'runtime' },
    { from: join(import.meta.dirname, 'icon.png'), to: 'icon.png' },
  ],
  linux: {
    executableName: 'deepseek-harness',
    icon: join(import.meta.dirname, 'icon.png'),
    category: 'Development',
    target: ['deb', 'AppImage'],
    maintainer: 'Missher12 <Missher12@users.noreply.github.com>',
  },
  deb: { packageName: 'deepseek-harness' },
  // The pinned builder otherwise injects --no-sandbox into the AppImage desktop entry.
  appImage: { executableArgs: [] },
  afterPack: async context => {
    const { verifyDesktopRuntime } = await import('../apps/desktop/lib/types/runtime-tree.js')
    await verifyDesktopRuntime(paths.dsh, context.packager.appInfo.version, { platform: 'linux', arch: 'x64' })
  },
  detectUpdateChannel: false,
  publish: null,
}
