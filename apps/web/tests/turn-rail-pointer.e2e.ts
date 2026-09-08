import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { prepareTurnNavigationViewport, verifyTurnNavigationClick } from '../../desktop/tests/turn-navigation-viewport.ts'
import { createChatScrollFixture } from './chat-scroll-fixture.ts'
import { launchWebScaffold, seedSession } from './scaffold.ts'
import { newEnglishPage } from './support.ts'

it('clicks through a partial history head and unloaded turns in both Desktop layouts', async () => {
  const fixture = createChatScrollFixture({ markerPrefix: 'POINTER', title: 'Rail pointer navigation' })
  const scaffold = await launchWebScaffold({})
  const browser = await chromium.launch()
  try {
    await seedSession(scaffold, fixture.log, 'rail-pointer-navigation')
    for (const platform of ['darwin', 'win32']) {
      const page = await newEnglishPage(browser)
      try {
        await page.setViewportSize({ width: 1250, height: 1112 })
        await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
        const url = new URL(page.url())
        url.searchParams.set('surface', 'desktop')
        if (platform === 'darwin') url.searchParams.set('titlebar', 'hidden-inset')
        await page.goto(url.href, { waitUntil: 'load' })
        const group = page.getByRole('treeitem').first()
        await group.waitFor({ timeout: 15_000 })
        if (await group.getAttribute('aria-expanded') !== 'true') await group.click()
        await page.getByRole('treeitem').nth(1).click()
        const rail = page.getByRole('navigation', { name: 'Turn navigation' })
        await rail.waitFor({ state: 'visible', timeout: 15_000 })
        await expect.poll(() => rail.getByRole('button').count()).toBe(fixture.turns)
        // The 50-message tail starts inside turn 65; its control seat is hidden.
        expect(await page.locator('[data-chat-turn="65"][data-chat-flow-kind="user"]').count()).toBe(0)
        expect(await page.locator('[data-chat-turn="65"][data-chat-flow-kind="turn-process"][hidden]').count()).toBe(1)
        await verifyTurnNavigationClick(page)
        await prepareTurnNavigationViewport(page)
        await verifyTurnNavigationClick(page)
      } finally {
        await page.close()
      }
    }
  } finally {
    await browser.close()
    await scaffold.close()
  }
}, 90_000)
