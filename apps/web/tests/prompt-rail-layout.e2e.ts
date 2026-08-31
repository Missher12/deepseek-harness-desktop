// Real Chromium geometry coverage for the prompt ruler beside responsive
// AppFrame columns. This is deliberately separate from the historical raster
// suite: it verifies layout relationships, not encoder-specific pixels.
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createChatScrollFixture } from './chat-scroll-fixture.ts'
import { launchWebScaffold, seedSession, type WebScaffold } from './scaffold.ts'
import { newEnglishPage } from './support.ts'

const SEED_ID = 'prompt-rail-layout-web-e2e'
const FIXTURE = createChatScrollFixture({
  markerPrefix: 'PROMPT_RAIL_LAYOUT',
  title: 'PROMPT_RAIL responsive geometry',
  turns: 4,
})

interface PromptRailGeometry {
  readonly mode: 'desktop' | 'compact'
  readonly promptCount: number
  readonly conversationWidth: number
  readonly leftInset: number
  readonly rightInset: number
  readonly textOverlaps: number
  readonly composerOverlap: boolean
}

async function openSeed(page: Page): Promise<void> {
  const searchButton = page.getByRole('button', { name: 'Search sessions' })
  if (await searchButton.getAttribute('aria-expanded') !== 'true') await searchButton.click()
  await page.getByRole('textbox', { name: 'Search sessions...', exact: true }).fill(FIXTURE.markers.user(1))
  const results = page.getByRole('tree', { name: 'Search results' }).getByRole('treeitem')
  const deadline = Date.now() + 60_000
  while (await results.count() !== 1) {
    if (Date.now() >= deadline) throw new Error('prompt rail geometry seed did not appear in search results')
    await page.waitForTimeout(100)
  }
  await results.click()
  await page.getByText(FIXTURE.markers.assistant(FIXTURE.turns), { exact: false })
    .last().waitFor({ timeout: 30_000 })
}

/** Wait for animated grid tracks and the conversation box to settle. */
async function settleConversationLayout(page: Page): Promise<void> {
  let previous = -1
  await expect.poll(async () => {
    const width = await page.locator('[data-conversation-scroll]').evaluate(element =>
      element.getBoundingClientRect().width)
    const settled = Math.abs(width - previous) <= 0.25
    previous = width
    return settled
  }, { timeout: 10_000 }).toBe(true)
  await page.evaluate(async () => {
    await new Promise<void>(resolve => requestAnimationFrame(() => {
      requestAnimationFrame(() => { resolve() })
    }))
  })
}

/** Measure actual painted rail primitives against text ranges and composer. */
async function promptRailGeometry(page: Page): Promise<PromptRailGeometry> {
  return await page.getByRole('navigation', { name: 'Previous prompts' }).evaluate((rail) => {
    type Rect = Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom' | 'width' | 'height'>
    const rectOf = (element: Element): Rect => element.getBoundingClientRect()
    const overlaps = (left: Rect, right: Rect): boolean => (
      left.left < right.right - 0.5
      && left.right > right.left + 0.5
      && left.top < right.bottom - 0.5
      && left.bottom > right.top + 0.5
    )
    const conversation = document.querySelector<HTMLElement>('[data-conversation-scroll]')
    const composer = document.querySelector<HTMLElement>('[data-composer-card]')
    if (conversation === null || composer === null) throw new Error('conversation geometry targets are missing')
    const track = rail.querySelector<HTMLElement>('[data-prompt-rail-track]')
    const primitives = track === null
      ? [...rail.querySelectorAll<HTMLElement>('button[aria-haspopup="dialog"]')]
      : [...track.querySelectorAll<HTMLElement>(
        '[class*="promptRailTick"], [class*="promptRailActiveDot"]',
      )]
    const primitiveBoxes = primitives.map(rectOf).filter(rect => rect.width > 0 && rect.height > 0)
    if (primitiveBoxes.length === 0) throw new Error('prompt rail primitives have no painted boxes')
    const visual: Rect = {
      left: Math.min(...primitiveBoxes.map(rect => rect.left)),
      right: Math.max(...primitiveBoxes.map(rect => rect.right)),
      top: Math.min(...primitiveBoxes.map(rect => rect.top)),
      bottom: Math.max(...primitiveBoxes.map(rect => rect.bottom)),
      width: 0,
      height: 0,
    }
    const textBoxes = [...document.querySelectorAll<HTMLElement>(
      '[data-chat-flow] > [data-chat-flow-key]:not(:empty):not([hidden])',
    )].flatMap((row) => {
      const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT)
      const boxes: Rect[] = []
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        if (node.textContent?.trim() === '') continue
        const range = document.createRange()
        range.selectNodeContents(node)
        boxes.push(...[...range.getClientRects()].map(rect => ({
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        })))
      }
      return boxes
    }).filter(rect => rect.width > 0 && rect.height > 0)
    const conversationBox = rectOf(conversation)
    return {
      mode: track === null ? 'compact' : 'desktop',
      promptCount: document.querySelectorAll('[data-chat-flow-kind="user"], [data-chat-flow-kind="steering"]').length,
      conversationWidth: conversationBox.width,
      leftInset: visual.left - conversationBox.left,
      rightInset: conversationBox.right - visual.right,
      textOverlaps: textBoxes.filter(text => overlaps(visual, text)).length,
      composerOverlap: overlaps(visual, rectOf(composer)),
    }
  })
}

