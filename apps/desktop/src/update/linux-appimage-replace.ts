import { randomBytes } from 'node:crypto'
import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { mkdtemp, open, rm, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { LinuxInstallDescriptor } from './linux-installer.ts'
import { verifyLinuxUpdatePackage } from './linux-installer.ts'
import { inspectLinuxDirectory, inspectLinuxFile, linuxInstallationLock, parseLinuxFileIdentity, readLinuxUpdateRecord, sameLinuxFile, writeLinuxUpdateRecord } from './linux-update-protocol.ts'
import type { LinuxAppImagePlan, LinuxFileIdentity, LinuxRenameNoReplace } from './linux-update-protocol.ts'

interface ReplacementState { phase: 'prepared' | 'committing' | 'replaced' | 'restoring' | 'cancelled' | 'rolled-back'; installed: LinuxFileIdentity | null }

async function assertParent(plan: LinuxAppImagePlan): Promise<void> {
  const parent = await inspectLinuxDirectory(dirname(plan.targetPath))
  if (parent.dev !== plan.parentDirectory.dev || parent.ino !== plan.parentDirectory.ino) throw new Error('Linux installation directory changed')
  await inspectLinuxDirectory(plan.transactionDirectory)
}

async function assertLock(plan: LinuxAppImagePlan): Promise<void> {
  await assertParent(plan)
  const value = await readLinuxUpdateRecord(plan.lockPath)
  if (typeof value !== 'object' || value === null || !('id' in value) || value.id !== plan.id
    || !('nonce' in value) || value.nonce !== plan.nonce) throw new Error('Linux update lock changed')
}

async function saveState(plan: LinuxAppImagePlan, state: ReplacementState): Promise<void> {
  await writeLinuxUpdateRecord(join(plan.transactionDirectory, 'state.json'), { id: plan.id, nonce: plan.nonce, ...state })
}

async function readState(plan: LinuxAppImagePlan): Promise<ReplacementState> {
  const value = await readLinuxUpdateRecord(join(plan.transactionDirectory, 'state.json'))
  if (typeof value !== 'object' || value === null || !('id' in value) || value.id !== plan.id
    || !('nonce' in value) || value.nonce !== plan.nonce || !('phase' in value)
    || !['prepared', 'committing', 'replaced', 'restoring', 'cancelled', 'rolled-back'].includes(String(value.phase))
    || !('installed' in value)) throw new Error('Invalid Linux replacement state')
  return { phase: value.phase as ReplacementState['phase'], installed: value.installed === null ? null : parseLinuxFileIdentity(value.installed) }
}

async function syncDirectory(path: string): Promise<void> {
  const directory = await open(path, constants.O_RDONLY)
  try { await directory.sync() } finally { await directory.close() }
}

/**
 * Copy through owned file handles, preserve source bytes and verify the synchronized copy.
 * @param source - Canonical verified source.
 * @param destination - Absent path in the owned transaction directory.
 * @param expected - Full source identity captured by the caller.
 * @param allowRootOwned - Permit a root-owned packaged runtime source.
 * @returns Identity of the synchronized private copy.
 */
export async function copyLinuxUpdateFile(
  source: string,
  destination: string,
  expected: LinuxFileIdentity,
  allowRootOwned = false,
): Promise<LinuxFileIdentity> {
  if (!sameLinuxFile(await inspectLinuxFile(source, 2_000_000_000, allowRootOwned), expected)) throw new Error('Linux update source changed')
  const input = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const output = await open(destination, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, expected.mode)
    try {
      const buffer = Buffer.alloc(1024 * 1024)
      let copied = 0
      while (copied < expected.bytes) {
        const result = await input.read(buffer, 0, Math.min(buffer.length, expected.bytes - copied), null)
        if (result.bytesRead === 0) throw new Error('Linux update source shortened')
        let written = 0
        while (written < result.bytesRead) {
          const resultWrite = await output.write(buffer, written, result.bytesRead - written, null)
          if (resultWrite.bytesWritten === 0) throw new Error('Linux update copy made no progress')
          written += resultWrite.bytesWritten
        }
        copied += result.bytesRead
      }
      await output.sync()
    } finally { await output.close() }
  } finally { await input.close() }
  if (!sameLinuxFile(await inspectLinuxFile(source, 2_000_000_000, allowRootOwned), expected)) throw new Error('Linux update source changed')
  const copied = await inspectLinuxFile(destination)
  if (copied.sha256 !== expected.sha256 || copied.bytes !== expected.bytes) throw new Error('Linux update copy failed verification')
  return copied
}

/**
 * Prepare beside a user-owned AppImage, retaining the old image and serializing that installation.
 * @param download - Main-owned validated download descriptor.
 * @param targetPath - Canonical user-owned installation file.
 * @returns Prepared plan with retained old and candidate bytes.
 */
