/** BrowserSkill CLI fetcher contracts: digest-first, byte-bounded, traversal-safe. */

import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { gzipSync, deflateRawSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  extractTarMember, extractZipMember, prepareBrowserSkillAssets, readAssetManifest,
  type BrowserSkillPlatform,
} from './prepare-browser-skill-assets.ts'

const roots: string[] = []
function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'bsk-assets-'))
  roots.push(root)
  return root
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function tarBlock(name: string, content: Buffer, typeflag = '0'): Buffer {
  const header = Buffer.alloc(512)
  header.write(name, 0, 'utf8')
  header.write(content.length.toString(8).padStart(11, '0') + '\0', 124, 'utf8')
  header[156] = typeflag.charCodeAt(0)
  const body = Buffer.alloc(Math.ceil(content.length / 512) * 512)
  content.copy(body)
  return Buffer.concat([header, body])
}

function gzTar(name: string, content: Buffer, typeflag = '0'): Buffer {
  return gzipSync(Buffer.concat([tarBlock(name, content, typeflag), Buffer.alloc(1024)]))
}

function zipBuffer(entries: Array<{ name: string; content: Buffer; mode?: number }>): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const compressed = entry.content.length === 0 ? Buffer.alloc(0) : deflateRawSync(entry.content)
    const method = entry.content.length === 0 ? 0 : 8
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(entry.content.length, 18)
    local.writeUInt32LE(compressed.length, 22)
    local.writeUInt16LE(name.length, 26)
    locals.push(Buffer.concat([local, name, compressed]))
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt32LE(entry.content.length, 24)
    central.writeUInt32LE(compressed.length, 20)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    central.writeUInt32LE(entry.mode ?? 0, 38)
    centrals.push(Buffer.concat([central, name]))
    offset += 30 + name.length + compressed.length
  }
  const centralSize = centrals.reduce((total, part) => total + part.length, 0)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralSize, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, ...centrals, eocd])
}

function sha256Hex(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex')
}

function toArrayBuffer(content: Buffer): ArrayBuffer {
  return Uint8Array.from(content).buffer
}

