/** Own disposable Mac copies and evidence; foundation owns the actual updater and ready protocol. */
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { chmod, cp, lstat, mkdtemp, readFile, readdir, readlink, realpath, rename, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join, relative, sep } from 'node:path'
import {
  createMacosLegacyProfileFixture, snapshotMacosProtectedData, validateMacosSessionSeeds,
  type MacosLegacyProfileFixture, type MacosProtectedEntry, type MacosSessionSeed,
} from './macos-legacy-profile-fixture.ts'

/** Explicit immutable artifact identities supplied by the native acceptance owner. */
export interface MacosSideCopySources {
  readonly oldApp: string
  readonly oldAsarSha256: string
  readonly targetDmg: string
  readonly targetDmgSha256: string
  readonly finalSourceSha: string
  readonly evolutionPackage: string
  readonly evolutionArchive: string
  readonly evolutionArchiveSha256: string
  readonly sessionSeeds: readonly MacosSessionSeed[]
  /** Exact root-relative additions approved by the fixture owner; no wildcard or overwrite allowance. */
  readonly allowedNewProtectedPaths?: readonly string[]
}

/** Test-only adapter arguments, not a product wire or persisted ready protocol. */
export interface MacosSideCopyScope {
  readonly root: string
  readonly attemptId: string
  readonly currentApp: string
  readonly targetDmg: string
  readonly finalSourceSha: string
  readonly fixture: MacosLegacyProfileFixture
}

/**
 * Native operations remain explicit dependencies supplied by foundation.
 * Implementations must bound their waits; stopAndVerify must settle all owned work even after upgrade rejects.
 * verifyReady consumes the real foundation receipt and independently checks the running version and isolated paths.
 */
export interface MacosSideCopyAdapter {
  upgrade(scope: MacosSideCopyScope): Promise<void>
  verifyReady(scope: MacosSideCopyScope): Promise<void>
  stopAndVerify(scope: MacosSideCopyScope): Promise<void>
}

type Stage = 'upgrade' | 'ready' | 'cleanup' | 'preservation' | 'sources'

/** Local driver evidence; completing callbacks alone never certifies native acceptance. */
export interface MacosSideCopyResult {
  readonly outcome: 'adapter-completed' | 'failed'
  readonly nativeAcceptance: false
  readonly root: string
  readonly reportPath: string
  readonly attemptId: string
  readonly finalSourceSha: string
  readonly protectedDataUnchanged: boolean
  readonly failures: readonly { stage: Stage; message: string }[]
}

function inside(root: string, path: string): boolean {
  const local = relative(root, path)
  return local !== '' && local !== '..' && !local.startsWith(`..${sep}`) && !isAbsolute(local)
}

async function hashFile(path: string): Promise<string> {
  const stat = await lstat(path)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Artifact must be a regular file.')
  const hash = createHash('sha256')
  for await (const value of createReadStream(path)) {
    const chunk: unknown = value
    if (!Buffer.isBuffer(chunk)) throw new Error('Artifact stream returned non-binary content.')
    hash.update(chunk)
  }
  return hash.digest('hex')
}

async function assertHash(path: string, expected: string): Promise<void> {
  if (!/^[0-9a-f]{64}$/u.test(expected) || await hashFile(path) !== expected) {
    throw new Error('Artifact SHA-256 mismatch.')
  }
}

async function sourcePath(path: string): Promise<string> {
  if (!isAbsolute(path) || path.includes('\0')) throw new Error('Source must be an absolute artifact path.')
  const physical = await realpath(path)
  if (physical === '/Applications' || physical.startsWith('/Applications/')) {
    throw new Error('Daily applications cannot be source artifacts.')
  }
  return physical
}

async function assertConfinedTree(root: string): Promise<void> {
  if (!(await lstat(root)).isDirectory()) throw new Error('Bundle source must be a directory.')
  async function visit(path: string): Promise<void> {
    const stat = await lstat(path)
    if (stat.isSymbolicLink()) {
      const target = await realpath(path)
      if (!inside(root, target)) throw new Error('Bundle link resolves outside source tree.')
      if (isAbsolute(await readlink(path))) throw new Error('Copy cannot retain an absolute bundle link.')
    } else if (stat.isDirectory()) {
      for (const name of await readdir(path)) await visit(join(path, name))
    } else if (!stat.isFile()) throw new Error('Bundle source contains a special file.')
  }
  for (const name of await readdir(root)) await visit(join(root, name))
}

/**
 * Copy verified artifacts, seed synthetic data, run explicit adapters and preserve an evidence report.
 * @param input - Artifact paths/hashes and synthetic Session bytes; no defaults read the user's home.
 * @param adapter - Foundation-owned native calls, or an explicitly offline test implementation.
 * @returns Driver result after cleanup and independent data checks; the private root is retained for inspection.
 */
