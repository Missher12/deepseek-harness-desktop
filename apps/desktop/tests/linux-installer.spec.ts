import { createHash } from 'node:crypto'
import * as childProcess from 'node:child_process'
import * as filesystem from 'node:fs/promises'
import { chmod, link, mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  detectLinuxPackageFormat,
  revealLinuxUpdatePackage,
  type LinuxInstallDescriptor,
  type LinuxPackageDetectionOptions,
  type LinuxPackageFormat,
} from '../src/update/linux-installer.ts'

vi.mock('node:child_process', { spy: true })
vi.mock('node:fs/promises', { spy: true })

const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function root(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'dsh-linux-installer-'))
  roots.push(path)
  return await realpath(path)
}

function packageBytes(format: LinuxPackageFormat): Buffer {
  // Minimal format fixtures, not installable packages or native acceptance evidence.
  const data = Buffer.alloc(128)
  if (format === 'deb') {
    data.write('!<arch>\ndebian-binary   /', 0, 'ascii')
    data.write('2.0\n', 68, 'ascii')
  } else {
    Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0, 0x41, 0x49, 2]).copy(data)
    data.writeUInt16LE(62, 18)
  }
  return data
}

async function payload(format: LinuxPackageFormat = 'deb'): Promise<LinuxInstallDescriptor> {
  const stagingDirectory = await root()
  const assetName = `DeepSeek-Harness-0.5.7-linux-x64.${format === 'deb' ? 'deb' : 'AppImage'}`
  const filePath = join(stagingDirectory, assetName)
  const data = packageBytes(format)
  await writeFile(filePath, data, { mode: 0o600 })
  return {
    platform: 'linux', arch: 'x64', packageFormat: format, desktopVersion: '0.5.7',
    assetName, filePath, stagingDirectory, bytes: data.length,
    sha256: createHash('sha256').update(data).digest('hex'),
  }
}

async function runtime(): Promise<LinuxPackageDetectionOptions> {
  const directory = await root()
  const executablePath = join(directory, 'deepseek-harness-bin')
  await writeFile(executablePath, 'packaged executable fixture')
  return { platform: 'linux', arch: 'x64', isPackaged: true, executablePath }
}

