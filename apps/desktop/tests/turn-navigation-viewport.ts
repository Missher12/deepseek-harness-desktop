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
