/** A delayed real ResizeObserver must not stale the installed smoke's width baseline. */
import { readFile } from 'node:fs/promises'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prepareTurnNavigationViewport } from '../../desktop/tests/turn-navigation-viewport.ts'
import { launchWebScaffold, seedSession, type WebScaffold } from './scaffold.ts'
import { newEnglishPage } from './support.ts'

type BarrierWindow = typeof window & {
  navigationResizeBarrier: {
    armed: boolean
    pending: (() => void)[]
    release: () => void
    collapsed?: Promise<void>
  }
}

describe('web e2e: installed transcript viewport readiness', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    await seedSession(scaffold, await readFile(
      new URL('../../../snapshots/web/seeded-history/session.v2.jsonl', import.meta.url), 'utf8',
    ), 'turn-navigation-viewport')
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    await page.setViewportSize({ width: 1600, height: 1000 })
    await page.addInitScript(() => {
      const barrier = {
        armed: false,
        pending: [] as (() => void)[],
        release() {
          barrier.armed = false
          for (const callback of barrier.pending.splice(0)) callback()
        },
      }
      ;(window as BarrierWindow).navigationResizeBarrier = barrier
      const NativeResizeObserver = window.ResizeObserver
      window.ResizeObserver = class extends NativeResizeObserver {
        constructor(callback: ResizeObserverCallback) {
          super((entries, observer) => {
            if (barrier.armed && entries.some(entry => entry.target.matches('[class*="frame"]'))) {
              barrier.pending.push(() => { callback(entries, observer) })
            } else callback(entries, observer)
          })
        }
      }
    })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    const group = page.getByRole('treeitem').first()
    await group.waitFor({ timeout: 15_000 })
    if (await group.getAttribute('aria-expanded') !== 'true') await group.click()
    await page.getByRole('treeitem').nth(1).click()
    await page.locator('[data-chat-flow]').first().waitFor({ timeout: 15_000 })
  })

  afterAll(async () => {
    try { await browser?.close() } finally { await scaffold?.close() }
  })

  it('waits for the delayed narrow layout before taking the unchanged width baseline', async () => {
    await page.evaluate(() => {
      const barrier = (window as BarrierWindow).navigationResizeBarrier
      const frame = document.querySelector('[class*="frame"]')
      if (frame === null) throw new Error('AppFrame is unavailable')
      barrier.armed = true
      barrier.collapsed = new Promise<void>((resolve) => {
        const observer = new MutationObserver(() => {
          if (!frame.hasAttribute('data-sidebar-collapsed')) return
          observer.disconnect()
          resolve()
        })
        observer.observe(frame, { attributes: true, attributeFilter: ['data-sidebar-collapsed'] })
      })
    })
    const preparing = prepareTurnNavigationViewport(page)
    const flow = page.locator('[data-chat-flow]').first()
    try {
      await expect.poll(() => page.evaluate(
        () => (window as BarrierWindow).navigationResizeBarrier.pending.length,
      )).toBeGreaterThan(0)
      const before = await flow.boundingBox()
      await page.evaluate(() => { (window as BarrierWindow).navigationResizeBarrier.release() })
      await Promise.all([
        preparing,
        page.evaluate(() => (window as BarrierWindow).navigationResizeBarrier.collapsed),
      ])
      expect(await page.getByRole('button', { name: 'Open sidebar', exact: true }).count()).toBe(0)
      expect((await flow.boundingBox())?.width).toBe(before?.width)
    } finally {
      await page.evaluate(() => { (window as BarrierWindow).navigationResizeBarrier.release() })
      await preparing
    }
  })
})
