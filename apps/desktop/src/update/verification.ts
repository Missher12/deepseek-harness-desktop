import { createHash } from 'node:crypto'
import { constants, type Stats } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { desktopUpdateAssetName, validateDesktopUpdateManifest, type VerifiedDesktopUpdate } from './release.ts'

function sameFile(left: Stats, right: Stats): boolean {
  return right.isFile() && right.nlink === 1 && left.dev === right.dev && left.ino === right.ino
    && left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs
}

function privatelyOwned(info: Stats): boolean {
  return typeof process.getuid !== 'function' || info.uid === process.getuid() && (info.mode & 0o022) === 0
}

/** Format checks complement the exact publisher checksum; they are not code signing. */
function validFormat(header: Buffer, trailer: Buffer, descriptor: VerifiedDesktopUpdate): boolean {
  switch (descriptor.target.packageFormat) {
    case 'dmg': return trailer.length === 512 && trailer.subarray(0, 4).toString('ascii') === 'koly'
    case 'deb': return header.length >= 72 && header.subarray(0, 8).toString('ascii') === '!<arch>\n'
      && header.subarray(8, 24).toString('ascii').trim().replace(/\/$/, '') === 'debian-binary'
      && header.subarray(68, 72).toString('ascii') === '2.0\n'
    case 'appimage': return header.length >= 20 && header.subarray(0, 6).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1]))
      && header.subarray(8, 11).equals(Buffer.from([0x41, 0x49, 2])) && header.readUInt16LE(18) === 62
    case 'nsis': {
      if (header.length < 64 || header.subarray(0, 2).toString('ascii') !== 'MZ') return false
      const offset = header.readUInt32LE(0x3c)
      if (offset < 64 || offset + 26 > header.length || header.subarray(offset, offset + 4).toString('ascii') !== 'PE\0\0') return false
      // A PE32 NSIS bootstrap may carry an x64 application. Do not require PE32+.
      return [0x14c, 0x8664].includes(header.readUInt16LE(offset + 4))
        && [0x10b, 0x20b].includes(header.readUInt16LE(offset + 24))
    }
  }
}

/** Verify one service-owned physical file immediately before granting native authority. */
export async function verifyDesktopUpdateFile(descriptor: VerifiedDesktopUpdate, signal?: AbortSignal): Promise<void> {
  const payload = { ...descriptor, target: { ...descriptor.target } }
  try {
    const manifest = {
      ...(payload.target.platform === 'darwin' ? { schema: 1, platform: 'darwin', arch: 'x64' } : { schema: 2, ...payload.target }),
      desktopVersion: payload.desktopVersion, harnessVersion: payload.harnessVersion,
      assetName: payload.assetName, bytes: payload.bytes, sha256: payload.sha256,
      releaseUrl: `https://github.com/Missher12/deepseek-harness-desktop/releases/tag/desktop-v${payload.desktopVersion}`,
    }
    if (validateDesktopUpdateManifest(manifest, payload.target) === null
      || !isAbsolute(payload.localPath) || !isAbsolute(payload.stagingDirectory)
      || basename(payload.localPath) !== desktopUpdateAssetName(payload.desktopVersion, payload.target)
      || dirname(resolve(payload.localPath)) !== resolve(payload.stagingDirectory)) throw new Error('Invalid descriptor.')
    const directoryInfo = await lstat(payload.stagingDirectory)
    if (!directoryInfo.isDirectory() || !privatelyOwned(directoryInfo)) throw new Error('Unsafe staging directory.')
    const directory = await realpath(payload.stagingDirectory)
    const path = join(directory, payload.assetName)
    const initial = await lstat(path)
    if (!initial.isFile() || initial.nlink !== 1 || initial.size !== payload.bytes || !privatelyOwned(initial)
      || await realpath(path) !== path) throw new Error('Unsafe payload.')
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    try {
      if (!sameFile(initial, await file.stat())) throw new Error('Changed payload.')
      const hash = createHash('sha256')
      const buffer = Buffer.alloc(1024 * 1024)
      let received = 0
      let header = Buffer.alloc(0)
      while (true) {
        signal?.throwIfAborted()
        const { bytesRead } = await file.read(buffer, 0, buffer.length, null)
        if (bytesRead === 0) break
        if (received === 0) header = Buffer.from(buffer.subarray(0, bytesRead))
        received += bytesRead
        if (received > payload.bytes) throw new Error('Changed size.')
        hash.update(buffer.subarray(0, bytesRead))
      }
      const trailer = Buffer.alloc(Math.min(payload.bytes, 512))
      await file.read(trailer, 0, trailer.length, payload.bytes - trailer.length)
      const currentDirectory = await lstat(payload.stagingDirectory)
      if (received !== payload.bytes || hash.digest('hex') !== payload.sha256 || !validFormat(header, trailer, payload)
        || !sameFile(initial, await file.stat()) || !sameFile(initial, await lstat(path))
        || !currentDirectory.isDirectory() || !privatelyOwned(currentDirectory)
        || currentDirectory.dev !== directoryInfo.dev || currentDirectory.ino !== directoryInfo.ino
        || await realpath(payload.stagingDirectory) !== directory || await realpath(path) !== path) throw new Error('Changed payload.')
      signal?.throwIfAborted()
    } finally {
      await file.close()
    }
  } catch {
    signal?.throwIfAborted()
    throw new Error('Desktop update verification failed. Download the package again.')
  }
}
