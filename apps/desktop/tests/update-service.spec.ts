import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DesktopUpdateService } from '../src/update/service.ts'

const directories: string[] = []

function makeUserData(): string {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-desktop-update-'))
  directories.push(directory)
  return directory
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function requestUrl(input: string | URL | Request): string {
  if (typeof input === 'string') return input
  return input instanceof URL ? input.href : input.url
}

afterEach(() => {
  while (directories.length > 0) rmSync(directories.pop()!, { recursive: true, force: true })
})

describe('Desktop update service', () => {
  it('revalidates repeated manual checks with GitHub ETags', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = requestUrl(input)
      const headers = new Headers(init?.headers)
      const etag = url.includes('/tags') ? '"official-tags"' : '"desktop-releases"'
      if (headers.get('if-none-match') === etag) return new Response(null, { status: 304 })
      return new Response(JSON.stringify(url.includes('/tags') ? [{ name: 'dsh-v0.1.0-rc.8' }] : []), {
        status: 200,
        headers: { 'content-type': 'application/json', etag },
      })
    })
    const service = new DesktopUpdateService({
      runningDesktop: '0.1.9',
      includedHarness: '0.1.0-rc.5',
      userData: makeUserData(),
      fetcher,
    })

    expect((await service.check(true)).phase).toBe('upstream-available')
    expect((await service.check(true)).phase).toBe('upstream-available')
    expect(fetcher).toHaveBeenCalledTimes(4)
    expect(new Headers(fetcher.mock.calls[2]?.[1]?.headers).get('if-none-match')).toBe('"official-tags"')
    expect(new Headers(fetcher.mock.calls[3]?.[1]?.headers).get('if-none-match')).toBe('"desktop-releases"')
  })

  it('reports a newer official core without granting install authority', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = requestUrl(input)
      if (url.includes('/deepseek-ai/deepseek-harness/tags')) return json([{ name: 'dsh-v0.1.0-rc.8' }])
      if (url.includes('/Missher12/deepseek-harness-desktop/releases')) return json([])
      throw new Error(`unexpected URL: ${url}`)
    })
    const service = new DesktopUpdateService({
      runningDesktop: '0.1.9',
      includedHarness: '0.1.0-rc.5',
      userData: makeUserData(),
      fetcher,
    })

    expect(await service.check(true)).toMatchObject({
      phase: 'upstream-available',
      latestOfficialHarness: '0.1.0-rc.8',
      latestDesktop: null,
    })
    expect(service.canDownload()).toBe(false)
  })

  it('accepts a matching Desktop release manifest and verified asset', async () => {
    const payload = Buffer.from('fixture dmg bytes')
    const sha256 = createHash('sha256').update(payload).digest('hex')
    const manifest = {
      schema: 1,
      desktopVersion: '0.2.0',
      harnessVersion: '0.1.0-rc.8',
      platform: 'darwin',
      arch: 'x64',
      assetName: 'DeepSeek-Harness-0.2.0-mac-x64.dmg',
      bytes: payload.byteLength,
      sha256,
      releaseUrl: 'https://github.com/Missher12/deepseek-harness-desktop/releases/tag/desktop-v0.2.0',
    }
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = requestUrl(input)
      if (url.includes('/deepseek-ai/deepseek-harness/tags')) return json([{ name: 'dsh-v0.1.0-rc.8' }])
      if (url.endsWith('deepseek-harness-desktop-update.json')) return json(manifest)
      if (url.endsWith('.dmg')) return new Response(payload, { status: 200, headers: { 'content-length': String(payload.byteLength), 'content-type': 'application/x-apple-diskimage' } })
      if (url.includes('/Missher12/deepseek-harness-desktop/releases')) return json([{
        html_url: manifest.releaseUrl,
        draft: false,
        assets: [
          { name: 'deepseek-harness-desktop-update.json', size: 512, browser_download_url: 'https://github.com/Missher12/deepseek-harness-desktop/releases/download/desktop-v0.2.0/deepseek-harness-desktop-update.json' },
          { name: manifest.assetName, size: payload.byteLength, browser_download_url: `https://github.com/Missher12/deepseek-harness-desktop/releases/download/desktop-v0.2.0/${manifest.assetName}` },
        ],
      }])
      throw new Error(`unexpected URL: ${url}`)
    })
    const service = new DesktopUpdateService({
      runningDesktop: '0.1.9',
      includedHarness: '0.1.0-rc.5',
      userData: makeUserData(),
      fetcher,
    })

    expect(await service.check(true)).toMatchObject({ phase: 'desktop-available', latestDesktop: '0.2.0' })
    expect(service.canDownload()).toBe(true)
    const ready = await service.download()
    expect(ready).toMatchObject({ phase: 'ready', downloadProgress: 1 })
    expect(service.getVerifiedDownloadPath()).toMatch(/DeepSeek-Harness-0\.2\.0-mac-x64\.dmg$/)
    expect(existsSync(service.getVerifiedDownloadPath()!)).toBe(true)
  })

  it('deletes a staged download when SHA-256 verification fails', async () => {
    const payload = Buffer.from('tampered')
    const manifest = {
      schema: 1,
      desktopVersion: '0.2.0',
      harnessVersion: '0.1.0-rc.8',
      platform: 'darwin',
      arch: 'x64',
      assetName: 'DeepSeek-Harness-0.2.0-mac-x64.dmg',
      bytes: payload.byteLength,
      sha256: 'a'.repeat(64),
      releaseUrl: 'https://github.com/Missher12/deepseek-harness-desktop/releases/tag/desktop-v0.2.0',
    }
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = requestUrl(input)
      if (url.includes('/tags')) return json([])
      if (url.includes('/releases?')) return json([{
        html_url: manifest.releaseUrl,
        draft: false,
        assets: [
          { name: 'deepseek-harness-desktop-update.json', size: 512, browser_download_url: 'https://github.com/Missher12/deepseek-harness-desktop/releases/download/v/manifest.json' },
          { name: manifest.assetName, size: payload.byteLength, browser_download_url: `https://github.com/Missher12/deepseek-harness-desktop/releases/download/v/${manifest.assetName}` },
        ],
      }])
      if (url.endsWith('manifest.json')) return json(manifest)
      if (url.endsWith('.dmg')) return new Response(payload, { status: 200, headers: { 'content-length': String(payload.byteLength) } })
      throw new Error(`unexpected URL: ${url}`)
    })
    const service = new DesktopUpdateService({
      runningDesktop: '0.1.9',
      includedHarness: '0.1.0-rc.5',
      userData: makeUserData(),
      fetcher,
    })
    await service.check(true)

    await expect(service.download()).rejects.toThrow(/checksum/i)
    expect(service.getSnapshot().phase).toBe('error')
    expect(service.getVerifiedDownloadPath()).toBeNull()
  })

  it('rechecks a cached newer Desktop release after restart before suppressing the daily request', async () => {
    const userData = makeUserData()
    const manifest = {
      schema: 1,
      desktopVersion: '0.2.0',
      harnessVersion: '0.1.0-rc.8',
      platform: 'darwin',
      arch: 'x64',
      assetName: 'DeepSeek-Harness-0.2.0-mac-x64.dmg',
      bytes: 123,
      sha256: 'a'.repeat(64),
      releaseUrl: 'https://github.com/Missher12/deepseek-harness-desktop/releases/tag/desktop-v0.2.0',
    }
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = requestUrl(input)
      if (url.includes('/tags')) return json([{ name: 'dsh-v0.1.0-rc.8' }])
      if (url.endsWith('deepseek-harness-desktop-update.json')) return json(manifest)
      if (url.includes('/releases?')) return json([{
        html_url: manifest.releaseUrl,
        draft: false,
        assets: [
          {
            name: 'deepseek-harness-desktop-update.json',
            size: 512,
            browser_download_url: `${manifest.releaseUrl.replace('/tag/', '/download/')}/deepseek-harness-desktop-update.json`,
          },
          {
            name: manifest.assetName,
            size: manifest.bytes,
            browser_download_url: `${manifest.releaseUrl.replace('/tag/', '/download/')}/${manifest.assetName}`,
          },
        ],
      }])
      throw new Error(`unexpected URL: ${url}`)
    })
    const first = new DesktopUpdateService({
      runningDesktop: '0.1.9',
      includedHarness: '0.1.0-rc.5',
      userData,
      fetcher,
    })
    expect((await first.check(true)).phase).toBe('desktop-available')
    fetcher.mockClear()

    const restarted = new DesktopUpdateService({
      runningDesktop: '0.1.9',
      includedHarness: '0.1.0-rc.5',
      userData,
      fetcher,
    })

    expect((await restarted.check(false)).phase).toBe('desktop-available')
    expect(fetcher).toHaveBeenCalled()
    expect(restarted.canDownload()).toBe(true)
  })
})
