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

function defaultWindowBounds(displays: readonly DisplayBounds[]): WindowBounds {
  const display = displays[0]
  if (display === undefined) return { ...DEFAULT_BOUNDS }
  const width = Math.min(DEFAULT_BOUNDS.width, display.width)
  const height = Math.min(DEFAULT_BOUNDS.height, display.height)
  return {
    x: display.x + Math.floor((display.width - width) / 2),
    y: display.y + Math.floor((display.height - height) / 2),
    width,
    height,
  }
}

/**
 * Validate saved window geometry against current displays.
 * @param candidate - Parsed persisted value.
 * @param displays - Current display work areas, primary display first.
 * @returns Saved geometry moved fully into its display, or defaults fitted to the primary work area.
 */
export function resolveWindowBounds(
  candidate: unknown,
  displays: readonly DisplayBounds[],
): WindowBounds {
  if (typeof candidate !== 'object' || candidate === null) return defaultWindowBounds(displays)
  const value = candidate as Record<string, unknown>
  const { x, y, width, height } = value
  if (
    !isFiniteNumber(x)
    || !isFiniteNumber(y)
    || !isFiniteNumber(width)
    || !isFiniteNumber(height)
  ) return defaultWindowBounds(displays)
  const bounds = { x, y, width, height }
  const display = displays.filter(display =>
    width >= Math.min(MIN_WIDTH, display.width)
    && height >= Math.min(MIN_HEIGHT, display.height)
    && width <= display.width
    && height <= display.height
    && visibleDisplayArea(bounds, display) > 0)
    .sort((left, right) => visibleDisplayArea(bounds, right) - visibleDisplayArea(bounds, left))[0]
  if (display === undefined) return defaultWindowBounds(displays)
  return {
    ...bounds,
    x: Math.max(display.x, Math.min(x, display.x + display.width - width)),
    y: Math.max(display.y, Math.min(y, display.y + display.height - height)),
  }
}

/**
 * Read and validate saved window geometry.
 * @param filename - Owner-controlled state file.
 * @param displays - Current display work areas, primary display first.
 * @returns Fitted saved geometry or fitted defaults when absent or malformed.
 */
export async function readWindowBounds(
  filename: string,
  displays: readonly DisplayBounds[],
): Promise<WindowBounds> {
  try {
    return resolveWindowBounds(JSON.parse(await readFile(filename, 'utf8')), displays)
  } catch (error) {
    if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return defaultWindowBounds(displays)
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
