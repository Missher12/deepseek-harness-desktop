import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants, type Stats } from 'node:fs'
import { lstat, open, realpath, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { compareVersions } from './release.ts'

export type LinuxPackageFormat = 'deb' | 'appimage'

export interface LinuxPackageDetectionOptions {
  platform: string
  arch: string
  isPackaged: boolean
  executablePath: string
  appImagePath?: string
  appDir?: string
}

/** Main/service-owned input only. Never populate paths from renderer IPC. */
export interface LinuxInstallDescriptor {
  platform: 'linux'
  arch: 'x64'
  packageFormat: LinuxPackageFormat
  desktopVersion: string
  assetName: string
  filePath: string
  stagingDirectory: string
  bytes: number
  sha256: string
}

export interface LinuxPackageHandoffResult {
  /** The directory handler accepted the request; installation is still manual. */
  status: 'manual-install-ready'
  packageFormat: LinuxPackageFormat
  directory: string
}

function inside(directory: string, path: string): boolean {
  const child = relative(directory, path)
  return child !== '' && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child)
}

function matchesFormat(header: Buffer, format: LinuxPackageFormat): boolean {
  if (format === 'deb') {
    return header.length >= 72 && header.subarray(0, 8).toString('ascii') === '!<arch>\n'
      && header.subarray(8, 24).toString('ascii').trim().replace(/\/$/, '') === 'debian-binary'
      && header.subarray(68, 72).toString('ascii') === '2.0\n'
  }
  return header.length >= 20 && header.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))
    && header[4] === 2 && header[5] === 1 // ELF64, little endian
    && header[8] === 0x41 && header[9] === 0x49 && header[10] === 2 // Type 2 AppImage
    && header.readUInt16LE(18) === 62 // x86-64
}

function dpkgQuery(args: string[]): Promise<string> {
  return new Promise((fulfill, reject) => {
    execFile('/usr/bin/dpkg-query', args, {
      shell: false,
      timeout: 2_000,
      maxBuffer: 16_384,
      encoding: 'utf8',
      env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' },
    }, (error, stdout) => {
      if (error !== null) reject(new Error('Linux package query failed.', { cause: error }))
      else fulfill(stdout.trim())
    })
  })
}

async function isInstalledDeb(executablePath: string): Promise<boolean> {
  const owner = await dpkgQuery(['--search', executablePath])
  if (owner !== `deepseek-harness: ${executablePath}` && owner !== `deepseek-harness:amd64: ${executablePath}`) return false
  return await dpkgQuery(['--show', '--showformat=${Status}\t${Architecture}', 'deepseek-harness']) === 'install ok installed\tamd64'
}

/** Async and bounded; callers should schedule this after cold-start readiness. */
export async function detectLinuxPackageFormat(
  options: LinuxPackageDetectionOptions,
  queryPackage: (executablePath: string) => Promise<boolean> = isInstalledDeb,
): Promise<LinuxPackageFormat | 'unknown'> {
  if (options.platform !== 'linux' || options.arch !== 'x64' || !options.isPackaged || !isAbsolute(options.executablePath)) return 'unknown'
  try {
    const executable = await realpath(options.executablePath)
    if (!(await stat(executable)).isFile() || !['deepseek-harness', 'deepseek-harness-bin'].includes(basename(executable))) return 'unknown'
    // Conflicting or incomplete runtime hints must not fall through to a deb guess.
    if (options.appImagePath !== undefined || options.appDir !== undefined) {
      if (options.appImagePath === undefined || options.appDir === undefined
        || !isAbsolute(options.appImagePath) || !isAbsolute(options.appDir)) return 'unknown'
      const image = await realpath(options.appImagePath)
      const appDir = await realpath(options.appDir)
      if (!inside(appDir, executable) || inside(appDir, image)) return 'unknown'
      const file = await open(image, constants.O_RDONLY | constants.O_NONBLOCK)
      try {
        if (!(await file.stat()).isFile()) return 'unknown'
        const header = Buffer.alloc(72)
        const { bytesRead } = await file.read(header, 0, header.length, 0)
        return matchesFormat(header.subarray(0, bytesRead), 'appimage') ? 'appimage' : 'unknown'
      } finally {
        await file.close()
      }
    }
    return await queryPackage(executable) ? 'deb' : 'unknown'
  } catch {
    return 'unknown'
  }
}

