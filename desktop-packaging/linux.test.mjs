/** Check the pinned builder's AppImage command without packaging or launching an application. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import config from './linux-electron-builder.config.mjs'

const require = createRequire(new URL('../apps/desktop/package.json', import.meta.url))
const { default: AppImageTarget } = require('app-builder-lib/out/targets/appimage/AppImageTarget.js')
const { validateConfiguration } = require('app-builder-lib/out/util/config/config.js')

test('Linux installer config retains sandboxing in the actual AppImage desktop command', async () => {
  await validateConfiguration(config)
  const packager = { platformSpecificBuildOptions: config.linux, config, appInfo: { buildVersion: '0.1.6-alpha.2' } }
  const helper = { computeDesktopEntry: (_options, command) => command }
  const target = new AppImageTarget('appImage', packager, helper, '/unused-test-output')
  assert.equal(await target.desktopEntry.value, 'AppRun %U')
  const baseline = new AppImageTarget('appImage', { ...packager, config: { ...config, appImage: undefined } }, helper, '/unused-test-output')
  assert.match(await baseline.desktopEntry.value, /--no-sandbox/u)
})

test('deb metadata satisfies FPM and both installer names retain the x64 delivery name', async () => {
  const { AppInfo } = require('app-builder-lib/out/appInfo.js')
  const { default: FpmTarget } = require('app-builder-lib/out/targets/FpmTarget.js')
  const { PlatformPackager } = require('app-builder-lib/out/platformPackager.js')
  const metadata = { name: '@deepseek-ai/dsh-desktop', version: '0.1.6-alpha.2', ...config.extraMetadata }
  const appInfo = { info: { metadata }, notNullDevMetadata: {}, linuxPackageName: 'deepseek-harness' }
  const packager = { appInfo: { ...appInfo, computePackageUrl: () => AppInfo.prototype.computePackageUrl.call(appInfo) },
    info: { metadata } }
  const meta = await FpmTarget.prototype.computeFpmMetaInfoOptions.call({ packager, options: { ...config.linux, ...config.deb } })
  assert.equal(meta.url, 'https://github.com/Missher12/deepseek-harness-desktop')
  assert.equal(meta.maintainer, config.linux.maintainer)
  const naming = { appInfo: metadata, platform: { buildConfigurationKey: 'linux' },
    expandMacro: PlatformPackager.prototype.expandMacro }
  for (const ext of ['deb', 'AppImage']) {
    assert.equal(PlatformPackager.prototype.computeArtifactName.call(naming, config.artifactName, ext, 1),
      `deepseek-harness-0.1.6-alpha.2-linux-x64.${ext}`)
  }
})
