import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  accessSync, constants, createReadStream, existsSync, lstatSync, readFileSync,
  renameSync, rmSync,
} from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { basename, dirname, join, posix, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'

const APP_NAME = 'DeepSeek Harness.app'
const BUNDLE_ID = 'ai.deepseek.harness.desktop'
const VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/

export interface UpdateHelperConfig {
  schema: 1
  parentPid: number
  currentAppPath: string
  dmgPath: string
  expectedDesktopVersion: string
  expectedHarnessVersion: string
  expectedSha256: string
}

export function validateUpdateHelperConfig(value: unknown): UpdateHelperConfig | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const config = value as Record<string, unknown>
  if (config.schema !== 1 || !Number.isSafeInteger(config.parentPid) || Number(config.parentPid) <= 0) return null
  // The helper installs a macOS bundle and DMG even when its contract is
  // inspected by cross-platform CI, so validate the wire paths with POSIX
  // semantics instead of silently inheriting the test host's path dialect.
  if (typeof config.currentAppPath !== 'string' || !posix.isAbsolute(config.currentAppPath)
    || posix.basename(config.currentAppPath) !== APP_NAME
    || posix.resolve(config.currentAppPath) !== config.currentAppPath) return null
  if (typeof config.dmgPath !== 'string' || !posix.isAbsolute(config.dmgPath)
    || posix.resolve(config.dmgPath) !== config.dmgPath
    || !/^DeepSeek-Harness-[0-9A-Za-z.-]+-mac-x64\.dmg$/.test(posix.basename(config.dmgPath))) return null
  if (typeof config.expectedDesktopVersion !== 'string' || !VERSION_RE.test(config.expectedDesktopVersion)) return null
  if (typeof config.expectedHarnessVersion !== 'string' || !VERSION_RE.test(config.expectedHarnessVersion)) return null
  if (typeof config.expectedSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(config.expectedSha256)) return null
  return config as unknown as UpdateHelperConfig
}

function run(command: string, args: readonly string[], timeout = 120_000): string {
  const result = spawnSync(command, [...args], {
    encoding: 'utf8',
    shell: false,
    timeout,
    env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' },
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`${basename(command)} failed with status ${String(result.status)}.`)
  return result.stdout.trim()
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(path)
    stream.on('data', (chunk) => { hash.update(chunk) })
    stream.on('error', reject)
    stream.on('end', resolvePromise)
  })
  return hash.digest('hex')
}

function plistValue(plist: string, key: string): string {
  return run('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', plist])
}

function verifyAppBundle(path: string, config: UpdateHelperConfig): void {
  const stat = lstatSync(path)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Update app bundle is not a physical directory.')
  const contents = join(path, 'Contents')
  const plist = join(contents, 'Info.plist')
  if (plistValue(plist, 'CFBundleIdentifier') !== BUNDLE_ID) throw new Error('Update bundle identifier mismatch.')
  if (plistValue(plist, 'CFBundleShortVersionString') !== config.expectedDesktopVersion) throw new Error('Update bundle version mismatch.')
  const executableName = plistValue(plist, 'CFBundleExecutable')
  if (!/^[A-Za-z0-9._ -]+$/.test(executableName)) throw new Error('Update executable name is invalid.')
  const architectures = run('/usr/bin/lipo', ['-archs', join(contents, 'MacOS', executableName)])
  if (!architectures.split(/\s+/).includes('x86_64')) throw new Error('Update executable is not Intel x86_64.')
  const metadata = JSON.parse(readFileSync(join(contents, 'Resources', 'update-metadata.json'), 'utf8')) as Record<string, unknown>
  if (metadata.schema !== 1
    || metadata.desktopVersion !== config.expectedDesktopVersion
    || metadata.harnessVersion !== config.expectedHarnessVersion
    || metadata.platform !== 'darwin'
    || metadata.arch !== 'x64') throw new Error('Packaged update metadata mismatch.')
}

async function waitForParent(pid: number): Promise<void> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try { process.kill(pid, 0) } catch { return }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 250))
  }
  throw new Error('Timed out waiting for the previous application process to exit.')
}

async function install(config: UpdateHelperConfig): Promise<void> {
  if (!existsSync(config.currentAppPath) || !existsSync(config.dmgPath)) throw new Error('Current app or verified DMG is missing.')
  if (await sha256File(config.dmgPath) !== config.expectedSha256) throw new Error('DMG checksum changed before installation.')
  await waitForParent(config.parentPid)
  const parent = dirname(config.currentAppPath)
  try { accessSync(parent, constants.W_OK) } catch {
    run('/usr/bin/open', [config.dmgPath], 30_000)
    return
  }

  const mountPoint = await mkdtemp(join(tmpdir(), 'dsh-update-mount-'))
  const candidate = join(mountPoint, APP_NAME)
  const stamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14)
  const staged = join(parent, `.DeepSeek Harness.update-${String(process.pid)}.app`)
  const backup = join(parent, `.DeepSeek Harness.backup-${stamp}.app`)
  let currentMoved = false
  try {
    run('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mountPoint, config.dmgPath])
    verifyAppBundle(candidate, config)
    rmSync(staged, { recursive: true, force: true })
    run('/usr/bin/ditto', ['--noqtn', candidate, staged], 10 * 60 * 1000)
    verifyAppBundle(staged, config)
    renameSync(config.currentAppPath, backup)
    currentMoved = true
    renameSync(staged, config.currentAppPath)
    verifyAppBundle(config.currentAppPath, config)
    run('/usr/bin/open', [config.currentAppPath], 30_000)
  } catch (error) {
    rmSync(staged, { recursive: true, force: true })
    if (currentMoved) {
      rmSync(config.currentAppPath, { recursive: true, force: true })
      renameSync(backup, config.currentAppPath)
      try { run('/usr/bin/open', [config.currentAppPath], 30_000) } catch { /* preserve original error */ }
    }
    throw error
  } finally {
    try { run('/usr/bin/hdiutil', ['detach', mountPoint], 30_000) } catch { /* mount cleanup is best-effort */ }
    rmSync(mountPoint, { recursive: true, force: true })
  }
}

async function main(): Promise<void> {
  const encoded = process.argv[2]
  if (encoded === undefined) throw new Error('Missing update helper configuration.')
  let raw: unknown
  try { raw = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) } catch { throw new Error('Invalid update helper configuration.') }
  const config = validateUpdateHelperConfig(raw)
  if (config === null) throw new Error('Unsafe update helper configuration.')
  await install(config)
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && import.meta.url === pathToFileURL(resolve(invokedPath)).href) {
  void main().catch((error: unknown) => {
    process.stderr.write(`DeepSeek Harness update helper failed: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
