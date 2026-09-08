import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readWindowBounds, resolveWindowBounds, resolveWindowWorkArea, writeWindowBounds } from '../src/window/state.ts'
import { createWindowOptions } from '../src/window/options.ts'

const displays = [{ x: 0, y: 0, width: 1440, height: 900 }]
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('fractional Windows display geometry', () => {
  it.each([1.25, 1.5, 1.75])('contains outward native edge rounding at scale %s', (scaleFactor) => {
    for (const workArea of [
      { x: 0, y: 0, width: 683, height: 480 },
      { x: -683, y: -480, width: 683, height: 480 },
    ]) {
      for (const saved of [undefined, workArea]) {
        const bounds = resolveWindowBounds(saved, [{ ...workArea, scaleFactor }], 'win32')
        // The Windows 150% runner returned 684 DIP for a 683 DIP request.
        // Model the same one-DIP outward rounding on every native edge.
        expect(bounds.x! - 1).toBeGreaterThanOrEqual(workArea.x)
        expect(bounds.y! - 1).toBeGreaterThanOrEqual(workArea.y)
        expect(bounds.x! + bounds.width + 1).toBeLessThanOrEqual(workArea.x + workArea.width)
        expect(bounds.y! + bounds.height + 1).toBeLessThanOrEqual(workArea.y + workArea.height)
        const options = createWindowOptions(bounds, 'C:\\app\\preload.cjs', 'win32', 'C:\\app\\icon.ico')
        expect(options.minWidth).toBeLessThanOrEqual(bounds.width)
        expect(options.minHeight).toBeLessThanOrEqual(bounds.height)
      }
    }
  })

  it('keeps a saved window on its secondary display after reserving rounding space', () => {
    const secondary = { x: -1440, y: 0, width: 1440, height: 900 }
    const areas = [...displays, secondary].map(area => ({ ...area, scaleFactor: 1.5 }))
    const bounds = resolveWindowBounds({ x: -1440, y: 0, width: 1200, height: 760 }, areas, 'win32')
    expect(bounds.x! - 1).toBeGreaterThanOrEqual(secondary.x)
    expect(bounds.y! - 1).toBeGreaterThanOrEqual(secondary.y)
    expect(bounds.x! + bounds.width + 1).toBeLessThanOrEqual(0)
    expect(bounds.width).toBe(1200)
    expect(bounds.height).toBe(760)
  })

  it('keeps a saved window that fills its secondary display on that display', () => {
    const secondary = { x: -1440, y: 0, width: 1440, height: 900 }
    const areas = [...displays, secondary].map(area => ({ ...area, scaleFactor: 1.5 }))
    const bounds = resolveWindowBounds(secondary, areas, 'win32')
    expect(bounds.x! + bounds.width).toBeLessThanOrEqual(0)
    expect(bounds.x!).toBeGreaterThanOrEqual(secondary.x)
    expect(bounds.width).toBe(1438)
  })

  it.each([
    { x: -683, y: 0, width: 683, height: 480 },
    { x: -900, y: 0, width: 900, height: 620 },
  ])('restores a fitted secondary window again without moving it to the primary: %j', (secondary) => {
    const areas = [...displays, secondary].map(area => ({ ...area, scaleFactor: 1.5 }))
    const first = resolveWindowBounds(secondary, areas, 'win32')
    expect(first.x! + first.width).toBeLessThanOrEqual(0)
    expect(resolveWindowBounds(first, areas, 'win32')).toEqual(first)
  })

  it('preserves normal-screen default size and center at fractional Windows scale', () => {
    const areas = displays.map(area => ({ ...area, scaleFactor: 1.5 }))
    expect(resolveWindowBounds(undefined, areas, 'win32')).toEqual(resolveWindowBounds(undefined, displays))
  })

  it.each([
    ['darwin', 1.5], ['linux', 1.5], ['win32', 1], ['win32', 2],
  ] as const)('preserves the work area on %s at scale %s', (platform, scaleFactor) => {
    const area = { x: -683, y: 40, width: 683, height: 480 }
    expect(resolveWindowWorkArea(area, scaleFactor, platform)).toEqual(area)
  })
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
