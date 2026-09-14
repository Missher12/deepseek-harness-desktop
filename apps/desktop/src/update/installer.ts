/** Prepare and acknowledge an updater transaction before native main is allowed to quit. */
import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { chmodSync, lstatSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { assertPhysicalPath, assertPrivateDirectory, bytesSha256, exactRecord, publishPrivateRecord, readPhysicalFile, readPrivateRecord } from './restart-receipt.ts'
import { validateUpdateHelperConfig, verifyCopiedHelper, withinDeadline, type UpdateHelperConfig } from './update-helper.ts'

/** Native-owned inputs. The renderer supplies none of these paths or launch arguments. */
export interface DesktopInstallerLaunchOptions {
  helperSource: string
  helperNodePath: string
  helperSourceManifest: string
  currentAppPath: string
  dmgPath: string
  verifiedDownloadDirectory: string
  expectedDesktopVersion: string
  expectedHarnessVersion: string
  expectedSha256: string
  restart: { home: string; dshHome: string; userData: string }
  parentPid?: number
}
/** A helper PID is returned only after the copied Node and helper have acknowledged the transaction. */
export interface DesktopInstallerLaunchReceipt {
  pid: number
  attemptId: string
  transactionDirectory: string
  requestPath: string
}
/** Test substitutes do not run Node or perform installations. */
export interface DesktopInstallerDependencies {
  spawnHelper?: (executable: string, args: readonly string[], env: NodeJS.ProcessEnv) => ChildProcess
  handshakeTimeoutMs?: number
  signal?: AbortSignal
}
function verifySource(options: DesktopInstallerLaunchOptions): { node: Buffer; source: Buffer; license: Buffer; helper: Buffer } {
  const sourceDirectory = dirname(options.helperSourceManifest)
  if (basename(options.helperSourceManifest) !== 'source.json' || options.helperNodePath !== join(sourceDirectory, 'node')) {
    throw new Error('Unexpected helper runtime source filenames.')
  }
  assertPhysicalPath(sourceDirectory)
  if (readdirSync(sourceDirectory).sort().join(',') !== 'LICENSE,node,source.json') throw new Error('Helper source directory must contain exactly Node, LICENSE, and source.json.')
  const source = readPhysicalFile(options.helperSourceManifest, 1024 * 1024)
  const raw: unknown = JSON.parse(source.toString('utf8'))
  if (!exactRecord(raw, ['schema', 'platform', 'arch', 'nodeVersion', 'releaseUrl', 'archiveName', 'archiveSha256', 'shasumsSha256', 'inputKind', 'execution', 'files'])
    || raw.schema !== 1 || raw.platform !== 'darwin' || raw.arch !== 'x64' || raw.nodeVersion !== '24.17.0'
    || raw.releaseUrl !== 'https://nodejs.org/download/release/v24.17.0' || raw.archiveName !== 'node-v24.17.0-darwin-x64.tar.gz'
    || typeof raw.archiveSha256 !== 'string' || !/^[a-f\d]{64}$/u.test(raw.archiveSha256)
    || typeof raw.shasumsSha256 !== 'string' || !/^[a-f\d]{64}$/u.test(raw.shasumsSha256)
    || (raw.inputKind !== 'files' && raw.inputKind !== 'download')
    || raw.execution !== 'native-verified'
    || !Array.isArray(raw.files) || raw.files.length !== 2) throw new Error('Invalid standalone helper runtime provenance.')
  const node = readPhysicalFile(options.helperNodePath, 256 * 1024 * 1024)
  const license = readPhysicalFile(join(sourceDirectory, 'LICENSE'), 4 * 1024 * 1024)
  for (const [path, bytes] of [['node', node], ['LICENSE', license]] as const) {
    const matches = raw.files.filter((file: unknown) => exactRecord(file, ['path', 'bytes', 'sha256']) && file.path === path)
    const file: unknown = matches[0]
    if (matches.length !== 1 || !exactRecord(file, ['path', 'bytes', 'sha256']) || file.bytes !== bytes.length
      || file.sha256 !== bytesSha256(bytes)) throw new Error(`Standalone helper ${path} checksum mismatch.`)
  }
  // The fixed, native-owned helper module may be inside Electron's read-only app.asar virtual filesystem.
  if (basename(options.helperSource) !== 'update-helper.js' && basename(options.helperSource) !== 'update-helper.mjs') throw new Error('Unexpected bundled helper entrypoint.')
  const helperStat = lstatSync(options.helperSource)
  if (!helperStat.isFile() || helperStat.isSymbolicLink() || helperStat.size > 16 * 1024 * 1024) throw new Error('Invalid bundled helper module.')
  const helper = readFileSync(options.helperSource)
  if (helper.length !== helperStat.size) throw new Error('Bundled helper module changed while reading.')
  return { node, source, license, helper }
}
/** Copy verified standalone Node and bundled helper bytes to a random private transaction, then await helper readiness.
 * @param options Fixed paths and isolated native identity supplied by main.
 * @param dependencies Optional bounded process substitutes and cancellation for tests/native shutdown.
 * @returns Acknowledged transaction; the caller can now quit the old application.
 */
export async function launchDesktopInstaller(
  options: DesktopInstallerLaunchOptions, dependencies: DesktopInstallerDependencies = {},
): Promise<DesktopInstallerLaunchReceipt> {
  dependencies.signal?.throwIfAborted()
  const timeout = dependencies.handshakeTimeoutMs ?? 15_000
  if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 30_000) throw new Error('Invalid helper handshake deadline.')
  const directory = realpathSync(options.verifiedDownloadDirectory)
  assertPrivateDirectory(directory)
  const dmgPath = realpathSync(options.dmgPath)
  if (dirname(dmgPath) !== directory || options.dmgPath !== dmgPath) throw new Error('DMG escaped its verified download directory.')
  assertPhysicalPath(options.dmgPath)
  const bytes = verifySource(options)
  const transactionDirectory = mkdtempSync(join(directory, 'desktop-update-')); chmodSync(transactionDirectory, 0o700)
  const config: UpdateHelperConfig = {
    schema: 2, attemptId: randomBytes(16).toString('hex'), nonce: randomBytes(32).toString('hex'), transactionDirectory,
    parentPid: options.parentPid ?? process.pid, currentAppPath: realpathSync(options.currentAppPath), dmgPath,
    verifiedDownloadDirectory: directory, expectedDesktopVersion: options.expectedDesktopVersion,
    expectedHarnessVersion: options.expectedHarnessVersion, expectedSha256: options.expectedSha256, expectedBytes: lstatSync(dmgPath).size,
    restart: { home: realpathSync(options.restart.home), dshHome: realpathSync(options.restart.dshHome),
      userData: realpathSync(options.restart.userData) },
    files: { node: bytesSha256(bytes.node), helper: bytesSha256(bytes.helper),
      source: bytesSha256(bytes.source), license: bytesSha256(bytes.license) },
  }
  if (validateUpdateHelperConfig(config) === null) throw new Error('Unsafe native installer inputs.')
  for (const [name, contents, mode] of [['node', bytes.node, 0o700], ['LICENSE', bytes.license, 0o600],
    ['node-source.json', bytes.source, 0o600], ['update-helper.mjs', bytes.helper, 0o600]] as const) {
    writeFileSync(join(transactionDirectory, name), contents, { flag: 'wx', mode })
  }
  verifyCopiedHelper(config)
  const requestPath = publishPrivateRecord(transactionDirectory, 'helper-request.json', config)
  const requestSha256 = bytesSha256(readPhysicalFile(requestPath, 64 * 1024, true))
  let child: ChildProcess | undefined
  let firstError: Error | undefined
  const recordError = (error: Error) => { firstError ??= error }
  try {
    dependencies.signal?.throwIfAborted()
    const env = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: config.restart.home, DSH_HOME: config.restart.dshHome }
    child = dependencies.spawnHelper
      ? dependencies.spawnHelper(join(transactionDirectory, 'node'), [join(transactionDirectory, 'update-helper.mjs'), requestPath], env)
      : spawn(join(transactionDirectory, 'node'), [join(transactionDirectory, 'update-helper.mjs'), requestPath], { detached: true, shell: false, stdio: 'ignore', env })
    child.on('error', recordError)
    child.once('exit', (code, signal) => {
      recordError(new Error(`Update helper exited before acknowledgement (${String(code)}, ${String(signal)}).`))
    })
    const launched = child
    await withinDeadline((async () => {
      const deadline = Date.now() + timeout
      do {
        dependencies.signal?.throwIfAborted()
        if (firstError) throw firstError
        const ready = readPrivateRecord(transactionDirectory, 'helper-ready.json')
        if (ready !== undefined) {
          if (!exactRecord(ready, ['schema', 'attemptId', 'nonce', 'pid', 'nodeVersion', 'nodeSha256', 'helperSha256', 'requestSha256'])
            || ready.schema !== 1 || ready.attemptId !== config.attemptId || ready.nonce !== config.nonce
            || ready.pid !== launched.pid || !Number.isSafeInteger(ready.pid) || Number(ready.pid) <= 0
            || ready.requestSha256 !== requestSha256 || ready.nodeVersion !== '24.17.0' || ready.nodeSha256 !== config.files.node || ready.helperSha256 !== config.files.helper) {
            throw new Error('Independent helper acknowledgement identity or hash mismatch.')
          }
          verifyCopiedHelper(config)
          return
        }
        await new Promise(accept => setTimeout(accept, Math.min(50, timeout)))
      } while (Date.now() < deadline)
      throw new Error('Independent helper acknowledgement timed out.')
    })(), timeout, 'Independent helper acknowledgement', dependencies.signal)
    dependencies.signal?.throwIfAborted()
    if (firstError) throw firstError
    if (child.pid === undefined) throw new Error('Acknowledged helper PID disappeared.')
    publishPrivateRecord(transactionDirectory, 'handoff-approved.json', { schema: 1, attemptId: config.attemptId, nonce: config.nonce })
    child.unref()
    return { pid: child.pid, attemptId: config.attemptId, transactionDirectory, requestPath }
  } catch (error) {
    const failure = firstError ?? (error instanceof Error ? error : new Error(String(error)))
    try { publishPrivateRecord(transactionDirectory, 'cancel.json', { schema: 1, attemptId: config.attemptId, nonce: config.nonce }) }
    catch { /* An existing exclusive cancellation already forbids handoff; retain the first launch error. */ }
    // Approval was never published. Killing this owned helper cannot interrupt an application replacement.
    child?.kill('SIGTERM')
    throw failure
  }
}
