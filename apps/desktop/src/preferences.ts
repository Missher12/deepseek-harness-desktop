/** Owner-local Desktop preferences, independent from Harness runtime state. */
import { readFile } from 'node:fs/promises'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'

type DesktopCloseBehavior = 'keep-running' | 'quit'

export interface DesktopPreferencesSnapshot {
  readonly closeBehavior: DesktopCloseBehavior
  readonly tieredPricingEstimates: boolean
}

export function defaultDesktopPreferences(platform: NodeJS.Platform): DesktopPreferencesSnapshot {
  return {
    closeBehavior: platform === 'darwin' ? 'keep-running' : 'quit',
    tieredPricingEstimates: true,
  }
}

function isDesktopPreferences(value: unknown): value is DesktopPreferencesSnapshot {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return Object.keys(record).length === 2
    && (record.closeBehavior === 'keep-running' || record.closeBehavior === 'quit')
    && typeof record.tieredPricingEstimates === 'boolean'
}

export async function readDesktopPreferences(
  filename: string,
  platform: NodeJS.Platform,
): Promise<DesktopPreferencesSnapshot> {
  try {
    const value: unknown = JSON.parse(await readFile(filename, 'utf8'))
    return isDesktopPreferences(value) ? value : defaultDesktopPreferences(platform)
  } catch (error) {
    if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return defaultDesktopPreferences(platform)
    }
    throw error
  }
}

export async function writeDesktopPreferences(
  filename: string,
  preferences: DesktopPreferencesSnapshot,
): Promise<void> {
  if (!isDesktopPreferences(preferences)) throw new Error('Invalid Desktop preferences.')
  await writeFileAtomic(filename, `${JSON.stringify(preferences)}\n`, { mode: 0o600, dirMode: 0o700 })
}
