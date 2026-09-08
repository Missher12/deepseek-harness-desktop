import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
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
  it.each([
    { x: 0, y: 0, width: 1024, height: 720 },
    { x: -683, y: 40, width: 683, height: 480 },
  ])('keeps first-run and fallback bounds within a small work area: %j', (display) => {
    for (const candidate of [undefined, { x: 5000, y: 5000, width: 1180, height: 760 }]) {
      expect(resolveWindowBounds(candidate, [display])).toEqual(display)
    }
  })

  it('restores small-screen bounds without the normal-screen minimum rejecting them', () => {
    const display = { x: 0, y: 0, width: 683, height: 480 }
    expect(resolveWindowBounds(display, [display])).toEqual(display)
  })

  it('moves a partly visible saved window fully into its work area', () => {
    expect(resolveWindowBounds({ x: 300, y: 200, width: 1200, height: 760 }, displays))
      .toEqual({ x: 240, y: 140, width: 1200, height: 760 })
  })

  it('restores a visible, bounded window', () => {
    expect(resolveWindowBounds({ x: 80, y: 50, width: 1200, height: 760 }, displays))
      .toEqual({ x: 80, y: 50, width: 1200, height: 760 })
  })

  it('falls back when saved geometry is malformed or off screen', () => {
    expect(resolveWindowBounds({ x: 5000, y: 5000, width: 20, height: 20 }, displays))
      .toEqual({ x: 130, y: 70, width: 1180, height: 760 })
    expect(resolveWindowBounds({ x: 0, y: 0, width: Number.NaN, height: 760 }, displays))
      .toEqual({ x: 130, y: 70, width: 1180, height: 760 })
  })

  it('retains the emergency size when no display is available', () => {
    expect(resolveWindowBounds(undefined, [])).toEqual({ width: 1180, height: 760 })
  })

  it('keeps a saved window on its secondary display', () => {
    const secondary = { x: -1440, y: 40, width: 1440, height: 900 }
    const bounds = { x: -1420, y: 60, width: 1200, height: 760 }
    expect(resolveWindowBounds(bounds, [...displays, secondary])).toEqual(bounds)
  })

  it('fits a window to the display containing most of it rather than the first overlap', () => {
    const secondary = { x: -1440, y: 0, width: 1440, height: 900 }
    expect(resolveWindowBounds({ x: -1050, y: 50, width: 1200, height: 760 }, [...displays, secondary]))
      .toEqual({ x: -1200, y: 50, width: 1200, height: 760 })
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
      .resolves.toEqual({ x: 130, y: 70, width: 1180, height: 760 })
  })

  it('fits absent and malformed state files to the current work area', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-state-'))
    temporaryRoots.push(root)
    const display = { x: 0, y: 0, width: 683, height: 480 }
    await expect(readWindowBounds(join(root, 'missing.json'), [display])).resolves.toEqual(display)
    const filename = join(root, 'malformed.json')
    await writeFile(filename, '{')
    await expect(readWindowBounds(filename, [display])).resolves.toEqual(display)
  })
})