export async function prepareAppImageReplacement(download: LinuxInstallDescriptor, targetPath: string): Promise<LinuxAppImagePlan> {
  if (download.packageFormat !== 'appimage') throw new Error('Expected AppImage update')
  const parentDirectory = await inspectLinuxDirectory(dirname(targetPath))
  const original = await inspectLinuxFile(targetPath)
  if ((original.mode & 0o100) === 0) throw new Error('Installed AppImage is not executable')
  const verified = await verifyLinuxUpdatePackage(download)
  if (verified.path === targetPath) throw new Error('Download cannot replace itself')
  const lockPath = linuxInstallationLock(targetPath), id = randomBytes(16).toString('hex'), nonce = randomBytes(32).toString('hex')
  let lock
  try { lock = await open(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600) }
  catch (error) { throw new Error('Another Linux update owns the installation or its lock is unavailable', { cause: error }) }
  let transactionDirectory: string | undefined
  const createdLock = await lock.stat({ bigint: true })
  try {
    await lock.writeFile(JSON.stringify({ id, nonce }) + '\n'); await lock.sync(); await lock.close()
    transactionDirectory = await mkdtemp(join(dirname(targetPath), '.dsh-update-'))
    const backupPath = join(transactionDirectory, 'previous.AppImage'), candidatePath = join(transactionDirectory, 'next.AppImage')
    await copyLinuxUpdateFile(targetPath, backupPath, original)
    const source = await inspectLinuxFile(verified.path)
    if (source.sha256 !== download.sha256 || source.bytes !== download.bytes) throw new Error('Verified download changed')
    await copyLinuxUpdateFile(verified.path, candidatePath, source)
    const candidateHandle = await open(candidatePath, constants.O_RDONLY | constants.O_NOFOLLOW)
    try { await candidateHandle.chmod(original.mode); await candidateHandle.sync() } finally { await candidateHandle.close() }
    const candidate = await inspectLinuxFile(candidatePath)
    if (!sameLinuxFile(await inspectLinuxFile(targetPath), original)) throw new Error('Installed AppImage changed')
    const plan: LinuxAppImagePlan = {
      schema: 1, id, nonce, targetPath, transactionDirectory, lockPath, backupPath,
      candidatePath, original, candidate, parentDirectory, targetVersion: download.desktopVersion,
    }
    await assertLock(plan)
    await writeLinuxUpdateRecord(join(transactionDirectory, 'plan.json'), plan)
    await saveState(plan, { phase: 'prepared', installed: null })
    return plan
  } catch (error) {
    await lock.close()
    // This preparation created the lock and private directory; no target mutation occurred.
    if (transactionDirectory !== undefined) await rm(transactionDirectory, { recursive: true, force: true })
    const currentLock = await optionalIdentity(lockPath)
    if (currentLock?.dev === String(createdLock.dev) && currentLock.ino === String(createdLock.ino)) {
      const content = await readLinuxUpdateRecord(lockPath)
      if (typeof content === 'object' && content !== null && 'id' in content && content.id === id && 'nonce' in content && content.nonce === nonce) await unlink(lockPath)
    }
    throw error
  }
}

/**
 * Native no-clobber move. The fixed isolated Python bridge uses libc, never a shell or user program.
 * @param source - Existing source on the same filesystem as the destination.
 * @param target - Destination that must remain absent.
 * @returns Resolves after native RENAME_NOREPLACE; errors retain files for inspection.
 */
export async function renameLinuxNoReplace(source: string, target: string): Promise<void> {
  if (process.platform !== 'linux') throw new Error('Native Linux renameat2 is required')
  await new Promise<void>((resolve, reject) => {
    execFile('/usr/bin/python3', ['-I', '-S', '-c',
      'import ctypes,os,sys; c=ctypes.CDLL(None,use_errno=True); f=c.renameat2; f.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_int,ctypes.c_char_p,ctypes.c_uint]; r=f(-100,os.fsencode(sys.argv[1]),-100,os.fsencode(sys.argv[2]),1); e=ctypes.get_errno(); sys.stderr.write(str(e) if r!=0 else \'\'); sys.exit(0 if r==0 else 1)', source, target],
    { shell: false, timeout: 5000, maxBuffer: 4096, env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' } }, (error, _stdout, stderr) => {
      if (error === null) resolve()
      else reject(new Error(`Native no-clobber move failed (errno=${/^[0-9]+$/.test(stderr) ? stderr : 'unavailable'}); source and destination require inspection`, { cause: error }))
    })
  })
}

/**
 * Verify no-clobber behavior on the installation filesystem using only private disposable files.
 * @param directory - Canonical user-owned installation parent.
 * @returns Resolves only when private filesystem probes preserve an occupied destination.
 */
