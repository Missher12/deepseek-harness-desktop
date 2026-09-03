/**
 * Verified warm-start cache for the Desktop installation module fallback.
 * The CLI keeps using the authoritative healer directly; Desktop may skip its
 * dependency-graph walk only when every cached package manifest and managed
 * symlink still matches the installation that produced the cache.
 */

import { createHash, randomUUID } from 'node:crypto'
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { healProfilesModuleFallback, PROFILES_DIR, type ProfileModuleFallbackLink } from './profile.ts'

const CACHE_FORMAT = 1
const CACHE_FILENAME = '.module-fallback-cache.json'
const MAX_CACHE_BYTES = 4 * 1024 * 1024
const MAX_LINKS = 4096

interface CachedLink extends ProfileModuleFallbackLink {
  manifestSha256: string
}

interface FallbackCache {
  format: number
  installKey: string
  installAnchor: string
  rootManifestSha256: string
  links: CachedLink[]
}

/** Whether Desktop reused a fully verified cache or ran the authoritative healer. */
export type ProfileModuleFallbackCacheResult = 'verified-cache' | 'rebuilt'

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function isPackageName(value: string): boolean {
  if (value === '' || value.includes('\\') || value.includes('\0')) return false
  const parts = value.split('/')
  if (value.startsWith('@')) {
    return parts.length === 2 && parts.every(part => part !== '' && part !== '.' && part !== '..')
  }
  return parts.length === 1 && parts[0] !== '.' && parts[0] !== '..'
}

function isCachedLink(value: unknown): value is CachedLink {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<CachedLink>
  return typeof candidate.packageName === 'string'
    && isPackageName(candidate.packageName)
    && typeof candidate.target === 'string'
    && isAbsolute(candidate.target)
    && typeof candidate.manifestSha256 === 'string'
    && /^[a-f0-9]{64}$/.test(candidate.manifestSha256)
}

function cacheIsValid(
  value: unknown,
  installAnchor: string,
  home: string,
  installKey: string,
): value is FallbackCache {
  if (typeof value !== 'object' || value === null) return false
  const cache = value as Partial<FallbackCache>
  if (cache.format !== CACHE_FORMAT
    || cache.installKey !== installKey
    || cache.installAnchor !== installAnchor
    || cache.rootManifestSha256 !== sha256File(installAnchor)
    || !Array.isArray(cache.links)
    || cache.links.length > MAX_LINKS
    || !cache.links.every(isCachedLink)) return false

  const modulesDir = join(home, PROFILES_DIR, 'node_modules')
  for (const link of cache.links) {
    const linkPath = join(modulesDir, link.packageName)
    try {
      if (!lstatSync(linkPath).isSymbolicLink() || readlinkSync(linkPath) !== link.target) return false
      if (sha256File(join(link.target, 'package.json')) !== link.manifestSha256) return false
    } catch {
      return false
    }
  }
  return true
}

function readValidCache(
  cachePath: string,
  installAnchor: string,
  home: string,
  installKey: string,
): boolean {
  try {
    if (statSync(cachePath).size > MAX_CACHE_BYTES) return false
    return cacheIsValid(JSON.parse(readFileSync(cachePath, 'utf8')), installAnchor, home, installKey)
  } catch {
    return false
  }
}

function writeCache(
  cachePath: string,
  installAnchor: string,
  installKey: string,
  links: readonly ProfileModuleFallbackLink[],
): void {
  const value: FallbackCache = {
    format: CACHE_FORMAT,
    installKey,
    installAnchor,
    rootManifestSha256: sha256File(installAnchor),
    links: links.map(link => ({
      ...link,
      manifestSha256: sha256File(join(link.target, 'package.json')),
    })),
  }
  const tempPath = join(dirname(cachePath), `.${CACHE_FILENAME}.${process.pid}.${randomUUID()}.tmp`)
  try {
    writeFileSync(tempPath, JSON.stringify(value) + '\n', { flag: 'wx' })
    try {
      renameSync(tempPath, cachePath)
    } catch {
      // Windows cannot atomically replace an existing file. The cache is an
      // optional acceleration layer, so a short absent-cache window is safe.
      /* v8 ignore next -- Windows-only replacement fallback; the native Windows Setup smoke exercises it. */
      rmSync(cachePath, { force: true })
      /* v8 ignore next -- same Windows-only fallback. */
      renameSync(tempPath, cachePath)
    }
  } finally {
    rmSync(tempPath, { force: true })
  }
}

/**
 * Heal the installation fallback, or reuse a fully verified Desktop cache.
 * Any malformed, stale, or partially written cache is treated as a miss.
 * @param installAnchorInput - Absolute or working-directory-relative Desktop package manifest.
 * @param home - Isolated Harness home that owns the managed profile fallback.
 * @param installKey - Desktop version or equivalent caller-controlled installation identity.
 * @returns Whether the verified cache was reused or the authoritative healer rebuilt the state.
 */
export function healProfilesModuleFallbackCached(
  installAnchorInput: string,
  home: string,
  installKey: string,
): ProfileModuleFallbackCacheResult {
  const installAnchor = resolve(installAnchorInput)
  const profilesDir = join(home, PROFILES_DIR)
  const cachePath = join(profilesDir, CACHE_FILENAME)
  mkdirSync(profilesDir, { recursive: true })
  if (readValidCache(cachePath, installAnchor, home, installKey)) return 'verified-cache'

  const links = healProfilesModuleFallback(installAnchor, home)
  try {
    writeCache(cachePath, installAnchor, installKey, links)
  } catch {
    // Cache persistence must never turn a successful authoritative heal into
    // an application startup failure.
  }
  return 'rebuilt'
}