describe('prepare-browser-skill-assets', () => {
  it('rejects non-HTTPS URLs and unknown platforms at manifest load', async () => {
    expect(readAssetManifest().assets['darwin-x64']?.url.startsWith('https://')).toBe(true)
    expect(readAssetManifest().assets['win32-x64']?.url.startsWith('https://')).toBe(true)
    await expect(prepareBrowserSkillAssets('linux-x64' as BrowserSkillPlatform, { root: fixtureRoot() }))
      .rejects.toThrow(/unknown platform/)
  })

  it('downloads, verifies, and extracts only the exact member', async () => {
    const root = fixtureRoot()
    const payload = Buffer.from('#!/bin/sh\necho ok\n')
    const archive = gzTar('bsk', payload)
    const manifestPath = join(root, 'assets.json')
    const url = 'https://example.invalid/bsk.tar.gz'
    writeFileSync(manifestPath, JSON.stringify({
      version: 'test',
      assets: {
        'darwin-x64': {
          url,
          sha256: sha256Hex(archive),
          archiveBytes: archive.byteLength,
          member: 'bsk',
          executable: true,
        },
        'win32-x64': {
          url,
          sha256: sha256Hex(Buffer.from('x')),
          archiveBytes: 1,
          member: 'bsk.exe',
          executable: true,
        },
      },
    }))
    const fetchImpl = vi.fn(async () => ({
      ok: true, status: 200, arrayBuffer: async () => toArrayBuffer(archive),
    }))
    const binPath = await prepareBrowserSkillAssets('darwin-x64', {
      fetch: fetchImpl,
      root,
      manifestPath,
    })
    expect(readFileSync(binPath)).toEqual(payload)
    expect(fetchImpl).toHaveBeenCalledWith(url)
  })

  it('isolates cached binaries by pinned version so an upgrade cannot collide', async () => {
    const root = fixtureRoot()
    const prepare = async (version: string, content: string) => {
      const payload = Buffer.from(`#!/bin/sh\necho ${content}\n`)
      const archive = gzTar('bsk', payload)
      const manifestPath = join(root, `${version}.json`)
      writeFileSync(manifestPath, JSON.stringify({
        version,
        assets: {
          'darwin-x64': {
            url: `https://example.invalid/${version}.tar.gz`,
            sha256: sha256Hex(archive),
            archiveBytes: archive.byteLength,
            member: 'bsk',
            executable: true,
          },
        },
      }))
      const fetchImpl = vi.fn(async () => ({
        ok: true,
        status: 200,
        arrayBuffer: async () => toArrayBuffer(archive),
      }))
      const path = await prepareBrowserSkillAssets('darwin-x64', { fetch: fetchImpl, root, manifestPath })
      return { path, payload }
    }

    const old = await prepare('v0.1.11', 'old')
    const current = await prepare('v0.2.0', 'current')

    expect(old.path).not.toBe(current.path)
    expect(readFileSync(old.path)).toEqual(old.payload)
    expect(readFileSync(current.path)).toEqual(current.payload)
  })

  it('rejects a digest mismatch before any extraction', async () => {
    const root = fixtureRoot()
    const asset = readAssetManifest().assets['darwin-x64']
    if (asset === undefined) throw new Error('darwin-x64 asset missing')
    const small = gzTar('bsk', Buffer.from('wrong'))
    const archive = Buffer.concat([small, Buffer.alloc(asset.archiveBytes - small.byteLength)])
    const fetchImpl = vi.fn(async () => ({
      ok: true, status: 200, arrayBuffer: async () => toArrayBuffer(archive),
    }))
    await expect(prepareBrowserSkillAssets('darwin-x64', { fetch: fetchImpl, root }))
      .rejects.toThrow(/sha256 mismatch/)
    expect(existsSync(join(root, 'bsk'))).toBe(false)
  })

  it('rejects tar parent traversal, duplicates, and non-regular members', () => {
    expect(() => extractTarMember(gzTar('../evil', Buffer.from('x')), 'bsk')).toThrow(/traversal/)
    expect(() => extractTarMember(
      gzipSync(Buffer.concat([tarBlock('bsk', Buffer.from('a')), tarBlock('bsk', Buffer.from('b')), Buffer.alloc(1024)])),
      'bsk',
    )).toThrow(/duplicate/)
    expect(() => extractTarMember(gzTar('bsk', Buffer.from('a'), '2'), 'bsk')).toThrow(/unsupported type/)
    expect(() => extractTarMember(gzTar('other', Buffer.from('a')), 'bsk')).toThrow(/not found/)
  })

  it('rejects zip parent traversal, directories, and duplicates', () => {
    expect(() => extractZipMember(zipBuffer([{ name: '../evil', content: Buffer.from('x') }]), 'bsk.exe'))
      .toThrow(/traversal/)
    expect(() => extractZipMember(zipBuffer([{ name: 'dir/', content: Buffer.alloc(0) }, { name: 'bsk.exe', content: Buffer.from('x') }]), 'bsk.exe'))
      .not.toThrow()
    expect(() => extractZipMember(zipBuffer([
      { name: 'bsk.exe', content: Buffer.from('a') },
      { name: 'bsk.exe', content: Buffer.from('b') },
    ]), 'bsk.exe')).toThrow(/duplicate/)
    expect(() => extractZipMember(zipBuffer([
      { name: 'bsk.exe', content: Buffer.from('a'), mode: 0o120000 * 0x10000 },
    ]), 'bsk.exe')).toThrow(/not a regular file/)
    expect(() => extractZipMember(zipBuffer([{ name: 'other.exe', content: Buffer.from('a') }]), 'bsk.exe'))
      .toThrow(/not found/)
  })

  it('rejects archives outside the pinned byte bound', async () => {
    const root = fixtureRoot()
    const payload = Buffer.from('x'.repeat(1024))
    const archive = gzTar('bsk', payload)
    const fetchImpl = vi.fn(async () => ({
      ok: true, status: 200, arrayBuffer: async () => toArrayBuffer(archive),
    }))
    await expect(prepareBrowserSkillAssets('darwin-x64', { fetch: fetchImpl, root }))
      .rejects.toThrow(/bytes/)
  })

})