export async function probeLinuxNoReplace(directory: string): Promise<void> {
  await inspectLinuxDirectory(directory)
  const probe = await mkdtemp(join(directory, '.dsh-rename-probe-'))
  try {
    const source = join(probe, 'source'), destination = join(probe, 'destination')
    await writeFile(source, 'source', { flag: 'wx', mode: 0o600 })
    await writeFile(destination, 'destination', { flag: 'wx', mode: 0o600 })
    const original = await inspectLinuxFile(source), existing = await inspectLinuxFile(destination)
    let refused = false
    try { await renameLinuxNoReplace(source, destination) }
    catch { refused = true /* Availability is checked by the succeeding absent-destination move below. */ }
    if (!refused || !sameLinuxFile(await inspectLinuxFile(source), original) || !sameLinuxFile(await inspectLinuxFile(destination), existing)) throw new Error('Filesystem did not preserve an occupied destination')
    await renameLinuxNoReplace(source, join(probe, 'moved'))
    if (!retainedIdentity(await inspectLinuxFile(join(probe, 'moved')), original)) throw new Error('Filesystem no-clobber move changed the source')
  } finally { await rm(probe, { recursive: true, force: true }) }
}

function retainedIdentity(current: LinuxFileIdentity, expected: LinuxFileIdentity): boolean {
  // An owned rename updates ctime; inode, bytes, mtime and permissions must still match.
  return current.dev === expected.dev && current.ino === expected.ino && current.sha256 === expected.sha256
    && current.bytes === expected.bytes && current.mtimeNs === expected.mtimeNs && current.mode === expected.mode
}

