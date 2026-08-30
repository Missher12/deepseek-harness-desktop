import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BrowserDockAnchor, clampBrowserDockBounds } from '../src/browser/dock-anchor.ts'

describe('BrowserDockAnchor', () => {
  it('does not invent geometry before the Browser utility publishes an anchor', () => {
    const anchor = new BrowserDockAnchor()

    expect(anchor.current()).toBeUndefined()
  })

  it('releases a waiter only after a positive dock rectangle is published', async () => {
    const anchor = new BrowserDockAnchor()
    const waiting = anchor.wait()

    let settled = false
    void waiting.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)

    anchor.publish({ x: 780, y: 116, width: 720, height: 684 })
    await expect(waiting).resolves.toEqual({ x: 780, y: 116, width: 720, height: 684 })
  })

  it('clears a published rectangle when the Browser utility closes', () => {
    const anchor = new BrowserDockAnchor()
    anchor.publish({ x: 780, y: 116, width: 720, height: 684 })

    anchor.clear()

    expect(anchor.current()).toBeUndefined()
  })

  it('rejects an aborted waiter without publishing fallback geometry', async () => {
    const anchor = new BrowserDockAnchor()
    const controller = new AbortController()
    const waiting = anchor.wait(controller.signal)

    controller.abort()

    await expect(waiting).rejects.toMatchObject({ code: 'CANCELLED' })
    expect(anchor.current()).toBeUndefined()
  })

  it('copies published and returned rectangles across the authority boundary', async () => {
    const anchor = new BrowserDockAnchor()
    const input = { x: 780, y: 116, width: 720, height: 684 }
    anchor.publish(input)
    input.x = 0

    const first = anchor.current()
    if (first === undefined) throw new Error('dock anchor missing')
    ;(first as { x: number }).x = 1

    expect(anchor.current()).toEqual({ x: 780, y: 116, width: 720, height: 684 })
    await expect(anchor.wait()).resolves.toEqual({ x: 780, y: 116, width: 720, height: 684 })
  })

  it('clamps renderer geometry to the current content-view coordinate space', () => {
    expect(clampBrowserDockBounds(
      { width: 1600, height: 900 },
      { x: 780.4, y: 116.2, width: 1000, height: 900 },
    )).toEqual({ x: 780, y: 116, width: 820, height: 784 })
  })

  it('wires Electron main without a full-height right-edge fallback', () => {
    const source = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')

    expect(source).toContain('waitForBounds: signal => browserDockAnchor.wait(signal)')
    expect(source).toContain('browserDockAnchor.clear()')
    expect(source).not.toContain('function agentBrowserBounds')
    expect(source).not.toContain('Math.min(420, area.width)')
  })
})
