import { createHash, timingSafeEqual } from 'node:crypto'
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  compareVersions,
  parseOfficialHarnessTag,
  selectUpdateAvailability,
  validateDesktopUpdateManifest,
  type DesktopUpdateManifest,
} from './release.ts'

type DesktopUpdatePhase =
  | 'idle'
  | 'checking'
  | 'current'
  | 'upstream-available'
  | 'desktop-available'
  | 'downloading'
  | 'verifying'
  | 'ready'
  | 'installing'
  | 'error'

export interface DesktopUpdateSnapshot {
  phase: DesktopUpdatePhase
  runningDesktop: string
  includedHarness: string
  latestOfficialHarness: string | null
  latestDesktop: string | null
  lastCheckedAt: number | null
  downloadProgress: number | null
  message: string | null
}

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
  runningDesktop: string
  includedHarness: string
  userData: string
  fetcher?: typeof fetch
  now?: () => number
}

const OFFICIAL_TAGS_URL = 'https://api.github.com/repos/deepseek-ai/deepseek-harness/tags?per_page=30'
const DESKTOP_RELEASES_URL = 'https://api.github.com/repos/Missher12/deepseek-harness-desktop/releases?per_page=10'
const MANIFEST_NAME = 'deepseek-harness-desktop-update.json'
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
    if (url.protocol !== 'https:' || !ALLOWED_DOWNLOAD_HOSTS.has(url.hostname)) return false
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
  #snapshot: DesktopUpdateSnapshot
  #accepted: AcceptedDesktopRelease | null = null
  #verifiedPath: string | null = null
  #stagingDirectory: string | null = null
  #activeAbort: AbortController | null = null
  readonly #jsonCache = new Map<string, { etag: string; value: unknown }>()
  readonly #listeners = new Set<(snapshot: DesktopUpdateSnapshot) => void>()

  constructor(options: DesktopUpdateServiceOptions) {
    this.#fetcher = options.fetcher ?? fetch
    this.#now = options.now ?? Date.now
    this.#userData = options.userData
    this.#snapshot = {
      phase: 'idle',
      runningDesktop: options.runningDesktop,
      includedHarness: options.includedHarness,
      latestOfficialHarness: null,
      latestDesktop: null,
      lastCheckedAt: null,
      downloadProgress: null,
      message: null,
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
    return this.#snapshot.phase === 'desktop-available' && this.#accepted !== null
  }

  getVerifiedDownloadPath(): string | null {
    return this.#verifiedPath
  }

  getInstallDescriptor(): {
    dmgPath: string
    desktopVersion: string
    harnessVersion: string
    sha256: string
  } | null {
    if (this.#verifiedPath === null || this.#accepted === null || this.#snapshot.phase !== 'ready') return null
    return {
      dmgPath: this.#verifiedPath,
      desktopVersion: this.#accepted.manifest.desktopVersion,
      harnessVersion: this.#accepted.manifest.harnessVersion,
      sha256: this.#accepted.manifest.sha256,
    }
  }

  /** Mark a verified payload as handed to the native installer flow. */
  beginInstall(): string {
    if (this.#snapshot.phase !== 'ready' || this.#verifiedPath === null) {
      throw new Error('No verified Desktop update is ready to install.')
    }
    this.#set({ phase: 'installing', message: null })
    return this.#verifiedPath
  }

  async check(manual = false): Promise<DesktopUpdateSnapshot> {
    const cachedDesktopNeedsRevalidation = this.#accepted === null
      && this.#snapshot.latestDesktop !== null
      && compareVersions(this.#snapshot.latestDesktop, this.#snapshot.runningDesktop) === 1
    if (!manual && !cachedDesktopNeedsRevalidation && this.#snapshot.lastCheckedAt !== null
      && this.#now() - this.#snapshot.lastCheckedAt < CHECK_INTERVAL_MS) return this.getSnapshot()
    this.#activeAbort?.abort()
    const abort = new AbortController()
    this.#activeAbort = abort
    this.#set({ phase: 'checking', message: null, downloadProgress: null })
    const timer = setTimeout(() => { abort.abort() }, 10_000)
    timer.unref()
    try {
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
        message: null,
      })
      await this.#persistCache()
      return this.getSnapshot()
    } catch (error) {
      const message = error instanceof Error && error.name === 'AbortError'
        ? 'Update check timed out. Try again.'
        : `Update check failed: ${error instanceof Error ? error.message : String(error)}`.slice(0, 300)
      this.#set({ phase: 'error', message })
      return this.getSnapshot()
    } finally {
      clearTimeout(timer)
      if (this.#activeAbort === abort) this.#activeAbort = null
    }
  }

  async download(): Promise<DesktopUpdateSnapshot> {
    if (!this.canDownload() || this.#accepted === null) throw new Error('No verified Desktop update is available.')
    const accepted = this.#accepted
    this.#activeAbort?.abort()
    const abort = new AbortController()
    this.#activeAbort = abort
    const timer = setTimeout(() => { abort.abort() }, 10 * 60 * 1000)
    timer.unref()
    this.#set({ phase: 'downloading', downloadProgress: 0, message: null })
    const updateRoot = join(this.#userData, 'updates')
    mkdirSync(updateRoot, { recursive: true, mode: 0o700 })
    const stagingDirectory = mkdtempSync(join(updateRoot, 'download-'))
    this.#stagingDirectory = stagingDirectory
    const destination = join(stagingDirectory, accepted.manifest.assetName)
    let fd: number | undefined
    try {
      if (!isAllowedReleaseUrl(accepted.assetUrl)) throw new Error('Desktop asset URL is not allowlisted.')
      const response = await this.#fetchAllowedReleaseAsset(accepted.assetUrl, abort.signal, 'application/octet-stream')
      if (!response.ok || response.body === null) throw new Error(`Desktop download returned HTTP ${String(response.status)}.`)
      const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
      if (contentType !== undefined && contentType !== ''
        && contentType !== 'application/octet-stream' && contentType !== 'application/x-apple-diskimage') {
        throw new Error('Desktop download media type was not a disk image.')
      }
      const declaredLength = Number(response.headers.get('content-length'))
      if (Number.isFinite(declaredLength) && declaredLength !== accepted.manifest.bytes) {
        throw new Error('Desktop download size did not match the signed manifest.')
      }
      fd = openSync(destination, 'wx', 0o600)
      const reader = response.body.getReader()
      const hash = createHash('sha256')
      let received = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        received += value.byteLength
        if (received > accepted.manifest.bytes) throw new Error('Desktop download exceeded the manifest byte count.')
        const chunk = Buffer.from(value)
        hash.update(chunk)
        writeSync(fd, chunk)
        this.#set({ downloadProgress: received / accepted.manifest.bytes })
      }
      closeSync(fd)
      fd = undefined
      if (received !== accepted.manifest.bytes) throw new Error('Desktop download byte count did not match the manifest.')
      this.#set({ phase: 'verifying', downloadProgress: 1 })
      const actual = Buffer.from(hash.digest('hex'), 'hex')
      const expected = Buffer.from(accepted.manifest.sha256, 'hex')
      if (actual.byteLength !== expected.byteLength || !timingSafeEqual(actual, expected)) {
        throw new Error('Desktop update checksum verification failed.')
      }
      this.#verifiedPath = destination
      this.#set({ phase: 'ready', downloadProgress: 1, message: null })
      return this.getSnapshot()
    } catch (error) {
      if (fd !== undefined) closeSync(fd)
      rmSync(stagingDirectory, { recursive: true, force: true })
      this.#stagingDirectory = null
      this.#verifiedPath = null
      const message = error instanceof Error ? error.message : String(error)
      this.#set({ phase: 'error', downloadProgress: null, message: message.slice(0, 300) })
      throw error
    } finally {
      clearTimeout(timer)
      if (this.#activeAbort === abort) this.#activeAbort = null
    }
  }

  dispose(): void {
    this.#activeAbort?.abort()
    this.#activeAbort = null
    if (this.#verifiedPath === null && this.#stagingDirectory !== null) {
      rmSync(this.#stagingDirectory, { recursive: true, force: true })
      this.#stagingDirectory = null
    }
    this.#listeners.clear()
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
      if (!isAllowedReleaseUrl(current)) throw new Error('Release redirect left the allowlisted hosts.')
      const response = await this.#fetcher(current, {
        signal,
        redirect: 'manual',
        headers: { accept, 'user-agent': 'DeepSeek-Harness-Desktop-Updater' },
      })
      if (![301, 302, 303, 307, 308].includes(response.status)) return response
      const location = response.headers.get('location')
      if (location === null || redirect === 4) throw new Error('Release download exceeded the redirect limit.')
      current = new URL(location, current).toString()
    }
    throw new Error('Release download exceeded the redirect limit.')
  }

  async #selectDesktopRelease(value: unknown, signal: AbortSignal): Promise<AcceptedDesktopRelease | null> {
    if (!Array.isArray(value)) return null
    let selected: AcceptedDesktopRelease | null = null
    for (const item of value) {
      if (!isRecord(item) || !Array.isArray(item.assets)) continue
      if (item.draft === true) continue
      const htmlUrl = typeof item.html_url === 'string' ? item.html_url : ''
      const assets = item.assets.filter(isReleaseAsset)
      const manifestAsset = assets.find(asset => asset.name === MANIFEST_NAME)
      if (manifestAsset === undefined || manifestAsset.size > 65_536 || !isAllowedReleaseUrl(manifestAsset.browser_download_url)) continue
      let raw: unknown
      try {
        const response = await this.#fetchAllowedReleaseAsset(manifestAsset.browser_download_url, signal, 'application/json')
        if (!response.ok) continue
        raw = JSON.parse(await boundedText(response, 65_536)) as unknown
      } catch { continue }
      const manifest = validateDesktopUpdateManifest(raw)
      if (manifest === null || manifest.releaseUrl !== htmlUrl) continue
      const dmg = assets.find(asset => asset.name === manifest.assetName)
      if (dmg === undefined || dmg.size !== manifest.bytes || !isAllowedReleaseUrl(dmg.browser_download_url)) continue
      if (selected === null || compareVersions(manifest.desktopVersion, selected.manifest.desktopVersion) === 1) {
        selected = { manifest, assetUrl: dmg.browser_download_url }
      }
    }
    return selected
  }

  #set(update: Partial<DesktopUpdateSnapshot>): void {
    this.#snapshot = { ...this.#snapshot, ...update }
    const snapshot = this.getSnapshot()
    for (const listener of this.#listeners) listener(snapshot)
  }

  #loadCache(): void {
    try {
      const value = JSON.parse(readFileSync(join(this.#userData, 'updates', 'state.json'), 'utf8')) as Partial<DesktopUpdateSnapshot>
      if (typeof value.lastCheckedAt === 'number') this.#snapshot.lastCheckedAt = value.lastCheckedAt
      if (typeof value.latestOfficialHarness === 'string') this.#snapshot.latestOfficialHarness = value.latestOfficialHarness
      if (typeof value.latestDesktop === 'string') this.#snapshot.latestDesktop = value.latestDesktop
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