export async function runMacosSideCopyUpdate(
  input: MacosSideCopySources, adapter: MacosSideCopyAdapter,
): Promise<MacosSideCopyResult> {
  validateMacosSessionSeeds(input.sessionSeeds)
  const allowedAdditions = new Set(input.allowedNewProtectedPaths ?? [])
  for (const path of allowedAdditions) {
    if (!path.startsWith('home/') || path.includes('\\') || path.includes('\0')
      || path.split('/').some(part => part === '' || part === '.' || part === '..')) {
      throw new Error('Allowed additions must be exact private root-relative paths.')
    }
  }
  if (!/^[0-9a-f]{40}$/u.test(input.finalSourceSha)) throw new Error('Final source SHA must be complete.')
  const oldApp = await sourcePath(input.oldApp)
  if (basename(oldApp) !== 'DeepSeek Harness.app') throw new Error('Old app must use the expected bundle name.')
  const targetDmg = await sourcePath(input.targetDmg)
  const evolutionPackage = await sourcePath(input.evolutionPackage)
  const evolutionArchive = await sourcePath(input.evolutionArchive)
  await assertConfinedTree(oldApp)
  await assertConfinedTree(evolutionPackage)
  const oldAsar = join(oldApp, 'Contents/Resources/app.asar')
  await assertHash(oldAsar, input.oldAsarSha256)
  await assertHash(targetDmg, input.targetDmgSha256)
  await assertHash(evolutionArchive, input.evolutionArchiveSha256)
  const manifest: unknown = JSON.parse(await readFile(join(evolutionPackage, 'package.json'), 'utf8'))
  if (typeof manifest !== 'object' || manifest === null
    || !('name' in manifest) || manifest.name !== 'dsh-missher-evolution'
    || !('version' in manifest) || manifest.version !== '0.7.0') {
    throw new Error('Legacy fixture requires the explicit Evolution 0.7.0 package.')
  }
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-macos-side-copy-')))
  await chmod(root, 0o700)
  const rootIdentity = await lstat(root)
  const currentApp = join(root, 'DeepSeek Harness.app')
  const copiedDmg = join(root, 'candidate.dmg')
  const copiedEvolution = join(root, 'evolution-package')
  await cp(oldApp, currentApp, { recursive: true, dereference: false, verbatimSymlinks: true, errorOnExist: true, force: false })
  await cp(targetDmg, copiedDmg, { errorOnExist: true, force: false })
  await cp(evolutionPackage, copiedEvolution, {
    recursive: true, dereference: false, verbatimSymlinks: true, errorOnExist: true, force: false,
  })
  await cp(evolutionArchive, join(root, 'evolution.tgz'), { errorOnExist: true, force: false })
  await assertHash(join(currentApp, 'Contents/Resources/app.asar'), input.oldAsarSha256)
  await assertHash(copiedDmg, input.targetDmgSha256)
  await assertHash(join(root, 'evolution.tgz'), input.evolutionArchiveSha256)
  const fixture = await createMacosLegacyProfileFixture(root, currentApp, copiedEvolution, input.sessionSeeds)
  const before = await snapshotMacosProtectedData(root, fixture.protectedRoots)
  const scope: MacosSideCopyScope = Object.freeze({ root, currentApp, targetDmg: copiedDmg,
    finalSourceSha: input.finalSourceSha, attemptId: randomUUID(), fixture: Object.freeze(fixture) })
  const failures: { stage: Stage; message: string }[] = []
  const record = (stage: Stage, error: unknown): void => {
    failures.push({ stage, message: error instanceof Error ? error.message : String(error) })
  }
  let stage: Stage = 'upgrade'
  try {
    await adapter.upgrade(scope)
    stage = 'ready'
    await adapter.verifyReady(scope)
  } catch (error) { record(stage, error) } finally {
    try { await adapter.stopAndVerify(scope) } catch (error) { record('cleanup', error) }
  }
  const currentRoot = await lstat(root)
  if (!currentRoot.isDirectory() || currentRoot.isSymbolicLink() || await realpath(root) !== root
    || currentRoot.ino !== rootIdentity.ino || currentRoot.dev !== rootIdentity.dev) {
    throw new Error('Private run root changed; no evidence is written through the replacement.')
  }
  let after: MacosProtectedEntry[] | undefined
  let protectedDataUnchanged = false
  let addedProtectedPaths: string[] = []
  try {
    after = await snapshotMacosProtectedData(root, fixture.protectedRoots)
    const prior = new Map(before.map(entry => [entry.path, entry]))
    const current = new Map(after.map(entry => [entry.path, entry]))
    addedProtectedPaths = after.filter(entry => !prior.has(entry.path)).map(entry => entry.path)
    protectedDataUnchanged = before.every(entry => JSON.stringify(entry) === JSON.stringify(current.get(entry.path)))
      && addedProtectedPaths.every(path => allowedAdditions.has(path))
    if (!protectedDataUnchanged) throw new Error('Protected synthetic data changed.')
  } catch (error) { record('preservation', error) }
  try {
    await assertHash(oldAsar, input.oldAsarSha256)
    await assertHash(targetDmg, input.targetDmgSha256)
    await assertHash(evolutionArchive, input.evolutionArchiveSha256)
  } catch (error) { record('sources', error) }
  const reportPath = join(root, 'side-copy-result.json')
  const result: MacosSideCopyResult = {
    outcome: failures.length === 0 ? 'adapter-completed' : 'failed', nativeAcceptance: false,
    root, reportPath, attemptId: scope.attemptId, finalSourceSha: input.finalSourceSha,
    protectedDataUnchanged, failures,
  }
  const temporary = join(root, 'side-copy-result.pending.json')
  await writeFile(temporary, JSON.stringify({ ...result, sources: {
    oldAsarSha256: input.oldAsarSha256, targetDmgSha256: input.targetDmgSha256,
    evolutionArchiveSha256: input.evolutionArchiveSha256,
  }, allowedNewProtectedPaths: [...allowedAdditions], addedProtectedPaths, before, after }, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  await rename(temporary, reportPath)
  return result
}
