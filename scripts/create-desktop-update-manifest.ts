import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { validateDesktopUpdateManifest, type DesktopUpdateManifest } from '../apps/desktop/src/update/release.ts'

const OUTPUT_NAME = 'deepseek-harness-desktop-update.json'

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

async function main(): Promise<void> {
  const [rawDmgPath, rawOutputPath, desktopVersion, harnessVersion, tag, ...extra] = process.argv.slice(2)
  if (rawDmgPath === undefined || rawOutputPath === undefined || desktopVersion === undefined
    || harnessVersion === undefined || tag === undefined || extra.length > 0) {
    throw new Error(
      'usage: create-desktop-update-manifest <dmg> <output> <desktop-version> <harness-version> <tag>',
    )
  }
  const dmgPath = resolve(rawDmgPath)
  const outputPath = resolve(rawOutputPath)
  const assetName = `DeepSeek-Harness-${desktopVersion}-mac-x64.dmg`
  if (basename(dmgPath) !== assetName) throw new Error('DMG filename does not match the Desktop version.')
  if (basename(outputPath) !== OUTPUT_NAME) throw new Error(`Output filename must be ${OUTPUT_NAME}.`)
  if (tag !== `desktop-v${desktopVersion}`) throw new Error('Release tag does not match the Desktop version.')
  const info = await stat(dmgPath)
  if (!info.isFile()) throw new Error('DMG path is not a regular file.')
  const manifest: DesktopUpdateManifest = {
    schema: 1,
    desktopVersion,
    harnessVersion,
    platform: 'darwin',
    arch: 'x64',
    assetName,
    bytes: info.size,
    sha256: await sha256File(dmgPath),
    releaseUrl: `https://github.com/Missher12/deepseek-harness-desktop/releases/tag/${tag}`,
  }
  if (validateDesktopUpdateManifest(manifest) === null) throw new Error('Generated Desktop update manifest is invalid.')
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 })
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
