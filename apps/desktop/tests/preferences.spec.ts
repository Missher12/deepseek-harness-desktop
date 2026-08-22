import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtemp } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  defaultDesktopPreferences,
  readDesktopPreferences,
  writeDesktopPreferences,
} from '../src/preferences.ts'

describe('Desktop preferences', () => {
  it('preserves current per-platform close defaults and enables estimates', () => {
    expect(defaultDesktopPreferences('darwin')).toEqual({
      closeBehavior: 'keep-running', tieredPricingEstimates: true,
    })
    expect(defaultDesktopPreferences('win32')).toEqual({
      closeBehavior: 'quit', tieredPricingEstimates: true,
    })
  })

  it('falls back as one complete record when the file is malformed', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-desktop-prefs-'))
    const file = join(dir, 'desktop-preferences.json')
    await writeFile(file, '{"closeBehavior":"shell"}', 'utf8')
    await expect(readDesktopPreferences(file, 'win32')).resolves.toEqual({
      closeBehavior: 'quit', tieredPricingEstimates: true,
    })
  })

  it('atomically persists an owner-only complete record', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-desktop-prefs-'))
    const file = join(dir, 'nested', 'desktop-preferences.json')
    await mkdir(join(dir, 'nested'))
    await writeDesktopPreferences(file, {
      closeBehavior: 'keep-running', tieredPricingEstimates: false,
    })
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({
      closeBehavior: 'keep-running', tieredPricingEstimates: false,
    })
  })
})