describe('Linux package detection', () => {
  it('bounds actual dpkg queries and rejects wrong package ownership or status', async () => {
    const options = await runtime()
    const executable = await realpath(options.executablePath)
    const replies = [`deepseek-harness: ${executable}`, 'install ok installed\tamd64']
    const execute = vi.spyOn(childProcess, 'execFile').mockImplementation((command, args, settings, callback) => {
      expect(command).toBe('/usr/bin/dpkg-query')
      expect(settings).toMatchObject({ shell: false, timeout: 2000, maxBuffer: 16384, env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' } })
      expect(Object.keys(settings?.env ?? {})).toEqual(['PATH', 'LC_ALL'])
      expect(args).not.toContain('sudo')
      if (typeof callback !== 'function') throw new Error('Missing query callback')
      Reflect.apply(callback, undefined, [null, replies.shift() ?? '', ''])
      return {} as childProcess.ChildProcess
    })
    expect(await detectLinuxPackageFormat(options)).toBe('deb')
    expect(execute).toHaveBeenCalledTimes(2)
    replies.push(`other-package: ${executable}`)
    expect(await detectLinuxPackageFormat(options)).toBe('unknown')
    replies.push(`deepseek-harness: ${executable}`, 'deinstall ok config-files\tamd64')
    expect(await detectLinuxPackageFormat(options)).toBe('unknown')
  })
  it('awaits package ownership asynchronously and accepts only a positive match', async () => {
    const options = await runtime()
    let finish!: (owned: boolean) => void
    const pending = new Promise<boolean>((fulfill) => { finish = fulfill })
    const query = vi.fn(() => pending)
    const result = detectLinuxPackageFormat(options, query)
    finish(true)
    expect(await result).toBe('deb')
    expect(query).toHaveBeenCalledWith(await realpath(options.executablePath))
    expect(await detectLinuxPackageFormat(options, async () => false)).toBe('unknown')
    expect(await detectLinuxPackageFormat(options, async () => { throw new Error('query timed out') })).toBe('unknown')
  })

  it.each([
    { platform: 'darwin' }, { arch: 'arm64' }, { isPackaged: false },
    { executablePath: 'relative' }, { appImagePath: '/missing.AppImage' },
  ])('does not guess for unsupported or incomplete runtime %j', async (change) => {
    const query = vi.fn(async () => true)
    expect(await detectLinuxPackageFormat({ ...await runtime(), ...change }, query)).toBe('unknown')
    expect(query).not.toHaveBeenCalled()
  })

  it('requires AppImage header and executable containment, without querying deb', async () => {
    const options = await runtime()
    const image = await payload('appimage')
    const appDir = join(await root(), 'mount')
    await mkdir(appDir)
    const executablePath = join(appDir, 'deepseek-harness-bin')
    await writeFile(executablePath, 'mounted executable')
    const query = vi.fn(async () => true)
    const input = { ...options, executablePath, appDir, appImagePath: image.filePath }
    expect(await detectLinuxPackageFormat(input, query)).toBe('appimage')
    expect(await detectLinuxPackageFormat({ ...input, executablePath: options.executablePath }, query)).toBe('unknown')
    await writeFile(image.filePath, packageBytes('deb'))
    expect(await detectLinuxPackageFormat(input, query)).toBe('unknown')
    expect(query).not.toHaveBeenCalled()
  })
})

// POSIX uid, mode and O_NOFOLLOW are this Linux adapter's contract; no Windows approximation.
describe.skipIf(process.platform === 'win32')('Linux verified package folder handoff', () => {
  it.each(['deb', 'appimage'] as const)('reveals only the parent for %s and retains the exact payload and mode', async (format) => {
    const descriptor = await payload(format)
    const before = await stat(descriptor.filePath)
    const bytes = await readFile(descriptor.filePath)
    const openDirectory = vi.fn(async () => '')
    expect(await revealLinuxUpdatePackage(descriptor, openDirectory)).toEqual({
      status: 'manual-install-ready', packageFormat: format, directory: descriptor.stagingDirectory,
    })
    expect(openDirectory).toHaveBeenCalledExactlyOnceWith(descriptor.stagingDirectory)
    expect(await readFile(descriptor.filePath)).toEqual(bytes)
    expect((await stat(descriptor.filePath)).mode).toBe(before.mode)
  })

  it.each([
    { platform: 'darwin' }, { arch: 'arm64' }, { packageFormat: 'dmg' },
    { bytes: 0 }, { bytes: 2_000_000_001 }, { sha256: 'invalid' },
    { desktopVersion: '../0.5.7' }, { assetName: 'other.deb' },
  ])('rejects incompatible or malformed metadata %j', async (change) => {
    const descriptor = { ...await payload(), ...change } as LinuxInstallDescriptor
    const reveal = vi.fn(async () => '')
    await expect(revealLinuxUpdatePackage(descriptor, reveal)).rejects.toThrow()
    expect(reveal).not.toHaveBeenCalled()
  })

  it('rejects an outside path even when its name and bytes match', async () => {
    const descriptor = await payload()
    descriptor.filePath = join(await root(), descriptor.assetName)
    await writeFile(descriptor.filePath, packageBytes('deb'))
    await expect(revealLinuxUpdatePackage(descriptor, async () => '')).rejects.toThrow('staging path')
  })

  it.each(['missing', 'size', 'hash', 'format'] as const)('refuses a %s payload without handoff', async (change) => {
    const descriptor = await payload()
    if (change === 'missing') await rm(descriptor.filePath)
    else if (change === 'size') await writeFile(descriptor.filePath, 'short')
    else {
      const bytes = packageBytes(change === 'format' ? 'appimage' : 'deb')
      bytes[100] = 1
      await writeFile(descriptor.filePath, bytes)
      if (change === 'format') descriptor.sha256 = createHash('sha256').update(bytes).digest('hex')
    }
    const reveal = vi.fn(async () => '')
    await expect(revealLinuxUpdatePackage(descriptor, reveal)).rejects.toThrow()
    expect(reveal).not.toHaveBeenCalled()
  })

  it.each(['symlink', 'hardlink', 'directory-link', 'writable-directory', 'writable-file'] as const)('rejects %s', async (kind) => {
    const descriptor = await payload()
    if (kind === 'symlink' || kind === 'hardlink') {
      const original = join(await root(), 'original')
      await writeFile(original, packageBytes('deb'), { mode: 0o600 })
      await rm(descriptor.filePath)
      await (kind === 'symlink' ? symlink(original, descriptor.filePath) : link(original, descriptor.filePath))
    } else if (kind === 'directory-link') {
      const alias = join(await root(), 'alias')
      await symlink(descriptor.stagingDirectory, alias)
      descriptor.stagingDirectory = alias
      descriptor.filePath = join(alias, descriptor.assetName)
    } else await chmod(kind === 'writable-directory' ? descriptor.stagingDirectory : descriptor.filePath, 0o777)
    const reveal = vi.fn(async () => '')
    await expect(revealLinuxUpdatePackage(descriptor, reveal)).rejects.toThrow()
    expect(reveal).not.toHaveBeenCalled()
  })

  it('reports handler failure and allows retry with the retained package', async () => {
    const descriptor = await payload()
    await expect(revealLinuxUpdatePackage(descriptor, async () => 'no handler')).rejects.toThrow('Could not open')
    await expect(revealLinuxUpdatePackage(descriptor, async () => { throw new Error('handler unavailable') })).rejects.toThrow('handler unavailable')
    await expect(revealLinuxUpdatePackage(descriptor, async () => '')).resolves.toMatchObject({ status: 'manual-install-ready' })
  })

  it('rejects a replacement while the verifier holds the original open file', async () => {
    const descriptor = await payload()
    const originalOpen = (await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')).open
    vi.spyOn(filesystem, 'open').mockImplementation(async (...args) => {
      const handle = await originalOpen(...args)
      // Replace the pathname while the verifier holds the original open file.
      await rm(descriptor.filePath)
      await writeFile(descriptor.filePath, packageBytes('deb'), { mode: 0o600 })
      return handle
    })
    const reveal = vi.fn(async () => '')
    await expect(revealLinuxUpdatePackage(descriptor, reveal)).rejects.toThrow('changed')
    expect(reveal).not.toHaveBeenCalled()
  })
})
