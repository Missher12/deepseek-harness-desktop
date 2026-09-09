import { createHash, timingSafeEqual } from 'node:crypto'
import { closeSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  compareVersions,
  desktopUpdateManifestName,
  parseOfficialHarnessTag,
  resolveDesktopUpdateTarget,
  selectUpdateAvailability,
  validateDesktopUpdateManifest,
  type DesktopUpdateManifest,
  type DesktopUpdateTarget,
  type VerifiedDesktopUpdate,
} from './release.ts'
import { createDesktopUpdatePresentation, type DesktopUpdateSnapshot, type DesktopUpdateSnapshotFields } from './contracts.ts'
import { verifyDesktopUpdateFile } from './verification.ts'
export type { DesktopUpdateSnapshot } from './contracts.ts'

interface ReleaseAsset {
  name: string
  size: number
  browser_download_url: string
}

interface AcceptedDesktopRelease {
  manifest: DesktopUpdateManifest
  assetUrl: string
}

export interface DesktopUpdateServiceOptions {
  platform?: string
  arch?: string
  resolveLinuxFormat?: () => Promise<'deb' | 'appimage' | 'unknown'>
  runningDesktop: string
  includedHarness: string
  userData: string
  fetcher?: typeof fetch
  now?: () => number
}

const OFFICIAL_TAGS_URL = 'https://api.github.com/repos/deepseek-ai/deepseek-harness/tags?per_page=30'
const DESKTOP_RELEASES_URL = 'https://api.github.com/repos/Missher12/deepseek-harness-desktop/releases?per_page=10'
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000
const MAX_JSON_BYTES = 1_048_576
const ALLOWED_DOWNLOAD_HOSTS = new Set([
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
])

function isAllowedReleaseUrl(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || !ALLOWED_DOWNLOAD_HOSTS.has(url.hostname)
      || url.username !== '' || url.password !== '' || url.port !== '') return false
    return url.hostname !== 'github.com'
      || url.pathname.startsWith('/Missher12/deepseek-harness-desktop/releases/download/')
  } catch {
    return false
  }
}

async function boundedText(response: Response, limit: number): Promise<string> {
  const contentLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > limit) throw new Error('update response exceeded its size limit')
  if (response.body === null) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    received += value.byteLength
    if (received > limit) {
      await reader.cancel()
      throw new Error('update response exceeded its size limit')
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks.map(chunk => Buffer.from(chunk))).toString('utf8')
}

