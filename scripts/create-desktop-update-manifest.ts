import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import {
  desktopUpdateAssetName, desktopUpdateManifestName, validateDesktopUpdateManifest,
  type DesktopUpdateTarget,
} from '../apps/desktop/src/update/release.ts'

async function physicalPayload(path: string): Promise<{ bytes: number; sha256: string }> {
  const initial = await lstat(path)
  if (!initial.isFile() || initial.nlink !== 1) throw new Error('Payload must be a physical regular file.')
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  const hash = createHash('sha256')
  try {
    const matches = (info: typeof initial): boolean => info.isFile() && info.nlink === 1
      && info.dev === initial.dev && info.ino === initial.ino && info.size === initial.size
      && info.mtimeMs === initial.mtimeMs && info.ctimeMs === initial.ctimeMs
    if (!matches(await file.stat())) throw new Error('Payload changed before hashing.')
    const buffer = Buffer.alloc(1024 * 1024)
    while (true) {
      const { bytesRead } = await file.read(buffer, 0, buffer.length, null)
      if (bytesRead === 0) break
      hash.update(buffer.subarray(0, bytesRead))
    }
    if (!matches(await file.stat()) || !matches(await lstat(path))) throw new Error('Payload changed while hashing.')
    return { bytes: initial.size, sha256: hash.digest('hex') }
  } finally {
    await file.close()
  }
}

async function main(): Promise<void> {
  const [rawDmgPath, rawOutputPath, desktopVersion, harnessVersion, tag, ...extra] = process.argv.slice(2)
  if (rawDmgPath === undefined || rawOutputPath === undefined || desktopVersion === undefined
    || harnessVersion === undefined || tag === undefined
    || (extra.length !== 0 && (extra.length !== 2 || extra[0] !== '--target'))) {
    throw new Error(
      'usage: create-desktop-update-manifest <payload> <output> <desktop-version> <harness-version> <tag> [--target win32-x64-nsis|linux-x64-deb|linux-x64-appimage]',
    )
  }
  let target: DesktopUpdateTarget = { platform: 'darwin', arch: 'x64', packageFormat: 'dmg' }
  if (extra.length !== 0) {
    if (extra[1] === 'win32-x64-nsis') target = { platform: 'win32', arch: 'x64', packageFormat: 'nsis' }
    else if (extra[1] === 'linux-x64-deb') target = { platform: 'linux', arch: 'x64', packageFormat: 'deb' }
    else if (extra[1] === 'linux-x64-appimage') target = { platform: 'linux', arch: 'x64', packageFormat: 'appimage' }
    else throw new Error('Unsupported Desktop update target.')
  }
  const dmgPath = resolve(rawDmgPath)
  const outputPath = resolve(rawOutputPath)
  const assetName = desktopUpdateAssetName(desktopVersion, target)
  const outputName = desktopUpdateManifestName(target)
  if (basename(dmgPath) !== assetName) throw new Error('Payload filename does not match the Desktop version and target.')
  if (basename(outputPath) !== outputName) throw new Error(`Output filename must be ${outputName}.`)
  if (tag !== `desktop-v${desktopVersion}`) throw new Error('Release tag does not match the Desktop version.')
  const manifest = {
    ...(target.platform === 'darwin'
      ? { schema: 1, platform: 'darwin', arch: 'x64' }
      : { schema: 2, ...target }),
    desktopVersion,
    harnessVersion,
    assetName,
    ...await physicalPayload(dmgPath),
    releaseUrl: `https://github.com/Missher12/deepseek-harness-desktop/releases/tag/${tag}`,
  }
  if (validateDesktopUpdateManifest(manifest, target) === null) throw new Error('Generated Desktop update manifest is invalid.')
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    mode: 0o600, flag: constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW,
  })
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
