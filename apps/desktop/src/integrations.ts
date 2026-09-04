import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DesktopIntegrationsSnapshot } from './preload-api.ts'

const OPEN_DESIGN_PROFILE = 'open-design'
const OPEN_DESIGN_PROFILE_NAME = 'dsh-profile-open-design'
const OPEN_DESIGN_RUNTIME = '@open-design/dsh-runtime'
const OPEN_DESIGN_ARCHIVE = /^file:\.open-design\/[a-f0-9]{64}\.tgz$/u
const OPEN_DESIGN_BUNDLES = ['@deepseek-ai/dsh-base', OPEN_DESIGN_RUNTIME] as const
const MANIFEST_BYTE_LIMIT = 64 * 1024

function snapshot(state: 'installed' | 'missing'): Readonly<DesktopIntegrationsSnapshot> {
  return Object.freeze({
    openDesign: Object.freeze({ state, profile: OPEN_DESIGN_PROFILE }),
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isOfficialOpenDesignProfile(value: unknown): boolean {
  if (!isRecord(value) || value.name !== OPEN_DESIGN_PROFILE_NAME) return false
  if (!isRecord(value.dependencies)) return false
  const runtime = value.dependencies[OPEN_DESIGN_RUNTIME]
  if (typeof runtime !== 'string' || !OPEN_DESIGN_ARCHIVE.test(runtime)) return false
  if (!isRecord(value.dsh) || !isRecord(value.dsh.profile)) return false
  const bundles = value.dsh.profile.bundles
  return Array.isArray(bundles)
    && bundles.length === OPEN_DESIGN_BUNDLES.length
    && bundles.every((bundle, index) => bundle === OPEN_DESIGN_BUNDLES[index])
}

/**
 * Read the one official Open Design profile on explicit renderer request.
 * The returned snapshot contains no paths, package sources, or manifest data.
 */
export async function readDesktopIntegrations(dshHome: string): Promise<Readonly<DesktopIntegrationsSnapshot>> {
  try {
    const source = await readFile(
      join(dshHome, 'profiles', OPEN_DESIGN_PROFILE, 'package.json'),
      'utf8',
    )
    if (Buffer.byteLength(source, 'utf8') > MANIFEST_BYTE_LIMIT) return snapshot('missing')
    return snapshot(isOfficialOpenDesignProfile(JSON.parse(source) as unknown) ? 'installed' : 'missing')
  } catch {
    return snapshot('missing')
  }
}
