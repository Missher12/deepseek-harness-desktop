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

function intersectsDisplay(bounds: Required<WindowBounds>, display: DisplayBounds): boolean {
  const width = Math.max(0, Math.min(bounds.x + bounds.width, display.x + display.width)
    - Math.max(bounds.x, display.x))
  const height = Math.max(0, Math.min(bounds.y + bounds.height, display.y + display.height)
    - Math.max(bounds.y, display.y))
  return width >= MIN_VISIBLE_WIDTH && height >= MIN_VISIBLE_HEIGHT
}

/**
 * Validate saved window geometry against current displays.
 * @param candidate - Parsed persisted value.
 * @param displays - Current display work areas.
 * @returns Safe saved geometry or centered-size defaults.
 */
export function resolveWindowBounds(
  candidate: unknown,
  displays: readonly DisplayBounds[],
): WindowBounds {
  if (typeof candidate !== 'object' || candidate === null) return { ...DEFAULT_BOUNDS }
  const value = candidate as Record<string, unknown>
  const { x, y, width, height } = value
  if (
    !isFiniteNumber(x)
    || !isFiniteNumber(y)
    || !isFiniteNumber(width)
    || !isFiniteNumber(height)
    || width < MIN_WIDTH
    || height < MIN_HEIGHT
  ) return { ...DEFAULT_BOUNDS }
  const bounds = { x, y, width, height }
  const fitsOneDisplay = displays.some(display =>
    width <= display.width && height <= display.height && intersectsDisplay(bounds, display))
  return fitsOneDisplay ? bounds : { ...DEFAULT_BOUNDS }
}

/**
 * Read and validate saved window geometry.
 * @param filename - Owner-controlled state file.
 * @param displays - Current display work areas.
 * @returns Safe saved geometry or defaults when absent or malformed.
 */
export async function readWindowBounds(
  filename: string,
  displays: readonly DisplayBounds[],
): Promise<WindowBounds> {
  try {
    return resolveWindowBounds(JSON.parse(await readFile(filename, 'utf8')), displays)
  } catch (error) {
    if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ...DEFAULT_BOUNDS }
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
