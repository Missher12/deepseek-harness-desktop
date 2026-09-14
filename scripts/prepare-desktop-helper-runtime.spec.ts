import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { crc32, gzipSync } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { prepareDesktopHelperRuntime, verifyDesktopHelperRuntime } from './prepare-desktop-helper-runtime.ts'
import type { HelperRuntimePlatform } from './prepare-desktop-helper-runtime.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const nodeBytes = Buffer.from('inert Node fixture, never execute\n')
const licenseBytes = Buffer.from('Fixture license\n')
interface ArchiveEntry { path: string; bytes?: Buffer; type?: string; link?: string; declaredSize?: number }

// Tiny independent archive fixtures retain unsafe names instead of normalizing them through an extraction library.
function tar(entries: ArchiveEntry[]): Buffer {
  const chunks: Buffer[] = []
  for (const entry of entries) {
    const content = entry.bytes ?? Buffer.alloc(0)
    const header = Buffer.alloc(512)
    header.write(entry.path, 0, 100, 'utf8')
    header.write('0000755\0', 100, 8)
    header.write('0000000\0', 108, 8)
    header.write('0000000\0', 116, 8)
    header.write((entry.declaredSize ?? content.length).toString(8).padStart(11, '0') + '\0', 124, 12)
    header.write('00000000000\0', 136, 12)
    header.fill(32, 148, 156)
    header.write(entry.type ?? '0', 156, 1)
    header.write(entry.link ?? '', 157, 100)
    header.write('ustar\0', 257, 6)
    header.write('00', 263, 2)
    const checksum = header.reduce((sum, value) => sum + value, 0)
    header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8)
    chunks.push(header, content, Buffer.alloc((512 - content.length % 512) % 512))
  }
  return gzipSync(Buffer.concat([...chunks, Buffer.alloc(1024)]))
}

function zip(entries: ArchiveEntry[]): Buffer {
  const data: Buffer[] = []
  const directory: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.path)
    const bytes = entry.bytes ?? Buffer.alloc(0)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50)
    local.writeUInt16LE(20, 4)
    local.writeUInt32LE(crc32(bytes), 14)
    local.writeUInt32LE(bytes.length, 18)
    local.writeUInt32LE(bytes.length, 22)
    local.writeUInt16LE(name.length, 26)
    data.push(local, name, bytes)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50)
    central.writeUInt16LE(0x0314, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt32LE(crc32(bytes), 16)
    central.writeUInt32LE(bytes.length, 20)
    central.writeUInt32LE(bytes.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38)
    central.writeUInt32LE(offset, 42)
    directory.push(central, name)
    offset += local.length + name.length + bytes.length
  }
  const central = Buffer.concat(directory)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(central.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...data, central, end])
}

async function fixture(platform: HelperRuntimePlatform = 'darwin', extras: ArchiveEntry[] = []) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-helper-runtime-'))
  roots.push(root)
  const folder = `node-v24.17.0-${platform === 'win32' ? 'win' : platform}-x64`
  const archiveName = `${folder}.${platform === 'win32' ? 'zip' : 'tar.gz'}`
  const entries = [
    { path: `${folder}/${platform === 'win32' ? 'node.exe' : 'bin/node'}`, bytes: nodeBytes },
    { path: `${folder}/LICENSE`, bytes: licenseBytes },
    { path: `${folder}/unused.txt`, bytes: Buffer.from('not copied') },
    ...extras,
  ]
  const archive = platform === 'win32' ? zip(entries) : tar(entries)
  const sums = Buffer.from(`${hash(archive)}  ${archiveName}\n`)
  const archivePath = join(root, archiveName)
  const shasumsPath = join(root, 'SHASUMS256.txt')
  await writeFile(archivePath, archive)
  await writeFile(shasumsPath, sums)
  return { root, folder, archiveName, archive, sums, archivePath, shasumsPath,
    options: { platform, arch: 'x64' as const, outputDirectory: join(root, 'output'), source: { kind: 'files' as const, archivePath, shasumsPath } } }
}
const runner = () => vi.fn(async () => ({ stdout: 'v24.17.0\n', stderr: '', exitCode: 0 }))

