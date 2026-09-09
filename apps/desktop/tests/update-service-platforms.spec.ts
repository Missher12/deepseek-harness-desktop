import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isDesktopUpdateSnapshot } from '../src/preload-api.ts'
import { desktopUpdateAssetName, desktopUpdateManifestName, type DesktopUpdateTarget } from '../src/update/release.ts'
import { DesktopUpdateService } from '../src/update/service.ts'
import { DesktopUpdateInstaller } from '../src/update/install.ts'
import { updatePayload } from './update-fixtures.ts'

const targets: DesktopUpdateTarget[] = [
  { platform: 'darwin', arch: 'x64', packageFormat: 'dmg' },
  { platform: 'win32', arch: 'x64', packageFormat: 'nsis' },
  { platform: 'linux', arch: 'x64', packageFormat: 'deb' },
  { platform: 'linux', arch: 'x64', packageFormat: 'appimage' },
]
const owned: Array<{ directory: string; service: DesktopUpdateService }> = []
afterEach(() => {
  for (const { directory, service } of owned.splice(0)) {
    service.dispose()
    rmSync(directory, { recursive: true, force: true })
  }
})

function fixture(target: DesktopUpdateTarget, response?: () => Response, desktopVersion = '0.5.8') {
  const bytes = updatePayload(target.packageFormat)
  const directory = mkdtempSync(join(tmpdir(), 'dsh-platform-updater-'))
  const assetName = desktopUpdateAssetName(desktopVersion, target)
  const manifestName = desktopUpdateManifestName(target)
  const url = `https://github.com/Missher12/deepseek-harness-desktop/releases/tag/desktop-v${desktopVersion}`
  const download = url.replace('/tag/', '/download/')
  const manifest = {
    ...(target.platform === 'darwin' ? { schema: 1, platform: 'darwin', arch: 'x64' } : { schema: 2, ...target }),
    desktopVersion, harnessVersion: '0.1.3-alpha.1', assetName,
    bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), releaseUrl: url,
  }
  const fetcher = vi.fn(async (input: string | URL | Request) => {
    const requested = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (requested.includes('/tags?')) return Response.json([{ name: 'dsh-v0.1.3-alpha.1' }])
    if (requested.includes('/releases?')) return Response.json([{
      draft: false, html_url: url, assets: [
        { name: manifestName, size: 512, browser_download_url: `${download}/${manifestName}` },
        { name: assetName, size: bytes.length, browser_download_url: `${download}/${assetName}` },
      ],
    }])
    if (requested === `${download}/${manifestName}`) return Response.json(manifest)
    if (requested === `${download}/${assetName}`) return response?.() ?? new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } })
    throw new Error('Unexpected request.')
  })
  const service = new DesktopUpdateService({
    platform: target.platform, arch: target.arch,
    ...(target.platform === 'linux' ? { resolveLinuxFormat: async () => target.packageFormat } : {}),
    runningDesktop: '0.5.7', includedHarness: '0.1.3-alpha.1', userData: directory, fetcher,
  })
  owned.push({ directory, service })
  return { service, directory, fetcher, manifest, bytes }
}

