import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readWindowBounds, resolveWindowBounds, writeWindowBounds } from '../src/window/state.ts'

const displays = [{ x: 0, y: 0, width: 1440, height: 900 }]
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('resolveWindowBounds', () => {
  it('restores a visible, bounded window', () => {
    expect(resolveWindowBounds({ x: 80, y: 50, width: 1200, height: 760 }, displays))
      .toEqual({ x: 80, y: 50, width: 1200, height: 760 })
  })

  it('falls back when saved geometry is malformed or off screen', () => {
    expect(resolveWindowBounds({ x: 5000, y: 5000, width: 20, height: 20 }, displays))
      .toEqual({ width: 1180, height: 760 })
    expect(resolveWindowBounds({ x: 0, y: 0, width: Number.NaN, height: 760 }, displays))
      .toEqual({ width: 1180, height: 760 })
  })
})

describe('window state persistence', () => {
  it('atomically writes owner-only JSON and reads it back', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-state-'))
    temporaryRoots.push(root)
    const filename = join(root, 'nested', 'window.json')
    const bounds = { x: 80, y: 50, width: 1200, height: 760 }

    await writeWindowBounds(filename, bounds)

    expect(JSON.parse(await readFile(filename, 'utf8'))).toEqual(bounds)
    if (process.platform !== 'win32') {
      expect((await stat(filename)).mode & 0o777).toBe(0o600)
    }
    await expect(readWindowBounds(filename, displays)).resolves.toEqual(bounds)
  })

  it('uses safe defaults for an absent or malformed file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-state-'))
    temporaryRoots.push(root)
    await expect(readWindowBounds(join(root, 'missing.json'), displays))
      .resolves.toEqual({ width: 1180, height: 760 })
  })
})
