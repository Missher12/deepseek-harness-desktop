import { readFile } from 'node:fs/promises'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'

const DEFAULT_BOUNDS = { width: 1180, height: 760 } as const
const MIN_WIDTH = 900
const MIN_HEIGHT = 620
const MIN_VISIBLE_WIDTH = 120
const MIN_VISIBLE_HEIGHT = 80

/** Serializable BrowserWindow geometry. */
export interface WindowBounds {
  x?: number
  y?: number
  width: number
  height: number
}

/** Available display work-area geometry. */
export interface DisplayBounds {
  x: number
  y: number
  width: number
  height: number
  /** Physical-pixel scale; omitted work-area fixtures use integer scaling. */
  scaleFactor?: number
}

/**
 * Reserve native rounding space before resolving initial and saved window bounds.
 * @param workArea - Electron display work area in device-independent pixels.
 * @param scaleFactor - The display's physical-pixel scale.
 * @param platform - Native platform hosting the window.
 * @returns Work area available to the window geometry resolver.
 */
export function resolveWindowWorkArea(
  workArea: DisplayBounds,
  scaleFactor: number,
  platform: NodeJS.Platform,
): DisplayBounds {
  if (platform !== 'win32' || Number.isInteger(scaleFactor)) return workArea
  // Windows can expand a requested DIP edge during native pixel conversion.
  // Keep one physical pixel, rounded up to DIP, inside each work-area edge.
  const inset = Math.ceil(1 / scaleFactor)
  return {
    x: workArea.x + inset,
    y: workArea.y + inset,
    width: workArea.width - 2 * inset,
    height: workArea.height - 2 * inset,
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function visibleDisplayArea(bounds: Required<WindowBounds>, display: DisplayBounds): number {
  const width = Math.max(0, Math.min(bounds.x + bounds.width, display.x + display.width)
    - Math.max(bounds.x, display.x))
  const height = Math.max(0, Math.min(bounds.y + bounds.height, display.y + display.height)
    - Math.max(bounds.y, display.y))
  return width >= MIN_VISIBLE_WIDTH && height >= MIN_VISIBLE_HEIGHT ? width * height : 0
}

function defaultWindowBounds(displays: readonly DisplayBounds[], platform: NodeJS.Platform): WindowBounds {
  const display = displays[0]
  if (display === undefined) return { ...DEFAULT_BOUNDS }
  const area = resolveWindowWorkArea(display, display.scaleFactor ?? 1, platform)
  const width = Math.min(DEFAULT_BOUNDS.width, area.width)
  const height = Math.min(DEFAULT_BOUNDS.height, area.height)
  return {
    x: area.x + Math.floor((area.width - width) / 2),
    y: area.y + Math.floor((area.height - height) / 2),
    width,
    height,
  }
}

/**
 * Validate saved window geometry against current displays.
 * @param candidate - Parsed persisted value.
 * @param displays - Current display work areas, primary display first.
 * @param platform - Native platform whose pixel rounding applies.
 * @returns Saved geometry moved fully into its display, or defaults fitted to the primary work area.
 */
export function resolveWindowBounds(
  candidate: unknown,
  displays: readonly DisplayBounds[],
  platform: NodeJS.Platform = process.platform,
): WindowBounds {
  if (typeof candidate !== 'object' || candidate === null) return defaultWindowBounds(displays, platform)
  const value = candidate as Record<string, unknown>
  const { x, y, width, height } = value
  if (
    !isFiniteNumber(x)
    || !isFiniteNumber(y)
    || !isFiniteNumber(width)
    || !isFiniteNumber(height)
  ) return defaultWindowBounds(displays, platform)
  const bounds = { x, y, width, height }
  const display = displays.filter((display) => {
    const area = resolveWindowWorkArea(display, display.scaleFactor ?? 1, platform)
    return width >= Math.min(MIN_WIDTH, area.width)
      && height >= Math.min(MIN_HEIGHT, area.height)
      && width <= display.width
      && height <= display.height
      && visibleDisplayArea(bounds, display) > 0
  })
    .sort((left, right) => visibleDisplayArea(bounds, right) - visibleDisplayArea(bounds, left))[0]
  if (display === undefined) return defaultWindowBounds(displays, platform)
  // Select the saved window's display before reserving native rounding space;
  // an edge-to-edge saved window must remain eligible for its original display.
  const area = resolveWindowWorkArea(display, display.scaleFactor ?? 1, platform)
  const fittedWidth = Math.min(width, area.width)
  const fittedHeight = Math.min(height, area.height)
  return {
    width: fittedWidth,
    height: fittedHeight,
    x: Math.max(area.x, Math.min(x, area.x + area.width - fittedWidth)),
    y: Math.max(area.y, Math.min(y, area.y + area.height - fittedHeight)),
  }
}

/**
 * Read and validate saved window geometry.
 * @param filename - Owner-controlled state file.
 * @param displays - Current display work areas, primary display first.
 * @param platform - Native platform whose pixel rounding applies.
 * @returns Fitted saved geometry or fitted defaults when absent or malformed.
 */
export async function readWindowBounds(
  filename: string,
  displays: readonly DisplayBounds[],
  platform: NodeJS.Platform = process.platform,
): Promise<WindowBounds> {
  try {
    return resolveWindowBounds(JSON.parse(await readFile(filename, 'utf8')), displays, platform)
  } catch (error) {
    if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return defaultWindowBounds(displays, platform)
    }
    throw error
  }
}

/**
 * Atomically persist one complete window geometry record.
 * @param filename - Owner-controlled state file.
 * @param bounds - Geometry returned by BrowserWindow.
 */
export async function writeWindowBounds(filename: string, bounds: WindowBounds): Promise<void> {
  await writeFileAtomic(filename, `${JSON.stringify(bounds)}\n`, { mode: 0o600, dirMode: 0o700 })
}