describe('independent Desktop update-helper Node runtime', () => {
  it.each(['darwin', 'win32', 'linux'] as const)('copies only the %s Node executable, license and provenance', async (platform) => {
    const f = await fixture(platform)
    const runVersion = runner()
    const receipt = await prepareDesktopHelperRuntime(f.options, { runVersion })
    expect(await readFile(receipt.runtimePath)).toEqual(nodeBytes)
    expect(await readdir(f.options.outputDirectory)).toEqual(expect.arrayContaining([platform === 'win32' ? 'node.exe' : 'node', 'LICENSE', 'source.json']))
    expect(await readdir(f.options.outputDirectory)).toHaveLength(3)
    expect(receipt).toMatchObject({ platform, arch: 'x64', nodeVersion: '24.17.0' })
    expect(receipt.files.find(file => file.path === 'LICENSE')).toMatchObject({ bytes: licenseBytes.length, sha256: hash(licenseBytes) })
    const native = process.platform === platform && process.arch === 'x64'
    expect(receipt.execution).toBe(native ? 'injected-runner-verified' : 'cross-target-unverified')
    const verified = await verifyDesktopHelperRuntime(f.options.outputDirectory, { platform, arch: 'x64' })
    expect(verified).toMatchObject({ validation: 'read-only', execution: receipt.execution })
    expect(runVersion).toHaveBeenCalledTimes(native ? 1 : 0)
    const source: unknown = JSON.parse(await readFile(receipt.sourceManifestPath, 'utf8'))
    expect(source).toMatchObject({ archiveName: f.archiveName, archiveSha256: hash(f.archive), nodeVersion: '24.17.0' })
  })
  it('revalidates prepared bytes without downloading, copying or changing the original execution status', async () => {
    const platform = process.platform === 'linux' ? 'darwin' : 'linux'
    const f = await fixture(platform)
    const runVersion = runner()
    const original = await prepareDesktopHelperRuntime(f.options, { runVersion })
    const verified = await verifyDesktopHelperRuntime(f.options.outputDirectory, { platform, arch: 'x64' })
    expect(verified).toMatchObject({ validation: 'read-only', execution: 'cross-target-unverified', files: original.files })
    expect(runVersion).not.toHaveBeenCalled()
    await expect(verifyDesktopHelperRuntime(f.options.outputDirectory, { platform: 'win32', arch: 'x64' })).rejects.toThrow(/target|platform|manifest/iu)
    await writeFile(join(f.options.outputDirectory, 'LICENSE'), 'tampered license')
    await expect(verifyDesktopHelperRuntime(f.options.outputDirectory, { platform, arch: 'x64' })).rejects.toThrow(/hash|bytes/iu)
  })
  it('rejects a changed manifest version and unlisted files during read-only verification', async () => {
    const f = await fixture('linux')
    const prepared = await prepareDesktopHelperRuntime(f.options, { runVersion: runner() })
    const original = await readFile(prepared.sourceManifestPath, 'utf8')
    await writeFile(prepared.sourceManifestPath, original.replace('24.17.0', '24.18.0'))
    await expect(verifyDesktopHelperRuntime(f.options.outputDirectory, { platform: 'linux', arch: 'x64' })).rejects.toThrow(/version|manifest/iu)
    await writeFile(prepared.sourceManifestPath, original)
    await writeFile(join(f.options.outputDirectory, 'unlisted'), 'do not remove')
    await expect(verifyDesktopHelperRuntime(f.options.outputDirectory, { platform: 'linux', arch: 'x64' })).rejects.toThrow(/files|inventory/iu)
    expect(await readFile(join(f.options.outputDirectory, 'unlisted'), 'utf8')).toBe('do not remove')
  })
  it('prepares an offline cross-target CLI fixture and reuses that directory through read-only verification', async () => {
    const platform = process.platform === 'linux' ? 'darwin' : 'linux'
    const f = await fixture(platform)
    const script = fileURLToPath(new URL('./prepare-desktop-helper-runtime.ts', import.meta.url))
    const args = ['--import', 'tsx/esm', script, '--platform', platform, '--output', f.options.outputDirectory,
      '--archive', f.archivePath, '--shasums', f.shasumsPath]
    const first: unknown = JSON.parse(execFileSync(process.execPath, args, { encoding: 'utf8', timeout: 15000 }))
    expect(first).toMatchObject({ validation: 'prepared', execution: 'cross-target-unverified' })
    const second: unknown = JSON.parse(execFileSync(process.execPath, args, { encoding: 'utf8', timeout: 15000 }))
    expect(second).toMatchObject({ validation: 'read-only', execution: 'cross-target-unverified' })
  })
  it('rejects changed archive bytes before creating output', async () => {
    const f = await fixture()
    await writeFile(f.archivePath, Buffer.from('modified'))
    await expect(prepareDesktopHelperRuntime(f.options, { runVersion: runner() })).rejects.toThrow(/checksum/iu)
    expect(await readdir(f.root)).not.toContain('output')
  })
  it('rejects an archive selected for a different platform', async () => {
    const f = await fixture('darwin')
    await expect(prepareDesktopHelperRuntime({ ...f.options, platform: 'win32' })).rejects.toThrow(/archive.*name|platform/iu)
  })
  it.each(['../escape', '/absolute', 'C:/escape', 'node-v24.17.0-darwin-x64/../../escape'])('rejects tar path %s without extracting it', async (path) => {
    const f = await fixture('darwin', [{ path, bytes: Buffer.from('unsafe') }])
    await expect(prepareDesktopHelperRuntime(f.options, { runVersion: runner() })).rejects.toThrow(/path|root/iu)
    expect(await readdir(f.root)).not.toContain('output')
  })
  it('rejects escaping tar links and a symlink standing in for the executable', async () => {
    for (const entry of [
      { path: 'node-v24.17.0-darwin-x64/bin/npm', type: '2', link: '../../../../outside' },
      { path: 'node-v24.17.0-darwin-x64/bin/node', type: '2', link: '../LICENSE' },
    ]) {
      const f = await fixture('darwin', [entry])
      await expect(prepareDesktopHelperRuntime(f.options, { runVersion: runner() })).rejects.toThrow(/link|duplicate|regular/iu)
    }
  })
  it('accepts safe unused npm links while copying no linked files', async () => {
    const f = await fixture('darwin', [{ path: 'node-v24.17.0-darwin-x64/bin/npm', type: '2', link: '../lib/node_modules/npm/bin/npm-cli.js' }])
    const receipt = await prepareDesktopHelperRuntime(f.options, { runVersion: runner() })
    expect(receipt.files.map(file => file.path)).not.toContain('npm')
  })
  it('rejects unsafe ZIP names without extracting to the requested path', async () => {
    const f = await fixture('win32', [{ path: '../escape', bytes: Buffer.from('unsafe') }])
    await expect(prepareDesktopHelperRuntime(f.options)).rejects.toThrow(/path|relative/iu)
    expect(await readdir(f.root)).not.toContain('output')
  })
  it('refuses an existing output without changing its files', async () => {
    const f = await fixture()
    await mkdir(f.options.outputDirectory)
    await writeFile(join(f.options.outputDirectory, 'keep.txt'), 'keep')
    await expect(prepareDesktopHelperRuntime(f.options, { runVersion: runner() })).rejects.toThrow(/exist/iu)
    expect(await readFile(join(f.options.outputDirectory, 'keep.txt'), 'utf8')).toBe('keep')
  })
  it('rejects a native executable reporting the wrong version and retains the owned failure directory', async () => {
    if (process.arch !== 'x64' || !['darwin', 'win32', 'linux'].includes(process.platform)) return
    const f = await fixture(process.platform as HelperRuntimePlatform)
    await expect(prepareDesktopHelperRuntime(f.options, { runVersion: async () => ({ stdout: 'v22.0.0\n', stderr: '', exitCode: 0 }) })).rejects.toThrow(/version/iu)
    expect(await readdir(f.options.outputDirectory)).toContain(process.platform === 'win32' ? 'node.exe' : 'node')
    expect(await readdir(f.options.outputDirectory)).not.toContain('source.json')
  })
  it('rejects executable bytes changed during a successful injected version probe', async () => {
    if (process.arch !== 'x64' || !['darwin', 'win32', 'linux'].includes(process.platform)) return
    const f = await fixture(process.platform as HelperRuntimePlatform)
    const runVersion = async (path: string) => {
      await writeFile(path, 'changed during probe')
      return { stdout: 'v24.17.0\n', stderr: '', exitCode: 0 }
    }
    await expect(prepareDesktopHelperRuntime(f.options, { runVersion })).rejects.toThrow(/changed|copied.*hash/iu)
    expect(await readdir(f.options.outputDirectory)).not.toContain('source.json')
  })
  it('reuses only a checksum-verified cache, with exclusive outputs and fixed official URLs', async () => {
    const f = await fixture()
    const fetch = vi.fn(async (url: string) => new Response(new Uint8Array(url.endsWith('/SHASUMS256.txt') ? f.sums : f.archive)))
    const options = { ...f.options, source: { kind: 'download' as const, cacheDirectory: join(f.root, 'cache') } }
    await prepareDesktopHelperRuntime(options, { fetch, runVersion: runner() })
    await prepareDesktopHelperRuntime({ ...options, outputDirectory: join(f.root, 'second') }, { fetch, runVersion: runner() })
    expect(fetch.mock.calls.map(call => call[0])).toEqual([
      'https://nodejs.org/download/release/v24.17.0/SHASUMS256.txt',
      `https://nodejs.org/download/release/v24.17.0/${f.archiveName}`,
    ])
    await writeFile(join(f.root, 'cache', f.folder, f.archiveName), 'corrupt')
    await expect(prepareDesktopHelperRuntime({ ...options, outputDirectory: join(f.root, 'third') }, { fetch, runVersion: runner() })).rejects.toThrow(/checksum/iu)
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  it('rejects an invalid downloaded checksum listing before requesting the archive', async () => {
    const f = await fixture()
    const fetch = vi.fn(async () => new Response('no archive checksum here'))
    const options = { ...f.options, source: { kind: 'download' as const, cacheDirectory: join(f.root, 'cache') } }
    await expect(prepareDesktopHelperRuntime(options, { fetch })).rejects.toThrow(/checksum/iu)
    expect(fetch).toHaveBeenCalledOnce()
  })
  it('cancels a rejected oversized response before returning the error', async () => {
    const f = await fixture()
    const cancel = vi.fn(async () => { throw new Error('injected cancellation failure') })
    const response = new Response(new ReadableStream<Uint8Array>({ cancel }), { headers: { 'content-length': '1048577' } })
    const fetch = vi.fn(async () => response)
    const options = { ...f.options, source: { kind: 'download' as const, cacheDirectory: join(f.root, 'cache') } }
    await expect(prepareDesktopHelperRuntime(options, { fetch })).rejects.toThrow(/byte limit/iu)
    expect(cancel).toHaveBeenCalledOnce()
  })
  it('rejects unsupported architecture before reading any source', async () => {
    const f = await fixture()
    await expect(prepareDesktopHelperRuntime({ ...f.options, arch: 'arm64' })).rejects.toThrow(/architecture/iu)
    expect(await readdir(f.root)).not.toContain('output')
  })
  it('rejects duplicate checksum entries, oversized executable metadata and a missing license', async () => {
    const f = await fixture()
    await writeFile(f.shasumsPath, Buffer.concat([f.sums, f.sums]))
    await expect(prepareDesktopHelperRuntime(f.options)).rejects.toThrow(/ambiguous/iu)
    for (const entries of [
      [{ path: `${f.folder}/bin/node`, bytes: nodeBytes, declaredSize: 268435457 }],
      [{ path: `${f.folder}/bin/node`, bytes: nodeBytes }],
    ]) {
      const archive = tar(entries)
      await writeFile(f.archivePath, archive)
      await writeFile(f.shasumsPath, `${hash(archive)}  ${f.archiveName}\n`)
      await expect(prepareDesktopHelperRuntime(f.options)).rejects.toThrow(/bounded|missing.*LICENSE/iu)
    }
    expect(await readdir(f.root)).not.toContain('output')
  })
  it('retains the first download error and its exclusive partial file without overwriting an incomplete cache', async () => {
    const f = await fixture()
    const firstError = new Error('injected connection failure')
    const fetch = vi.fn(async () => { throw firstError })
    const options = { ...f.options, source: { kind: 'download' as const, cacheDirectory: join(f.root, 'cache') } }
    await expect(prepareDesktopHelperRuntime(options, { fetch })).rejects.toBe(firstError)
    const files = await readdir(join(f.root, 'cache', f.folder))
    expect(files.some(name => name.includes('.partial-'))).toBe(true)
    await expect(prepareDesktopHelperRuntime(options, { fetch })).rejects.toThrow(/incomplete|cache/iu)
    expect(fetch).toHaveBeenCalledOnce()
    expect(await readdir(f.root)).not.toContain('output')
  })
})