function newestVersion(values: readonly string[]): string | null {
  let newest: string | null = null
  for (const value of values) {
    if (newest === null || compareVersions(value, newest) === 1) newest = value
  }
  return newest
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isReleaseAsset(value: unknown): value is ReleaseAsset {
  if (!isRecord(value)) return false
  return typeof value.name === 'string'
    && Number.isSafeInteger(value.size)
    && typeof value.browser_download_url === 'string'
}

/** Main-process owner of update discovery and verified download state. */
export class DesktopUpdateService {
  readonly #fetcher: typeof fetch
  readonly #now: () => number
  readonly #userData: string
  readonly #platform: string
  readonly #arch: string
  readonly #resolveLinuxFormat: () => Promise<'deb' | 'appimage' | 'unknown'>
  #linuxFormat: Promise<'deb' | 'appimage' | 'unknown'> | null = null
  #target: DesktopUpdateTarget | null
  #snapshot: DesktopUpdateSnapshot
  #accepted: AcceptedDesktopRelease | null = null
  #verified: VerifiedDesktopUpdate | null = null
  #manualReady = false
  #activeAbort: AbortController | null = null
  #downloadTask: Promise<DesktopUpdateSnapshot> | null = null
  #disposed = false
  #installTransaction = false
  readonly #jsonCache = new Map<string, { etag: string; value: unknown }>()
  readonly #listeners = new Set<(snapshot: DesktopUpdateSnapshot) => void>()

  constructor(options: DesktopUpdateServiceOptions) {
    this.#fetcher = options.fetcher ?? fetch
    this.#now = options.now ?? Date.now
    this.#userData = options.userData
    this.#platform = options.platform ?? process.platform
    this.#arch = options.arch ?? process.arch
    this.#resolveLinuxFormat = options.resolveLinuxFormat ?? (() => Promise.resolve('unknown'))
    this.#target = resolveDesktopUpdateTarget(this.#platform, this.#arch)
    this.#snapshot = {
      ...createDesktopUpdatePresentation(this.#platform, this.#arch),
      phase: 'idle',
      runningDesktop: options.runningDesktop,
      includedHarness: options.includedHarness,
      latestOfficialHarness: null,
      latestDesktop: null,
      lastCheckedAt: null,
      downloadProgress: null,
      message: null,
      assetName: null, downloadedBytes: null, downloadTotalBytes: null,
    }
    this.#loadCache()
  }

  getSnapshot(): DesktopUpdateSnapshot {
    return { ...this.#snapshot }
  }

  subscribe(listener: (snapshot: DesktopUpdateSnapshot) => void): () => void {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  canDownload(): boolean {
    return !this.#disposed && !this.#installTransaction && this.#target !== null && this.#accepted !== null
      && compareVersions(this.#accepted.manifest.desktopVersion, this.#snapshot.runningDesktop) === 1
      && (this.#snapshot.phase === 'desktop-available' || this.#snapshot.phase === 'error' && this.#verified === null)
  }

  getVerifiedDownloadPath(): string | null {
    return this.#verified?.localPath ?? null
  }

  getInstallDescriptor(): VerifiedDesktopUpdate | null {
    if (this.#disposed || this.#verified === null || !['ready', 'manual-install-ready'].includes(this.#snapshot.phase)) return null
    return { ...this.#verified, target: { ...this.#verified.target } }
  }

  /** Hold the selected verified payload stable across confirmation, verification and native preparation. */
  beginInstallTransaction(): () => void {
    if (this.#installTransaction || this.getInstallDescriptor() === null) throw new Error('No verified update is available for installation.')
    this.#installTransaction = true
    let released = false
    return () => {
      if (released) return
      released = true
      this.#installTransaction = false
    }
  }

  async verifyInstallDescriptor(): Promise<VerifiedDesktopUpdate> {
    const descriptor = this.getInstallDescriptor()
    if (descriptor === null) throw new Error('No verified Desktop update is ready.')
    try {
      await verifyDesktopUpdateFile(descriptor)
      if (this.#disposed || this.#verified?.localPath !== descriptor.localPath) throw new Error('Update state changed.')
      return descriptor
    } catch {
      this.#verified = null
      this.#manualReady = false
      this.#set({ phase: 'error', message: 'Desktop update verification failed. Download the package again.' })
      throw new Error('Desktop update verification failed. Download the package again.')
    }
  }

  markManualInstallReady(): void {
    if (this.getInstallDescriptor()?.target.platform !== 'linux') throw new Error('No verified Linux package is ready.')
    this.#manualReady = true
    this.#set({ phase: 'manual-install-ready', message: null })
  }

  reportInstallFailure(): void {
    if (this.#verified === null) return
    this.#set({ ...this.#retainedState(), message: 'Could not open the verified installation package. Try again.' })
  }

  /** Mark a verified payload as handed to the native installer flow. */
  beginInstall(): string {
    if (this.#snapshot.phase !== 'ready' || this.#verified === null || this.#verified.target.platform === 'linux') {
      throw new Error('No verified Desktop update is ready to install.')
    }
    this.#set({ phase: 'installing', message: null })
    return this.#verified.localPath
  }

  async check(manual = false): Promise<DesktopUpdateSnapshot> {
    if (this.#disposed || this.#installTransaction || this.#snapshot.phase === 'installing') return this.getSnapshot()
    if (!manual && this.#downloadTask !== null) return this.getSnapshot()
    if (this.#downloadTask !== null) await this.cancelDownload()
    const cachedDesktopNeedsRevalidation = this.#accepted === null
      && this.#snapshot.latestDesktop !== null
      && compareVersions(this.#snapshot.latestDesktop, this.#snapshot.runningDesktop) === 1
    if (!manual && !cachedDesktopNeedsRevalidation && this.#snapshot.supportReason !== 'detecting' && this.#snapshot.lastCheckedAt !== null
      && this.#now() - this.#snapshot.lastCheckedAt < CHECK_INTERVAL_MS) return this.getSnapshot()
    this.#activeAbort?.abort()
    const abort = new AbortController()
    this.#activeAbort = abort
    this.#set({ phase: 'checking', message: null, downloadProgress: null, downloadedBytes: null, downloadTotalBytes: null })
    const timer = setTimeout(() => { abort.abort() }, 10_000)
    timer.unref()
    try {
      if (this.#platform === 'linux' && this.#arch === 'x64') {
        this.#linuxFormat ??= this.#resolveLinuxFormat().catch(() => 'unknown' as const)
        const format = await this.#linuxFormat
        abort.signal.throwIfAborted()
        if (!this.#current(abort)) return this.getSnapshot()
        this.#target = resolveDesktopUpdateTarget(this.#platform, this.#arch, format)
        this.#snapshot = { ...this.#snapshot, ...createDesktopUpdatePresentation(this.#platform, this.#arch, format) }
      }
      const [tags, releases] = await Promise.all([
        this.#fetchJson(OFFICIAL_TAGS_URL, abort.signal),
        this.#fetchJson(DESKTOP_RELEASES_URL, abort.signal),
      ])
      const tagNames = Array.isArray(tags)
        ? tags.flatMap((value) => {
          if (!isRecord(value) || typeof value.name !== 'string') return []
          const version = parseOfficialHarnessTag(value.name)
          return version === null ? [] : [version]
        })
        : []
      const latestOfficialHarness = newestVersion(tagNames)
      const accepted = await this.#selectDesktopRelease(releases, abort.signal)
      abort.signal.throwIfAborted()
      if (!this.#current(abort)) return this.getSnapshot()
      this.#accepted = accepted
      const phase = selectUpdateAvailability({
        runningDesktop: this.#snapshot.runningDesktop,
        includedHarness: this.#snapshot.includedHarness,
        latestOfficialHarness,
        desktopManifest: accepted?.manifest ?? null,
      })
      this.#set({
        phase,
        latestOfficialHarness,
        latestDesktop: accepted?.manifest.desktopVersion ?? null,
        lastCheckedAt: this.#now(),
        assetName: accepted?.manifest.assetName ?? null,
        ...this.#retainedState(),
        message: null,
      })
      await this.#persistCache()
      return this.getSnapshot()
    } catch {
      if (this.#activeAbort !== abort) return this.getSnapshot()
      const message = abort.signal.aborted ? 'Update check timed out. Try again.' : 'Update check failed. Check your connection and try again.'
      this.#set({ phase: 'error', ...this.#retainedState(), message })
      return this.getSnapshot()
    } finally {
      clearTimeout(timer)
      if (this.#activeAbort === abort) this.#activeAbort = null
    }
  }

  async download(): Promise<DesktopUpdateSnapshot> {
    if (!this.canDownload() || this.#accepted === null || this.#target === null) throw new Error('No verified Desktop update is available.')
    const task = this.#downloadAccepted(this.#accepted, this.#target)
    this.#downloadTask = task
    try {
      return await task
    } finally {
      if (this.#downloadTask === task) this.#downloadTask = null
    }
  }

  async cancelDownload(): Promise<DesktopUpdateSnapshot> {
    if (this.#downloadTask !== null && ['downloading', 'verifying'].includes(this.#snapshot.phase)) {
      this.#activeAbort?.abort('cancelled')
      await this.#downloadTask.catch(() => undefined)
    }
    return this.getSnapshot()
  }

  async #downloadAccepted(accepted: AcceptedDesktopRelease, target: DesktopUpdateTarget): Promise<DesktopUpdateSnapshot> {
    this.#activeAbort?.abort()
    const abort = new AbortController()
    this.#activeAbort = abort
    const timer = setTimeout(() => { abort.abort('timeout') }, 10 * 60 * 1000)
    timer.unref()
    this.#set({ phase: 'downloading', downloadProgress: 0, downloadedBytes: 0,
      downloadTotalBytes: accepted.manifest.bytes, assetName: accepted.manifest.assetName,
      latestDesktop: accepted.manifest.desktopVersion, message: null })
    let stagingDirectory: string | undefined
    let fd: number | undefined
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    let complete = false
    const stopReader = (): void => { void reader?.cancel().catch(() => undefined) }
    abort.signal.addEventListener('abort', stopReader, { once: true })
    try {
      const updateRoot = join(this.#userData, 'updates')
      mkdirSync(updateRoot, { recursive: true, mode: 0o700 })
      if (!lstatSync(updateRoot).isDirectory()) throw new Error('Unsafe update directory.')
      stagingDirectory = mkdtempSync(join(updateRoot, 'download-'))
      const destination = join(stagingDirectory, accepted.manifest.assetName)
      if (!isAllowedReleaseUrl(accepted.assetUrl)) throw new Error('Desktop asset URL is not allowlisted.')
      const response = await this.#fetchAllowedReleaseAsset(accepted.assetUrl, abort.signal, 'application/octet-stream')
      abort.signal.throwIfAborted()
      if (!response.ok || response.body === null) throw new Error(`Desktop download returned HTTP ${String(response.status)}.`)
      const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
      if (contentType !== undefined && contentType !== ''
        && !['application/octet-stream', 'application/x-apple-diskimage', 'application/vnd.microsoft.portable-executable',
          'application/x-msdownload', 'application/vnd.debian.binary-package', 'application/x-debian-package', 'application/x-executable'].includes(contentType)) {
        throw new Error('Desktop download media type was not a native package.')
      }
      const declaredLength = response.headers.get('content-length')
      if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) !== accepted.manifest.bytes)) {
        throw new Error('Desktop download size did not match the release manifest.')
      }
      fd = openSync(destination, 'wx', 0o600)
      reader = response.body.getReader()
      const hash = createHash('sha256')
      let received = 0
      while (true) {
        const { done, value } = await reader.read()
        abort.signal.throwIfAborted()
        if (done) break
        received += value.byteLength
        if (received > accepted.manifest.bytes) throw new Error('Desktop download exceeded the manifest byte count.')
        const chunk = Buffer.from(value)
        hash.update(chunk)
        let offset = 0
        while (offset < chunk.length) {
          const written = writeSync(fd, chunk, offset, chunk.length - offset)
          if (written <= 0) throw new Error('Could not write update bytes.')
          offset += written
        }
        if (this.#current(abort)) this.#set({ downloadProgress: received / accepted.manifest.bytes, downloadedBytes: received })
      }
      closeSync(fd)
      fd = undefined
      if (received !== accepted.manifest.bytes) throw new Error('Desktop download byte count did not match the manifest.')
      if (this.#current(abort)) this.#set({ phase: 'verifying', downloadProgress: 1 })
      const actual = Buffer.from(hash.digest('hex'), 'hex')
      const expected = Buffer.from(accepted.manifest.sha256, 'hex')
      if (actual.byteLength !== expected.byteLength || !timingSafeEqual(actual, expected)) {
        throw new Error('Desktop update checksum verification failed.')
      }
      const descriptor: VerifiedDesktopUpdate = {
        target: { ...target }, desktopVersion: accepted.manifest.desktopVersion,
        harnessVersion: accepted.manifest.harnessVersion, assetName: accepted.manifest.assetName,
        localPath: destination, stagingDirectory, bytes: received, sha256: accepted.manifest.sha256,
      }
      await verifyDesktopUpdateFile(descriptor, abort.signal)
      if (!this.#current(abort)) throw new Error('Superseded update.')
      this.#verified = descriptor
      this.#manualReady = false
      complete = true
      this.#set({ phase: 'ready', downloadProgress: 1, message: null })
      return this.getSnapshot()
    } catch {
      if (this.#activeAbort !== abort || this.#disposed) return this.getSnapshot()
      if (abort.signal.reason === 'cancelled') {
        this.#set({ phase: 'desktop-available', downloadProgress: null, downloadedBytes: null, downloadTotalBytes: null,
          ...this.#retainedState(), message: null })
        return this.getSnapshot()
      }
      const message = 'Desktop update download failed (network, size, format or checksum). Try downloading again.'
      this.#set({ phase: 'error', downloadProgress: null, downloadedBytes: null, downloadTotalBytes: null,
        ...this.#retainedState(), message })
      throw new Error(message)
    } finally {
      abort.signal.removeEventListener('abort', stopReader)
      await reader?.cancel().catch(() => undefined)
      if (fd !== undefined) closeSync(fd)
      if (!complete && stagingDirectory !== undefined) rmSync(stagingDirectory, { recursive: true, force: true })
      clearTimeout(timer)
      if (this.#activeAbort === abort) this.#activeAbort = null
    }
  }

  dispose(): void {
    this.#disposed = true
    this.#activeAbort?.abort()
    this.#activeAbort = null
    this.#listeners.clear()
  }

  #current(abort: AbortController): boolean {
    return !this.#disposed && this.#activeAbort === abort && !abort.signal.aborted
  }

  #retainedState(): Partial<DesktopUpdateSnapshotFields> {
    if (this.#verified === null) return {}
    return {
      phase: this.#manualReady ? 'manual-install-ready' : 'ready', latestDesktop: this.#verified.desktopVersion,
      assetName: this.#verified.assetName, downloadedBytes: this.#verified.bytes,
      downloadTotalBytes: this.#verified.bytes, downloadProgress: 1,
    }
  }

  async #fetchJson(url: string, signal: AbortSignal): Promise<unknown> {
    const cached = this.#jsonCache.get(url)
    const headers: Record<string, string> = {
      accept: 'application/vnd.github+json',
      'user-agent': 'DeepSeek-Harness-Desktop-Updater',
    }
    if (cached !== undefined) headers['if-none-match'] = cached.etag
    const response = await this.#fetcher(url, {
      signal,
      redirect: 'error',
      headers,
    })
    if (response.status === 304 && cached !== undefined) return cached.value
    if (!response.ok) {
      const reset = response.headers.get('x-ratelimit-reset')
      if (response.status === 403 && reset !== null && Number.isFinite(Number(reset))) {
        throw new Error(`GitHub rate limit resets at ${new Date(Number(reset) * 1000).toISOString()}.`)
      }
      throw new Error(`GitHub returned HTTP ${String(response.status)}.`)
    }
    const value = JSON.parse(await boundedText(response, MAX_JSON_BYTES)) as unknown
    const etag = response.headers.get('etag')
    if (etag !== null && etag !== '') this.#jsonCache.set(url, { etag, value })
    return value
  }

  async #fetchAllowedReleaseAsset(url: string, signal: AbortSignal, accept: string): Promise<Response> {
    let current = url
    for (let redirect = 0; redirect <= 4; redirect += 1) {
      signal.throwIfAborted()
      if (!isAllowedReleaseUrl(current)) throw new Error('Release redirect left the allowlisted hosts.')
      const response = await this.#fetcher(current, {
        signal,
        redirect: 'manual',
        headers: { accept, 'user-agent': 'DeepSeek-Harness-Desktop-Updater' },
      })
      if (![301, 302, 303, 307, 308].includes(response.status)) return response
      const location = response.headers.get('location')
      await response.body?.cancel()
      if (location === null || redirect === 4) throw new Error('Release download exceeded the redirect limit.')
      current = new URL(location, current).toString()
    }
    throw new Error('Release download exceeded the redirect limit.')
  }

  async #selectDesktopRelease(value: unknown, signal: AbortSignal): Promise<AcceptedDesktopRelease | null> {
    if (!Array.isArray(value) || this.#target === null) return null
    const target = this.#target
    const manifestName = desktopUpdateManifestName(target)
    let selected: AcceptedDesktopRelease | null = null
    for (const item of value) {
      if (!isRecord(item) || !Array.isArray(item.assets)) continue
      if (item.draft === true) continue
      const htmlUrl = typeof item.html_url === 'string' ? item.html_url : ''
      const assets = item.assets.filter(isReleaseAsset)
      const manifestAsset = assets.find(asset => asset.name === manifestName)
      const downloadRoot = htmlUrl.replace('/tag/', '/download/')
      if (manifestAsset === undefined || manifestAsset.size <= 0 || manifestAsset.size > 65_536
        || manifestAsset.browser_download_url !== `${downloadRoot}/${manifestName}`
        || !isAllowedReleaseUrl(manifestAsset.browser_download_url)) continue
      let raw: unknown
      try {
        const response = await this.#fetchAllowedReleaseAsset(manifestAsset.browser_download_url, signal, 'application/json')
        if (!response.ok) continue
        raw = JSON.parse(await boundedText(response, 65_536)) as unknown
      } catch {
        signal.throwIfAborted()
        continue
      }
      const manifest = validateDesktopUpdateManifest(raw, target)
      if (manifest === null || manifest.releaseUrl !== htmlUrl) continue
      const dmg = assets.find(asset => asset.name === manifest.assetName)
      if (dmg === undefined || dmg.size !== manifest.bytes || dmg.browser_download_url !== `${downloadRoot}/${manifest.assetName}`
        || !isAllowedReleaseUrl(dmg.browser_download_url)) continue
      if (selected === null || compareVersions(manifest.desktopVersion, selected.manifest.desktopVersion) === 1) {
        selected = { manifest, assetUrl: dmg.browser_download_url }
      }
    }
    return selected
  }

  #set(update: Partial<DesktopUpdateSnapshotFields>): void {
    if (this.#disposed) return
    this.#snapshot = { ...this.#snapshot, ...update }
    const snapshot = this.getSnapshot()
    for (const listener of this.#listeners) {
      try { listener(snapshot) } catch { /* A renderer observer cannot mutate download authority. */ }
    }
  }

  #loadCache(): void {
    try {
      const value = JSON.parse(readFileSync(join(this.#userData, 'updates', 'state.json'), 'utf8')) as Partial<DesktopUpdateSnapshot>
      if (typeof value.lastCheckedAt === 'number' && Number.isSafeInteger(value.lastCheckedAt) && value.lastCheckedAt >= 0) this.#snapshot.lastCheckedAt = value.lastCheckedAt
      if (typeof value.latestOfficialHarness === 'string' && compareVersions(value.latestOfficialHarness, value.latestOfficialHarness) === 0) this.#snapshot.latestOfficialHarness = value.latestOfficialHarness
      if (typeof value.latestDesktop === 'string' && compareVersions(value.latestDesktop, value.latestDesktop) === 0) this.#snapshot.latestDesktop = value.latestDesktop
      if (this.#snapshot.latestOfficialHarness !== null
        && compareVersions(this.#snapshot.latestOfficialHarness, this.#snapshot.includedHarness) === 1) {
        this.#snapshot.phase = 'upstream-available'
      } else if (this.#snapshot.lastCheckedAt !== null) {
        this.#snapshot.phase = 'current'
      }
    } catch { /* first run or unreadable cache */ }
  }

  async #persistCache(): Promise<void> {
    const directory = join(this.#userData, 'updates')
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await writeFile(join(directory, 'state.json'), `${JSON.stringify({
      lastCheckedAt: this.#snapshot.lastCheckedAt,
      latestOfficialHarness: this.#snapshot.latestOfficialHarness,
      latestDesktop: this.#snapshot.latestDesktop,
    }, null, 2)}\n`, { mode: 0o600 })
  }
}
