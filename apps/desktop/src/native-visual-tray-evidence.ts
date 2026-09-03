export interface NativeVisualTrayEvidencePoint {
  x: number
  y: number
}

export interface NativeVisualTrayEvidenceBounds extends NativeVisualTrayEvidencePoint {
  width: number
  height: number
}

export interface NativeVisualTrayEvidence {
  schemaVersion: 1
  observedAt: string
  iconSize: 16 | 20 | 24 | 32
  bounds: NativeVisualTrayEvidenceBounds
  clickPoint: NativeVisualTrayEvidencePoint
}

interface NativeVisualTrayEvidenceSource {
  iconSize: NativeVisualTrayEvidence['iconSize']
  getBounds: () => NativeVisualTrayEvidenceBounds
  dipToScreenPoint: (point: NativeVisualTrayEvidencePoint) => NativeVisualTrayEvidencePoint
}

interface NativeVisualTrayEvidenceTimer {
  unref: () => void
}

interface NativeVisualTrayEvidenceClock {
  now: () => Date
  schedule: (callback: () => void, intervalMs: number) => NativeVisualTrayEvidenceTimer
  cancel: (timer: NativeVisualTrayEvidenceTimer) => void
}

interface NativeVisualTrayEvidenceOptions {
  enabled: boolean
  write: (evidence: NativeVisualTrayEvidence) => Promise<void>
  clock?: NativeVisualTrayEvidenceClock
}

export interface NativeVisualTrayEvidenceController {
  start: (source: NativeVisualTrayEvidenceSource) => void
  stop: () => void
}

const SAMPLE_INTERVAL_MS = 250

const systemClock: NativeVisualTrayEvidenceClock = {
  now: () => new Date(),
  schedule: (callback, intervalMs) => setInterval(callback, intervalMs),
  cancel: (timer) => { clearInterval(timer as NodeJS.Timeout) },
}

function isFinitePoint(point: NativeVisualTrayEvidencePoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y)
}

export function createNativeVisualTrayEvidenceController(
  options: NativeVisualTrayEvidenceOptions,
): NativeVisualTrayEvidenceController {
  const clock = options.clock ?? systemClock
  let timer: NativeVisualTrayEvidenceTimer | undefined

  const stop = (): void => {
    if (timer === undefined) return
    clock.cancel(timer)
    timer = undefined
  }

  return {
    start: (source) => {
      stop()
      if (!options.enabled) return
      timer = clock.schedule(() => {
        try {
          const bounds = source.getBounds()
          if (
            !isFinitePoint(bounds)
            || !Number.isFinite(bounds.width)
            || !Number.isFinite(bounds.height)
            || bounds.width <= 0
            || bounds.height <= 0
          ) return
          const clickPoint = source.dipToScreenPoint({
            x: Math.round(bounds.x + (bounds.width / 2)),
            y: Math.round(bounds.y + (bounds.height / 2)),
          })
          if (!isFinitePoint(clickPoint)) return
          void options.write({
            schemaVersion: 1,
            observedAt: clock.now().toISOString(),
            iconSize: source.iconSize,
            bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
            clickPoint: { x: clickPoint.x, y: clickPoint.y },
          }).catch(() => {})
        } catch {
          // Native shell state can change while an evidence sample is collected.
        }
      }, SAMPLE_INTERVAL_MS)
      timer.unref()
    },
    stop,
  }
}
