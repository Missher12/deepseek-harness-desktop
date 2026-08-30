import type { Rectangle } from 'electron'
import { AgentBrowserError } from './contracts.ts'

interface DockWaiter {
  readonly resolve: (value: Rectangle) => void
  readonly reject: (reason: AgentBrowserError) => void
  readonly signal: AbortSignal | undefined
  readonly onAbort: () => void
}

function copyRectangle(value: Rectangle): Rectangle {
  return { x: value.x, y: value.y, width: value.width, height: value.height }
}

function isPositiveRectangle(value: Rectangle): boolean {
  return Number.isFinite(value.x) && Number.isFinite(value.y)
    && Number.isFinite(value.width) && Number.isFinite(value.height)
    && value.width > 0 && value.height > 0
}

/** Clamp one trusted renderer host rectangle to child-view coordinates inside the owner content area. */
export function clampBrowserDockBounds(
  area: Pick<Rectangle, 'width' | 'height'>,
  requested: Rectangle,
): Rectangle {
  const width = Math.max(1, Math.round(area.width))
  const height = Math.max(1, Math.round(area.height))
  const x = Math.max(0, Math.min(Math.round(requested.x), width - 1))
  const y = Math.max(0, Math.min(Math.round(requested.y), height - 1))
  return {
    x,
    y,
    width: Math.max(1, Math.min(Math.round(requested.width), width - x)),
    height: Math.max(1, Math.min(Math.round(requested.height), height - y)),
  }
}

/** Main-process owner for the current visible Browser utility host rectangle. */
export class BrowserDockAnchor {
  readonly #waiters = new Set<DockWaiter>()
  #value: Readonly<Rectangle> | undefined

  /** Return a detached copy of the current host rectangle, or no geometry. */
  current(): Rectangle | undefined {
    return this.#value === undefined ? undefined : copyRectangle(this.#value)
  }

  /** Publish one trusted positive rectangle and release all pending mounts. */
  publish(value: Rectangle): void {
    if (!isPositiveRectangle(value)) {
      throw new AgentBrowserError('INTERNAL', 'browser dock anchor is invalid')
    }
    this.#value = Object.freeze(copyRectangle(value))
    const waiters = [...this.#waiters]
    this.#waiters.clear()
    for (const waiter of waiters) {
      waiter.signal?.removeEventListener('abort', waiter.onAbort)
      waiter.resolve(copyRectangle(this.#value))
    }
  }

  /** Forget host geometry when the Browser utility is no longer mounted. */
  clear(): void {
    this.#value = undefined
  }

  /** Wait for the Browser utility to publish a host rectangle without inventing fallback geometry. */
  wait(signal?: AbortSignal): Promise<Rectangle> {
    if (signal?.aborted === true) {
      return Promise.reject(new AgentBrowserError('CANCELLED', 'browser dock wait was cancelled'))
    }
    const current = this.current()
    if (current !== undefined) return Promise.resolve(current)
    return new Promise<Rectangle>((resolve, reject) => {
      const waiter: DockWaiter = {
        resolve,
        reject,
        signal,
        onAbort: () => {
          this.#waiters.delete(waiter)
          reject(new AgentBrowserError('CANCELLED', 'browser dock wait was cancelled'))
        },
      }
      this.#waiters.add(waiter)
      signal?.addEventListener('abort', waiter.onAbort, { once: true })
    })
  }
}
