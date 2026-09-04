/**
 * Repeatable BrowserSkill CLI fetcher.
 *
 * Downloads one pinned archive (HTTPS URL, exact byte bound, SHA-256 first),
 * then extracts exactly the one declared member with traversal checks. The
 * extracted binary lives in a rebuildable ignored directory and is never
 * committed; the staged Desktop copy re-hashes what this module produced.
 * @module scripts/prepare-browser-skill-assets
 */

import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { gunzipSync, inflateRawSync } from 'node:zlib'
import { dirname, join, resolve } from 'node:path'

export const ASSET_MANIFEST_PATH = resolve(import.meta.dirname, 'browser-skill-assets.json')
export const DEFAULT_ASSET_ROOT = resolve(import.meta.dirname, '../apps/desktop/.browser-skill-assets')

const MAX_ARCHIVE_BYTES = 64 << 20
const TAR_BLOCK = 512

export interface BrowserSkillAsset {
  readonly url: string
  readonly sha256: string
  readonly archiveBytes: number
  readonly member: string
  readonly executable: boolean
}

export interface BrowserSkillAssetManifest {
  readonly version: string
  readonly assets: Record<string, BrowserSkillAsset>
}

export type BrowserSkillPlatform = 'darwin-x64' | 'win32-x64'

interface AssetFetcher {
  (url: string): Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>
}

/** Load and structurally narrow the pinned manifest. */
export function readAssetManifest(path = ASSET_MANIFEST_PATH): BrowserSkillAssetManifest {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
  if (typeof parsed !== 'object' || parsed === null) throw new Error('browser-skill-assets: manifest must be an object')
  const manifest = parsed as { version?: unknown; assets?: unknown }
  if (typeof manifest.version !== 'string' || manifest.version.length === 0
    || manifest.version === '.' || manifest.version === '..'
    || manifest.version.includes('/') || manifest.version.includes('\\') || manifest.version.includes('\0')) {
    throw new Error('browser-skill-assets: manifest version must be one safe path segment')
  }
  if (typeof manifest.assets !== 'object' || manifest.assets === null) {
    throw new Error('browser-skill-assets: manifest assets must be an object')
  }
  const assets: Record<string, BrowserSkillAsset> = {}
  for (const [platform, value] of Object.entries(manifest.assets)) {
    if (platform !== 'darwin-x64' && platform !== 'win32-x64') {
      throw new Error(`browser-skill-assets: unknown platform ${platform}`)
    }
    const asset = value as Partial<BrowserSkillAsset> | undefined
    if (typeof asset?.url !== 'string' || !asset.url.startsWith('https://')) {
      throw new Error(`browser-skill-assets: ${platform} url must be an HTTPS URL`)
    }
    if (typeof asset.sha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(asset.sha256)) {
      throw new Error(`browser-skill-assets: ${platform} sha256 must be 64 lowercase hex`)
    }
    const archiveBytes = asset.archiveBytes
    if (archiveBytes === undefined || !Number.isSafeInteger(archiveBytes)
      || archiveBytes <= 0 || archiveBytes > MAX_ARCHIVE_BYTES) {
      throw new Error(`browser-skill-assets: ${platform} archiveBytes must be a bounded positive integer`)
    }
    if (typeof asset.member !== 'string' || asset.member.length === 0
      || asset.member.includes('/') || asset.member.includes('\\') || asset.member === '.' || asset.member === '..') {
      throw new Error(`browser-skill-assets: ${platform} member must be one plain basename`)
    }
    assets[platform] = {
      url: asset.url,
      sha256: asset.sha256,
      archiveBytes,
      member: asset.member,
      executable: asset.executable === true,
    }
  }
  return { version: manifest.version, assets }
}

function assertSafeMemberName(name: string): void {
  if (name.length === 0 || name.includes('\0')) throw new Error('browser-skill-assets: empty or NUL member name')
  if (name.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(name)) {
    throw new Error('browser-skill-assets: absolute member path rejected')
  }
  if (name.split(/[\\/]/u).includes('..')) throw new Error('browser-skill-assets: parent traversal rejected')
}

/** Extract the single declared member from a gzipped POSIX tar. */
export function extractTarMember(archive: Buffer, member: string): Buffer {
  const data = gunzipSync(archive)
  let offset = 0
  let found: Buffer | undefined
  for (;;) {
    if (offset + TAR_BLOCK > data.length) {
      throw new Error(found === undefined ? 'browser-skill-assets: tar member not found' : 'browser-skill-assets: tar truncated')
    }
    const header = data.subarray(offset, offset + TAR_BLOCK)
    if (header.every(byte => byte === 0)) break
    const nameField = header.subarray(0, 100).toString('utf8').replace(/\0[\s\S]*$/u, '')
    const sizeField = header.subarray(124, 136).toString('utf8').replace(/\0.*$/u, '').trim()
    const typeflag = String.fromCharCode(header[156] ?? 0)
    const size = Number.parseInt(sizeField === '' ? '0' : sizeField, 8)
    if (!Number.isSafeInteger(size) || size < 0 || offset + TAR_BLOCK + size > data.length) {
      throw new Error('browser-skill-assets: tar size overflow or truncation')
    }
    const payload = data.subarray(offset + TAR_BLOCK, offset + TAR_BLOCK + size)
    if (nameField !== '') {
      assertSafeMemberName(nameField)
      if (typeflag !== '0' && typeflag !== '\0') {
        throw new Error(`browser-skill-assets: tar member ${nameField} has unsupported type ${typeflag}`)
      }
      if (nameField === member) {
        if (found !== undefined) throw new Error('browser-skill-assets: duplicate tar member')
        found = Buffer.from(payload)
      }
    }
    offset += TAR_BLOCK + Math.ceil(size / TAR_BLOCK) * TAR_BLOCK
  }
  if (found === undefined) throw new Error('browser-skill-assets: tar member not found')
  return found
}

