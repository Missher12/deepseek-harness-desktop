/** Optional current-base startup observations; each sample includes the shared real first-run and restart checks. */
import { readFileSync } from 'node:fs'
import { readFile, realpath, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { describe, it } from 'vitest'
import { assertPortableMacEvidence } from '../../../scripts/macos-desktop-runtime-evidence.ts'
import { decodeMacStartupFixtures, macPickerPolicyFromEnvironment, macBaseSmokeRequestFromEnvironment, runMacBaseCore, verifyMacBaseRun } from './macos-side-copy-native-adapter.ts'

const repositoryRoot = resolve(import.meta.dirname, '../../..')
const picker = macPickerPolicyFromEnvironment(process.env)
const manualWaitMs = picker.mode === 'manual' ? picker.timeoutMs : 0
const executable = process.env.DSH_MACOS_STARTUP_EXECUTABLE
const fixtureList = process.env.DSH_MACOS_STARTUP_FIXTURES
const requested = executable !== undefined || fixtureList !== undefined
if (requested && process.platform !== 'darwin') throw new Error('Requested Mac startup must run on macOS.')
const sourceManifest: unknown = JSON.parse(readFileSync(join(repositoryRoot, 'apps/desktop/package.json'), 'utf8'))
if (typeof sourceManifest !== 'object' || sourceManifest === null || !('version' in sourceManifest) || typeof sourceManifest.version !== 'string') {
  throw new Error('Mac startup requires the source manifest version.')
}
const desktopVersion = sourceManifest.version

describe('macOS packaged base startup and restart observations', () => {
  it.skipIf(process.platform !== 'darwin' || !requested)('uses distinct old-reader fixtures and verifies scoped core evidence', async () => {
    if (executable === undefined || fixtureList === undefined) throw new Error('Mac startup requires its executable and fixture list.')
    const application = resolve(dirname(await realpath(executable)), '../..')
    const request = macBaseSmokeRequestFromEnvironment(process.env, application, desktopVersion)
    if (request === undefined) throw new Error('Mac startup requires bound descriptor, source and ASAR inputs.')
    const fixtures = decodeMacStartupFixtures(JSON.parse(await readFile(fixtureList, 'utf8')) as unknown)
    const repetitions = process.env.DSH_MACOS_STARTUP_REPETITIONS
    if (repetitions !== undefined && repetitions !== String(fixtures.length)) throw new Error('Startup repetition count differs from its explicit fixtures.')
    const physicalRoots = await Promise.all(fixtures.map(fixture => realpath(fixture.smokeRoot)))
    if (new Set(physicalRoots).size !== fixtures.length) throw new Error('Startup fixture aliases resolve to the same physical root.')
    for (const [index, fixture] of fixtures.entries()) {
      const started = performance.now()
      const run = await runMacBaseCore(request, { ...fixture, picker })
      const evidence = await verifyMacBaseRun(run)
      const sample = { schema: 1, kind: 'base-lifecycle-observation', index: index + 1,
        elapsedMs: Math.round(performance.now() - started), evidence }
      assertPortableMacEvidence(sample)
      await writeFile(join(run.smokeRoot, 'native-startup-evidence.json'), `${JSON.stringify(sample, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
    }
  }, 3_600_000 + 10 * manualWaitMs)
})