describe('native-selected update service', () => {
  it.each(['0.5.7', '0.5.6'])('never authorizes a %s reinstallation or downgrade after a failed recheck', async (desktopVersion) => {
    const { service, fetcher } = fixture(targets[1]!, undefined, desktopVersion)
    expect((await service.check(true)).phase).toBe('current')
    expect(service.canDownload()).toBe(false)
    fetcher.mockRejectedValue(new Error('Offline fixture'))
    expect((await service.check(true)).phase).toBe('error')
    expect(service.canDownload()).toBe(false)
    const requests = fetcher.mock.calls.length
    await expect(service.download()).rejects.toThrow(/No verified Desktop update/)
    expect(fetcher.mock.calls.length).toBe(requests)
    expect(service.getInstallDescriptor()).toBeNull()
  })

  it.each(targets)('streams exact $platform/$packageFormat bytes without a Content-Length requirement', async (target) => {
    const { service, bytes, manifest } = fixture(target)
    const observed: unknown[] = []
    service.subscribe((snapshot) => { observed.push(snapshot) })
    expect(await service.check(true)).toMatchObject({ phase: 'desktop-available', ...target })
    expect(await service.download()).toMatchObject({
      phase: 'ready', ...target, downloadProgress: 1, downloadedBytes: bytes.length,
      downloadTotalBytes: bytes.length, assetName: manifest.assetName,
      runningDesktop: '0.5.7', includedHarness: '0.1.3-alpha.1',
    })
    const descriptor = service.getInstallDescriptor()!
    expect(descriptor).toMatchObject({ target, bytes: bytes.length, sha256: manifest.sha256 })
    expect(readFileSync(descriptor.localPath)).toEqual(bytes)
    expect(observed.every(isDesktopUpdateSnapshot)).toBe(true)
    expect(JSON.stringify(service.getSnapshot())).not.toContain(descriptor.localPath)
    expect(JSON.stringify(service.getSnapshot())).not.toContain(manifest.sha256)
  })

  it('resolves Linux packaging lazily and never guesses an unknown format', async () => {
    const resolver = vi.fn(async () => 'unknown' as const)
    const directory = mkdtempSync(join(tmpdir(), 'dsh-unknown-updater-'))
    const fetcher = vi.fn(async () => Response.json([]))
    const service = new DesktopUpdateService({
      platform: 'linux', arch: 'x64', resolveLinuxFormat: resolver,
      runningDesktop: '0.5.7', includedHarness: '0.1.3-alpha.1', userData: directory, fetcher,
    })
    owned.push({ directory, service })
    expect(resolver).not.toHaveBeenCalled()
    expect(service.getSnapshot()).toMatchObject({ packageFormat: 'unknown', installAction: null, supportReason: 'detecting' })
    await service.check(true)
    expect(resolver).toHaveBeenCalledTimes(1)
    expect(service.getSnapshot()).toMatchObject({ packageFormat: 'unknown', installAction: null, supportReason: 'unknown-package' })
    expect(service.canDownload()).toBe(false)
    expect(service.getInstallDescriptor()).toBeNull()
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('cancels an incomplete stream, closes its reader, and only removes its own stage', async () => {
    const cancelled = vi.fn()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(100)) },
      cancel: cancelled,
    })
    const { service, directory } = fixture(targets[1]!, () => new Response(stream))
    const marker = join(directory, 'user-marker')
    writeFileSync(marker, 'keep')
    await service.check(true)
    const pending = service.download()
    await expect.poll(() => service.getSnapshot().downloadedBytes).toBe(100)
    expect(await service.cancelDownload()).toMatchObject({ phase: 'desktop-available', downloadedBytes: null })
    expect((await pending).phase).toBe('desktop-available')
    expect(cancelled).toHaveBeenCalledTimes(1)
    expect(readFileSync(marker, 'utf8')).toBe('keep')
    expect(readdirSync(join(directory, 'updates')).filter(name => name.startsWith('download-'))).toEqual([])
    expect(service.getInstallDescriptor()).toBeNull()
  })

  it('retains verified bytes through checks, manual reveal state and normal quit', async () => {
    const { service, bytes } = fixture(targets[2]!)
    await service.check(true)
    await service.download()
    const descriptor = service.getInstallDescriptor()!
    service.markManualInstallReady()
    expect((await service.check(true)).phase).toBe('manual-install-ready')
    expect(service.getInstallDescriptor()).toEqual(descriptor)
    service.dispose()
    expect(readFileSync(descriptor.localPath)).toEqual(bytes)
  })

  it('keeps a user download running when the startup background check arrives', async () => {
    const cancelled = vi.fn()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(100)) },
      cancel: cancelled,
    })
    const { service, fetcher } = fixture(targets[1]!, () => new Response(stream))
    await service.check(true)
    const pending = service.download()
    try {
      await expect.poll(() => service.getSnapshot().downloadedBytes).toBe(100)
      const requests = fetcher.mock.calls.length
      expect(await service.check(false)).toMatchObject({ phase: 'downloading', downloadedBytes: 100 })
      expect(cancelled).not.toHaveBeenCalled()
      expect(fetcher.mock.calls.length).toBe(requests)
    } finally {
      await service.cancelDownload()
      await pending
    }
  })

  it('rejects changed verified bytes before another native action without deleting the retained file', async () => {
    const { service } = fixture(targets[1]!)
    await service.check(true)
    await service.download()
    const descriptor = service.getInstallDescriptor()!
    writeFileSync(descriptor.localPath, Buffer.alloc(descriptor.bytes))
    await expect(service.verifyInstallDescriptor()).rejects.toThrow(/verif/i)
    expect(service.getInstallDescriptor()).toBeNull()
    expect(service.getSnapshot().phase).toBe('error')
    expect(existsSync(descriptor.localPath)).toBe(true)
  })

  it.each(['short', 'long', 'wrong-length', 'wrong-hash', 'wrong-format', 'html'] as const)('refuses %s bytes without install authority or incomplete-file residue', async (failure) => {
    const payload = updatePayload('nsis')
    const response = (): Response => {
      if (failure === 'short') return new Response(payload.subarray(0, 10))
      if (failure === 'long') return new Response(Buffer.concat([payload, Buffer.from('x')]))
      if (failure === 'wrong-length') return new Response(payload, { headers: { 'content-length': '7' } })
      if (failure === 'wrong-format') return new Response(Buffer.alloc(payload.length))
      if (failure === 'html') return new Response(payload, { headers: { 'content-type': 'text/html' } })
      return new Response(payload)
    }
    const { service, manifest, directory } = fixture(targets[1]!, response)
    if (failure === 'wrong-hash') manifest.sha256 = 'a'.repeat(64)
    if (failure === 'wrong-format') manifest.sha256 = createHash('sha256').update(Buffer.alloc(payload.length)).digest('hex')
    await service.check(true)
    await expect(service.download()).rejects.toThrow(/download failed/i)
    expect(service.getSnapshot().phase).toBe('error')
    expect(service.getInstallDescriptor()).toBeNull()
    expect(service.canDownload()).toBe(true)
    expect(readdirSync(join(directory, 'updates')).filter(name => name.startsWith('download-'))).toEqual([])
  })

  it('ignores an older check finishing after a newer operation even when its fetcher ignores abort', async () => {
    const { service, fetcher } = fixture(targets[1]!)
    const original = fetcher.getMockImplementation()!
    let resolveOlder!: (value: Response) => void
    const olderTags = new Promise<Response>((resolve) => { resolveOlder = resolve })
    fetcher.mockImplementationOnce(() => olderTags)
    const older = service.check(true)
    await expect.poll(() => fetcher.mock.calls.length).toBe(2)
    fetcher.mockImplementation(original)
    const current = await service.check(true)
    resolveOlder(Response.json([{ name: 'dsh-v99.0.0' }]))
    await older
    expect(service.getSnapshot()).toEqual(current)
    expect(service.getSnapshot().latestOfficialHarness).toBe('0.1.3-alpha.1')
  })

  it('does not expose a foreign architecture or a future official tag as an installable payload', async () => {
    const { service, manifest } = fixture(targets[1]!)
    Object.assign(manifest, { arch: 'arm64' })
    expect((await service.check(true)).phase).toBe('current')
    expect(service.canDownload()).toBe(false)
    expect(service.getInstallDescriptor()).toBeNull()
  })

  it.each(['confirmation', 'verification', 'handoff'] as const)('keeps native install authority stable during %s instead of starting a concurrent check', async (pauseAt) => {
    const { service, fetcher } = fixture(targets[1]!)
    await service.check(true)
    await service.download()
    let resume!: () => void
    const paused = new Promise<void>((resolve) => { resume = resolve })
    let entered = false
    const wait = async (): Promise<void> => { entered = true; await paused }
    const realVerify = service.verifyInstallDescriptor.bind(service)
    if (pauseAt === 'verification') vi.spyOn(service, 'verifyInstallDescriptor').mockImplementation(async () => { await wait(); return await realVerify() })
    const quit = vi.fn()
    const installer = new DesktopUpdateInstaller(service, {
      isPackaged: true,
      confirmSetup: async () => { if (pauseAt === 'confirmation') await wait(); return true },
      launchWindows: async () => { if (pauseAt === 'handoff') await wait() },
      launchMac: async () => undefined, revealLinux: async () => undefined, quit,
    })
    const installing = installer.install()
    try {
      await expect.poll(() => entered).toBe(true)
      const requests = fetcher.mock.calls.length
      expect((await service.check(true)).phase).toBe('ready')
      expect(fetcher.mock.calls.length).toBe(requests)
    } finally {
      resume()
    }
    expect(await installing).toEqual({ opened: true, status: 'handoff-requested', action: 'open-setup-wizard' })
    expect(quit).toHaveBeenCalledTimes(1)
  })
})
