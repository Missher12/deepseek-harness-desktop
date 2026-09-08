import type { Page } from 'playwright'
import { expect } from 'vitest'

/**
 * Prepare the installed-size transcript after the caller's expanded wide viewport.
 * @param page - Packaged or assembled client at the preceding wide viewport.
 * @returns Completion after the narrow sidebar has been re-expanded and settled.
 */
export async function prepareTurnNavigationViewport(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1012, height: 760 })
  const openSidebar = page.getByRole('button', { name: /^(?:Open sidebar|打开侧边栏)$/u })
  // AppFrame observes the new width through ResizeObserver -> rAF. A count
  // taken immediately after resize can still see the previous wide layout.
  await openSidebar.waitFor({ state: 'visible', timeout: 15_000 })
  await openSidebar.click()
  await expect.poll(
    () => page.locator('[class*="frame"][data-sidebar-collapsed]').count(),
    { timeout: 15_000 },
  ).toBe(0)
  await page.evaluate(async () => {
    const transitions = document.getAnimations().filter(animation =>
      animation.playState === 'running' && Number.isFinite(animation.effect?.getComputedTiming().endTime))
    await Promise.all(transitions.map(animation => animation.finished.catch(() => undefined)))
  })
}

/**
 * Click the first loaded and oldest known turns through the actual pointer rail.
 * @param page - Packaged or assembled client showing a multi-turn history.
 * @returns Completion once the selected transcript rows reach the reading line.
 */
export async function verifyTurnNavigationClick(page: Page): Promise<void> {
  const rail = page.locator('nav[aria-label="Turn navigation"], nav[aria-label="轮次导航"]')
  const visited = new Set<number>()
  for (const loadedOnly of [true, false]) {
    const mark = loadedOnly
      ? rail.getByRole('button', { name: /^(?:Jump to turn \d+|跳转到第 \d+ 轮)$/u }).first()
      : rail.getByRole('button').first()
    const label = await mark.getAttribute('aria-label')
    const digits = label?.match(/\d+/u)?.[0]
    if (digits === undefined) throw new Error('Turn navigation mark has no turn number.')
    const turn = Number(digits)
    if (visited.has(turn)) continue
    visited.add(turn)
    await rail.hover()
    // Keep only the rail's ladder in view; scrolling all ancestors can move
    // the transcript before the click and conceal a no-op navigation bug.
    await mark.evaluate((button) => {
      const track = button.closest('[data-turn-navigation-track]')
      if (!(track instanceof HTMLElement)) throw new Error('Turn navigation track is unavailable.')
      track.scrollTop += button.getBoundingClientRect().top - track.getBoundingClientRect().top
        - track.clientHeight / 2
    })
    const box = await mark.boundingBox()
    if (box === null) throw new Error('Turn navigation mark has no layout box.')
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.move(0, 0)
    // A partial history head has no user message yet; its first actual
    // transcript row is the destination, never the hidden process controller.
    await expect.poll(() => page.evaluate((targetTurn) => {
      const port = document.querySelector('[data-conversation-scroll]')
      if (!(port instanceof HTMLElement)) return false
      const rows = Array.from(port.querySelectorAll<HTMLElement>(
        '[data-chat-anchor-key]:not([hidden]):not(:empty)',
      )).filter(row => Number(row.dataset.chatTurn) === targetTurn
        && row.dataset.chatFlowKind !== 'turn-process')
      const target = rows.find(row => row.dataset.chatFlowKind === 'user') ?? rows[0]
      if (target === undefined) return false
      const top = target.getBoundingClientRect().top - port.getBoundingClientRect().top
      return top >= 0 && top <= 64
    }, turn), { timeout: 15_000 }).toBe(true)
  }
}