async function expectPromptRailLayout(
  page: Page,
  mode: PromptRailGeometry['mode'],
): Promise<PromptRailGeometry> {
  await settleConversationLayout(page)
  const geometry = await promptRailGeometry(page)
  const evidence = JSON.stringify(geometry)
  expect(geometry.mode, evidence).toBe(mode)
  expect(geometry.promptCount, evidence).toBeGreaterThanOrEqual(2)
  if (mode === 'desktop') {
    expect(geometry.leftInset, evidence).toBeGreaterThanOrEqual(8)
    expect(geometry.leftInset, evidence).toBeLessThanOrEqual(20)
  } else {
    expect(geometry.rightInset, evidence).toBeGreaterThanOrEqual(24)
    expect(geometry.rightInset, evidence).toBeLessThanOrEqual(56)
  }
  expect(geometry.textOverlaps, evidence).toBe(0)
  expect(geometry.composerOverlap, evidence).toBe(false)
  return geometry
}

/** Reload through the real persisted AppFrame utility-column state. */
async function reloadWithUtilityColumn(page: Page, open: boolean): Promise<void> {
  await page.evaluate((utilityOpen) => {
    const key = 'dsh.layout.panels.v2'
    const raw = localStorage.getItem(key)
    const persisted = raw === null ? {} : JSON.parse(raw) as Record<string, unknown>
    localStorage.setItem(key, JSON.stringify({
      sidebar: 320,
      sidebarLastExpanded: 320,
      details: 0,
      narrow: false,
      narrowExpanded: false,
      ...persisted,
      utilityOpen,
      utilityMode: 'browser',
      utilityWidth: 720,
    }))
  }, open)
  await page.reload({ waitUntil: 'load' })
  await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  await openSeed(page)
}

describe('web e2e: prompt rail responsive geometry', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    await seedSession(scaffold, FIXTURE.log, SEED_ID)
    browser = await chromium.launch()
    page = await newEnglishPage(browser, 1_680)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await openSeed(page)
  }, 180_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('keeps navigation outside text and the composer across wide, split, and compact layouts', async () => {
    const wide = await expectPromptRailLayout(page, 'desktop')

    await reloadWithUtilityColumn(page, true)
    try {
      const split = await expectPromptRailLayout(page, 'desktop')
      expect(split.conversationWidth).toBeLessThan(wide.conversationWidth - 500)
    } finally {
      await reloadWithUtilityColumn(page, false)
    }

    await page.setViewportSize({ width: 800, height: 900 })
    await expectPromptRailLayout(page, 'compact')
  })
})
