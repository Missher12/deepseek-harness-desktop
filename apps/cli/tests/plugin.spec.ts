import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const spawnSync = vi.hoisted(() => vi.fn(() => ({ status: 0 })))

vi.mock('node:child_process', () => ({ spawnSync }))

import { runPlugin } from '../src/plugin.ts'

const roots: string[] = []
const originalHome = process.env.DSH_HOME
const originalPackagedPnpm = process.env.DSH_DESKTOP_PNPM_ENTRY

function fixture(): void {
  const home = mkdtempSync(join(tmpdir(), 'dsh-cli-plugin-'))
  roots.push(home)
  const profile = join(home, 'profiles', 'web')
  mkdirSync(profile, { recursive: true })
  writeFileSync(join(profile, 'package.json'), JSON.stringify({
    name: 'fixture-web',
    dependencies: {},
    dsh: { profile: { bundles: [] } },
  }))
  process.env.DSH_HOME = home
}

beforeEach(() => {
  spawnSync.mockClear()
  fixture()
  delete process.env.DSH_DESKTOP_PNPM_ENTRY
})

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  if (originalHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = originalHome
  if (originalPackagedPnpm === undefined) delete process.env.DSH_DESKTOP_PNPM_ENTRY
  else process.env.DSH_DESKTOP_PNPM_ENTRY = originalPackagedPnpm
})

describe('dsh plugin packaged pnpm entry', () => {
  it('runs a trusted absolute pnpm JavaScript entry through the current Node executable', () => {
    process.env.DSH_DESKTOP_PNPM_ENTRY = '/opt/deepseek/pnpm.cjs'

    expect(runPlugin('web', ['install', '--no-frozen-lockfile'])).toBe(0)
    expect(spawnSync).toHaveBeenCalledWith(
      process.execPath,
      ['/opt/deepseek/pnpm.cjs', 'install', '--no-frozen-lockfile'],
      expect.objectContaining({ shell: false }),
    )
  })

  it('rejects a relative packaged entry before spawning', () => {
    process.env.DSH_DESKTOP_PNPM_ENTRY = '../pnpm.cjs'
    expect(() => runPlugin('web', ['install'])).toThrow(/absolute path without NUL/i)
    expect(spawnSync).not.toHaveBeenCalled()
  })

  it('preserves the ordinary PATH-based pnpm invocation when no packaged entry exists', () => {
    expect(runPlugin('web', ['update'])).toBe(0)
    expect(spawnSync).toHaveBeenCalledWith(
      'pnpm',
      ['update'],
      expect.objectContaining({ shell: process.platform === 'win32' }),
    )
  })
})
