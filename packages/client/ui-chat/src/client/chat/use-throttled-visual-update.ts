/** Frame-throttled scheduling for non-essential visual alignment. */
import { useCallback, useLayoutEffect, useRef } from 'react'

const DEFAULT_INTERVAL_FRAMES = 3

export interface ThrottledVisualUpdate {
  /** Coalesce the update over the configured frame interval. */
  schedule(): void
  /** Cancel a pending visual update before it reaches the DOM. */
  cancel(): void
}

/** Return stable controls for a frame-throttled visual update. */
export function useThrottledVisualUpdate(
  update: () => void,
  intervalFrames = DEFAULT_INTERVAL_FRAMES,
): ThrottledVisualUpdate {
  const updateRef = useRef(update)
  updateRef.current = update
  const pendingFrameRef = useRef<number | null>(null)

  const cancel = useCallback(() => {
    if (pendingFrameRef.current === null) return
    cancelAnimationFrame(pendingFrameRef.current)
    pendingFrameRef.current = null
  }, [])

  useLayoutEffect(() => cancel, [cancel])

  const schedule = useCallback(() => {
    if (pendingFrameRef.current !== null) return
    let remainingFrames = intervalFrames
    const advance = (): void => {
      remainingFrames -= 1
      if (remainingFrames > 0) {
        pendingFrameRef.current = requestAnimationFrame(advance)
        return
      }
      pendingFrameRef.current = null
      updateRef.current()
    }
    pendingFrameRef.current = requestAnimationFrame(advance)
  }, [intervalFrames])

  return { schedule, cancel }
}