/** Extract the single declared member from a zip archive (stored or deflated). */
export function extractZipMember(archive: Buffer, member: string): Buffer {
  const eocd = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  if (eocd < 0) throw new Error('browser-skill-assets: zip end record not found')
  const entries = archive.readUInt16LE(eocd + 10)
  let offset = archive.readUInt32LE(eocd + 16)
  let found: Buffer | undefined
  let seen = 0
  for (;;) {
    const signature = archive.readUInt32LE(offset)
    if (signature !== 0x02014b50) throw new Error('browser-skill-assets: zip central directory corrupted')
    const method = archive.readUInt16LE(offset + 10)
    const compressedSize = archive.readUInt32LE(offset + 20)
    const nameLength = archive.readUInt16LE(offset + 28)
    const extraLength = archive.readUInt16LE(offset + 30)
    const commentLength = archive.readUInt16LE(offset + 32)
    const externalAttrs = archive.readUInt32LE(offset + 38)
    const localOffset = archive.readUInt32LE(offset + 42)
    const name = archive.subarray(offset + 46, offset + 46 + nameLength).toString('utf8')
    seen += 1
    if (seen > entries) throw new Error('browser-skill-assets: zip entry count mismatch')
    if (!name.endsWith('/')) {
      assertSafeMemberName(name)
      if ((externalAttrs >>> 16) & 0xf000) {
        throw new Error(`browser-skill-assets: zip member ${name} is not a regular file`)
      }
      if (name === member) {
        if (found !== undefined) throw new Error('browser-skill-assets: duplicate zip member')
        const local = archive.readUInt32LE(localOffset)
        if (local !== 0x04034b50) throw new Error('browser-skill-assets: zip local header corrupted')
        const localNameLength = archive.readUInt16LE(localOffset + 26)
        const localExtraLength = archive.readUInt16LE(localOffset + 28)
        const dataStart = localOffset + 30 + localNameLength + localExtraLength
        const compressed = archive.subarray(dataStart, dataStart + compressedSize)
        found = method === 0 ? Buffer.from(compressed) : method === 8 ? inflateRawSync(compressed) : undefined
        if (found === undefined) throw new Error(`browser-skill-assets: zip method ${method} unsupported`)
      }
    }
    if (seen === entries) break
    offset += 46 + nameLength + extraLength + commentLength
  }
  if (found === undefined) throw new Error('browser-skill-assets: zip member not found')
  return found
}

/**
 * Prepare the pinned CLI for one platform: download when absent or digest-
 * mismatched, verify SHA-256, extract the exact member, and record the
 * verified binary path. Never writes outside the asset root.
 * @param platform - one manifest platform key.
 * @param options - injectable transport and root for isolated tests.
 */
export async function prepareBrowserSkillAssets(
  platform: BrowserSkillPlatform,
  options: { fetch?: AssetFetcher; root?: string; manifestPath?: string } = {},
): Promise<string> {
  const manifest = readAssetManifest(options.manifestPath)
  const asset = manifest.assets[platform]
  if (asset === undefined) throw new Error(`browser-skill-assets: unknown platform ${platform}`)
  const assetRoot = options.root ?? process.env.DSH_BROWSER_SKILL_ASSET_ROOT ?? DEFAULT_ASSET_ROOT
  const root = join(assetRoot, manifest.version)
  const archivePath = join(root, `${platform}.archive`)
  const binPath = join(root, asset.member)
  const expected = Buffer.from(asset.sha256, 'hex')

  const verified = existsSync(archivePath) && existsSync(binPath)
    ? createHash('sha256').update(readFileSync(archivePath)).digest().equals(expected)
    : false
  if (!verified) {
    const fetchImpl = options.fetch ?? (async (url: string) => await fetch(url))
    const response = await fetchImpl(asset.url)
    if (!response.ok) throw new Error(`browser-skill-assets: download failed with status ${response.status}`)
    const body = Buffer.from(await response.arrayBuffer())
    if (body.byteLength !== asset.archiveBytes) {
      throw new Error(`browser-skill-assets: archive is ${body.byteLength} bytes, expected ${asset.archiveBytes}`)
    }
    const digest = createHash('sha256').update(body).digest()
    if (!digest.equals(expected)) {
      throw new Error(`browser-skill-assets: sha256 mismatch for ${asset.url}`)
    }
    const member = platform === 'win32-x64' ? extractZipMember(body, asset.member) : extractTarMember(body, asset.member)
    mkdirSync(dirname(binPath), { recursive: true })
    writeFileSync(binPath, member, { flag: 'wx' })
    if (asset.executable) chmodSync(binPath, 0o755)
    writeFileSync(archivePath, body, { flag: 'wx' })
  }
  return binPath
}