function sameFile(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size
    && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs
}

function owned(info: Stats): boolean {
  return typeof process.getuid === 'function' && info.uid === process.getuid() && (info.mode & 0o022) === 0
}

/** Recheck a retained download, then request its folder. Does not install or quit. */
export async function revealLinuxUpdatePackage(
  descriptor: LinuxInstallDescriptor,
  openDirectory: (directory: string) => Promise<string>,
): Promise<LinuxPackageHandoffResult> {
  // Snapshot caller-owned fields before any async work.
  const payload: Omit<LinuxInstallDescriptor, 'platform' | 'arch'> & { platform: string; arch: string } = { ...descriptor }
  if (payload.platform !== 'linux' || payload.arch !== 'x64'
    || !['deb', 'appimage'].includes(payload.packageFormat)
    || compareVersions(payload.desktopVersion, payload.desktopVersion) !== 0
    || !Number.isSafeInteger(payload.bytes) || payload.bytes < 72 || payload.bytes > 2_000_000_000
    || !/^[a-f0-9]{64}$/.test(payload.sha256)) throw new Error('Invalid Linux update descriptor.')
  const extension = payload.packageFormat === 'deb' ? 'deb' : 'AppImage'
  const expectedName = `DeepSeek-Harness-${payload.desktopVersion}-linux-x64.${extension}`
  if (payload.assetName !== expectedName || !isAbsolute(payload.filePath) || !isAbsolute(payload.stagingDirectory)
    || basename(payload.filePath) !== expectedName || dirname(resolve(payload.filePath)) !== resolve(payload.stagingDirectory)) {
    throw new Error('Linux update package name or staging path is invalid.')
  }
  const directoryInfo = await lstat(payload.stagingDirectory)
  if (!directoryInfo.isDirectory() || !owned(directoryInfo)) throw new Error('Linux update staging directory is not privately owned.')
  const directory = await realpath(payload.stagingDirectory)
  const path = join(directory, expectedName)
  const initial = await lstat(path)
  if (!initial.isFile() || initial.nlink !== 1 || !owned(initial) || initial.size !== payload.bytes) {
    throw new Error('Linux update package is missing, linked, unsafe, or has the wrong size.')
  }
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    if (!sameFile(initial, await file.stat())) throw new Error('Linux update package changed before verification.')
    const hash = createHash('sha256')
    const buffer = Buffer.alloc(1024 * 1024)
    let received = 0
    let header = Buffer.alloc(0)
    while (true) {
      const { bytesRead } = await file.read(buffer, 0, buffer.length, null)
      if (bytesRead === 0) break
      if (header.length < 72) header = Buffer.concat([header, buffer.subarray(0, Math.min(bytesRead, 72 - header.length))])
      received += bytesRead
      if (received > payload.bytes) throw new Error('Linux update package size changed during verification.')
      hash.update(buffer.subarray(0, bytesRead))
    }
    if (received !== payload.bytes || hash.digest('hex') !== payload.sha256 || !matchesFormat(header, payload.packageFormat)) {
      throw new Error('Linux update package failed size, SHA-256, or format verification. Download it again.')
    }
    if (!sameFile(initial, await file.stat()) || !sameFile(initial, await lstat(path))
      || !(await lstat(payload.stagingDirectory)).isDirectory()
      || await realpath(payload.stagingDirectory) !== directory) throw new Error('Linux update package changed during verification.')
    const currentDirectory = await lstat(directory)
    if (currentDirectory.dev !== directoryInfo.dev || currentDirectory.ino !== directoryInfo.ino || !owned(currentDirectory)) {
      throw new Error('Linux update staging directory changed during verification.')
    }
    const error = await openDirectory(directory)
    if (error !== '') throw new Error('Could not open the Linux update folder. Use the displayed package path to install manually.')
    return { status: 'manual-install-ready', packageFormat: payload.packageFormat, directory }
  } finally {
    await file.close()
  }
}