async function optionalIdentity(path: string): Promise<LinuxFileIdentity | undefined> {
  try { return await inspectLinuxFile(path) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
}

async function releaseLock(plan: LinuxAppImagePlan): Promise<void> {
  await assertLock(plan); await unlink(plan.lockPath); await syncDirectory(dirname(plan.targetPath))
}

/**
 * Retain the actual displaced inode and never overwrite a destination recreated by another actor.
 * @param plan - Prepared transaction with its original lock.
 * @param move - Native no-clobber primitive; fixtures may supply an offline equivalent.
 * @returns Resolves after replacement and journal persistence; interruption requires recovery.
 */
export async function commitAppImageReplacement(plan: LinuxAppImagePlan, move: LinuxRenameNoReplace = renameLinuxNoReplace): Promise<void> {
  await assertLock(plan)
  if ((await readState(plan)).phase !== 'prepared') throw new Error('Linux update is not prepared')
  if (!sameLinuxFile(await inspectLinuxFile(plan.targetPath), plan.original)) throw new Error('Installed AppImage changed')
  if (!sameLinuxFile(await inspectLinuxFile(plan.candidatePath), plan.candidate)) throw new Error('Prepared AppImage changed')
  const backup = await inspectLinuxFile(plan.backupPath)
  if (backup.sha256 !== plan.original.sha256 || backup.bytes !== plan.original.bytes) throw new Error('AppImage backup changed')
  await saveState(plan, { phase: 'committing', installed: null })
  await assertLock(plan)
  const displaced = join(plan.transactionDirectory, 'displaced.AppImage')
  await move(plan.targetPath, displaced)
  await syncDirectory(dirname(plan.targetPath)); await syncDirectory(plan.transactionDirectory)
  if (!retainedIdentity(await inspectLinuxFile(displaced), plan.original)) {
    // Restore only into an absent slot. If another installation appeared, preserve both files for recovery.
    try { await move(displaced, plan.targetPath) }
    catch { /* The no-clobber move preserves an occupied destination and the displaced file. */ }
    throw new Error('Installed AppImage changed at displacement; external bytes were retained')
  }
  await assertLock(plan)
  await move(plan.candidatePath, plan.targetPath)
  await syncDirectory(dirname(plan.targetPath)); await syncDirectory(plan.transactionDirectory)
  const installed = await inspectLinuxFile(plan.targetPath)
  if (!retainedIdentity(installed, plan.candidate)) throw new Error('Replaced AppImage changed')
  await saveState(plan, { phase: 'replaced', installed })
}

/**
 * Cancel only before displacement; keep retained bytes and release the exact transaction lock.
 * @param plan - Transaction still before displacement.
 * @returns Resolves after releasing the matching lock without changing the installation.
 */
export async function cancelAppImageReplacement(plan: LinuxAppImagePlan): Promise<void> {
  await assertLock(plan)
  const state = await readState(plan)
  if (state.phase !== 'prepared' && state.phase !== 'cancelled') throw new Error('Linux update has passed its cancellation point')
  await saveState(plan, { phase: 'cancelled', installed: null })
  await releaseLock(plan)
}

/**
 * Release the lock only after the shared coordinator accepts a new-process receipt.
 * @param plan - Replaced transaction whose restarted app was accepted by the shared owner.
 * @returns Resolves after identity verification and lock release.
 */
export async function finishAppImageReplacement(plan: LinuxAppImagePlan): Promise<void> {
  await assertLock(plan)
  const state = await readState(plan)
  if (state.phase !== 'replaced' || state.installed === null || !sameLinuxFile(await inspectLinuxFile(plan.targetPath), state.installed)) throw new Error('Installed AppImage changed before acknowledgement')
  await releaseLock(plan)
}

/**
 * Resume journaled moves without clobbering external files or guessing data downgrade compatibility.
 * @param plan - Retained transaction selected by the shared owner.
 * @param dataRollbackPermitted - Shared permission to restore old code after candidate installation.
 * @param move - Native no-clobber primitive; fixtures may supply an offline equivalent.
 * @returns Resolves after safe cancellation or restoration; unknown or changed files remain retained.
 */
export async function recoverAppImageReplacement(
  plan: LinuxAppImagePlan,
  dataRollbackPermitted: boolean,
  move: LinuxRenameNoReplace = renameLinuxNoReplace,
): Promise<void> {
  await assertLock(plan)
  const state = await readState(plan)
  let current = await optionalIdentity(plan.targetPath)
  const displacedPath = join(plan.transactionDirectory, 'displaced.AppImage')
  const displaced = await optionalIdentity(displacedPath)
  if (state.phase === 'prepared') { await cancelAppImageReplacement(plan); return }
  if (state.phase === 'cancelled') { await releaseLock(plan); return }
  if (state.phase === 'rolled-back') {
    if (current === undefined || state.installed === null || !sameLinuxFile(current, state.installed)) throw new Error('Recovered AppImage changed')
    await releaseLock(plan); return
  }
  if (state.phase === 'committing' && current !== undefined && sameLinuxFile(current, plan.original) && displaced === undefined) {
    await saveState(plan, { phase: 'cancelled', installed: null }); await releaseLock(plan); return
  }
  if ((state.phase === 'committing' || state.phase === 'restoring' && state.installed === null) && current === undefined && displaced !== undefined && retainedIdentity(displaced, plan.original)) {
    await saveState(plan, { phase: 'restoring', installed: null })
    await move(displacedPath, plan.targetPath)
    await syncDirectory(dirname(plan.targetPath))
    await saveState(plan, { phase: 'rolled-back', installed: await inspectLinuxFile(plan.targetPath) })
    await releaseLock(plan); return
  }
  // Finish a recovery interrupted after restoration but before recording its terminal phase.
  if (state.phase === 'restoring' && current !== undefined && retainedIdentity(current, plan.original)) {
    await syncDirectory(dirname(plan.targetPath)); await syncDirectory(plan.transactionDirectory)
    await saveState(plan, { phase: 'rolled-back', installed: current }); await releaseLock(plan); return
  }
  if (!dataRollbackPermitted) throw new Error('Shared data compatibility must permit rollback')
  if (!['replaced', 'committing', 'restoring'].includes(state.phase)) throw new Error('Linux update does not require replacement recovery')
  const expectedInstalled = state.installed ?? plan.candidate
  if (state.phase !== 'restoring') {
    if (current === undefined || !retainedIdentity(current, expectedInstalled)) throw new Error('Installed AppImage changed; recovery refused')
    await saveState(plan, { phase: 'restoring', installed: current })
  }
  if (displaced === undefined || !retainedIdentity(displaced, plan.original)) throw new Error('Displaced original AppImage changed')
  const failedPath = join(plan.transactionDirectory, 'replaced.AppImage')
  let failed = await optionalIdentity(failedPath)
  if (failed === undefined) {
    if (current === undefined || !retainedIdentity(current, expectedInstalled)) throw new Error('Installed AppImage changed during recovery')
    await move(plan.targetPath, failedPath)
    failed = await inspectLinuxFile(failedPath)
    if (!retainedIdentity(failed, expectedInstalled)) {
      try { await move(failedPath, plan.targetPath) }
      catch { /* Preserve both externally changed entries if the target was recreated. */ }
      throw new Error('Installed AppImage changed during displacement; external bytes retained')
    }
  } else if (!retainedIdentity(failed, expectedInstalled)) throw new Error('Recovery candidate changed')
  current = await optionalIdentity(plan.targetPath)
  if (current !== undefined) throw new Error('Installation slot changed during recovery; no file overwritten')
  await move(displacedPath, plan.targetPath)
  await syncDirectory(dirname(plan.targetPath)); await syncDirectory(plan.transactionDirectory)
  await saveState(plan, { phase: 'rolled-back', installed: await inspectLinuxFile(plan.targetPath) })
  await releaseLock(plan)
}
