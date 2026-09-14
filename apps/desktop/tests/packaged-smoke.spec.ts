/** Explicit Mac core acceptance at both scales using one actual packaged executable. */
import { readFileSync } from 'node:fs'
import { readFile, realpath, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { describe, it } from 'vitest'
import { decodeMacStartupFixtures, macPickerPolicyFromEnvironment, macBaseSmokeRequestFromEnvironment, runMacBaseCore, verifyMacBaseRun } from './macos-side-copy-native-adapter.ts'

const repositoryRoot = resolve(import.meta.dirname, '../../..')
const picker = macPickerPolicyFromEnvironment(process.env)
const manualWaitMs = picker.mode === 'manual' ? picker.timeoutMs : 0
const explicitExecutable = process.env.DSH_MACOS_DESKTOP_EXECUTABLE
const application = explicitExecutable === undefined ? join(repositoryRoot, 'apps/desktop/release/mac/DeepSeek Harness.app')
  : resolve(dirname(explicitExecutable), '../..')
const manifest: unknown = JSON.parse(readFileSync(join(repositoryRoot, 'apps/desktop/package.json'), 'utf8'))
if (typeof manifest !== 'object' || manifest === null || !('version' in manifest) || typeof manifest.version !== 'string') {
  throw new Error('Mac native entry requires the source Desktop version.')
}
if (process.env.DSH_MACOS_REQUIRE_NATIVE === '1' && process.platform !== 'darwin') {
  throw new Error('Requested Mac native acceptance must run on macOS.')
}
const request = process.platform === 'darwin'
  ? macBaseSmokeRequestFromEnvironment(process.env, application, manifest.version) : undefined

describe('packaged DeepSeek Harness base on macOS', () => {
  it.skipIf(request === undefined)('verifies core lifecycle, historical UI and native folder selection at 100% and 150%', async () => {
    if (request === undefined) throw new Error('Explicit Mac native request is missing.')
    const fixtureList = process.env.DSH_MACOS_CORE_FIXTURES
    if (fixtureList === undefined) throw new Error('Mac core acceptance requires two prepared legacy fixtures.')
    const values: unknown = JSON.parse(await readFile(fixtureList, 'utf8'))
    if (!Array.isArray(values) || values.length !== 2) throw new Error('Mac core requires exactly two fixtures ordered 100%, 150%.')
    const fixtures = values.map(value => decodeMacStartupFixtures([value])[0]!)
    const roots = await Promise.all(fixtures.map(fixture => realpath(fixture.smokeRoot)))
    if (new Set(roots).size !== 2) throw new Error('Mac scales require distinct physical fixture roots.')
    let executableSha256: string | undefined
    for (const [index, scalePercent] of ([100, 150] as const).entries()) {
      const run = await runMacBaseCore(request, { ...fixtures[index]!, scalePercent, picker })
      if (explicitExecutable !== undefined && await realpath(explicitExecutable) !== run.inputs.executable) {
        throw new Error('Mac core invocation did not select the actual package executable.')
      }
      const evidence = await verifyMacBaseRun(run)
      if (Math.abs(evidence.rendererDevicePixelRatio - scalePercent / 100) > 0.001) throw new Error('Renderer scale differs from the requested scale.')
      if (executableSha256 !== undefined && evidence.executableSha256 !== executableSha256) throw new Error('Mac scales consumed different executable bytes.')
      executableSha256 = evidence.executableSha256
      await writeFile(join(run.smokeRoot, 'native-base-evidence.json'), `${JSON.stringify({ ...evidence, scalePercent }, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
    }
  }, 600_000 + 2 * manualWaitMs)
})
