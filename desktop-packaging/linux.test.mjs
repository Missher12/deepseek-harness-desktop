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
