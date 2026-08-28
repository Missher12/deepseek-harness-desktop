/** Import the built Desktop main from its staged dependency tree without launching Electron or Harness. */

import { mkdtemp, rm } from 'node:fs/promises'
import { register } from 'node:module'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const stageArgument = process.argv[2]
if (stageArgument === undefined || !isAbsolute(stageArgument)) {
  throw new Error('Desktop stage import smoke requires one absolute stage directory.')
}

const stageDir = resolve(stageArgument)
const isolatedHome = await mkdtemp(join(tmpdir(), 'dsh-desktop-stage-import-'))
process.env.DSH_HOME = join(isolatedHome, 'dsh-home')
process.env.DSH_DESKTOP_STAGE_SMOKE_USER_DATA = join(isolatedHome, 'user-data')

register(new URL('./desktop-stage-electron-loader.mjs', import.meta.url))

try {
  await import(pathToFileURL(join(stageDir, 'lib', 'main.js')).href)
  await new Promise(resolveTick => setImmediate(resolveTick))
  if (globalThis.__DSH_DESKTOP_STAGE_IMPORT_QUIT__ !== true) {
    throw new Error('Built Desktop main did not complete the isolated single-instance smoke path.')
  }
  process.stdout.write('verify-desktop-stage-main-import: built main imported from staged dependency tree.\n')
} finally {
  delete process.env.DSH_HOME
  delete process.env.DSH_DESKTOP_STAGE_SMOKE_USER_DATA
  await rm(isolatedHome, { recursive: true, force: true })
}
