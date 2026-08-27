// Browser coverage for the prompt ruler's responsive accessibility boundary.
// The fixture is cold-seeded through the shipped persistence path, so prompt
// anchors are the same projection users navigate rather than a test-only DOM.
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { createChatScrollFixture } from './chat-scroll-fixture.ts'
import { launchWebScaffold, seedSession, webSnapshotMode, type WebScaffold } from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/prompt-rail', import.meta.url))
const LIGHT_SNAPSHOT = fileURLToPath(new URL('./snapshots/prompt-rail/light.png', import.meta.url))
const DARK_SNAPSHOT = fileURLToPath(new URL('./snapshots/prompt-rail/dark.png', import.meta.url))
const MODE = webSnapshotMode()
const SEED_ID = 'prompt-rail-web-e2e'
const FIXTURE = createChatScrollFixture({
  markerPrefix: 'PROMPT_RAIL',
  title: 'PROMPT_RAIL responsive navigation',
  turns: 4,
})

/** Record only under the explicit snapshot refresh mode; replay never heals a missing visual baseline. */
interface PngPixels {
  readonly width: number
  readonly height: number
  readonly data: readonly number[]
}

/** Decode both goldens and captures in Chromium, comparing painted pixels rather than PNG encoder metadata. */
async function pngPixels(page: Page, png: Buffer): Promise<PngPixels> {
  return page.evaluate(async (dataUrl) => {
    const image = new Image()
    image.src = dataUrl
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d')
    if (context === null) throw new Error('2d canvas is unavailable for prompt rail snapshot comparison')
    context.drawImage(image, 0, 0)
    return { width: image.width, height: image.height, data: [...context.getImageData(0, 0, image.width, image.height).data] }
  }, `data:image/png;base64,${png.toString('base64')}`)
}

async function compareVisualGolden(path: string, image: Buffer, page: Page): Promise<void> {
  if (MODE === 'refresh') {
    await mkdir(SNAPSHOT_DIR, { recursive: true })
    await writeFile(path, image)
    return
  }
  if (!existsSync(path)) {
    throw new Error(`missing visual golden ${path} — run DSH_SNAPSHOT=refresh pnpm run test:web to generate it`)
  }
  const [expected, actual] = await Promise.all([pngPixels(page, await readFile(path)), pngPixels(page, image)])
  expect(actual.width).toBe(expected.width)
  expect(actual.height).toBe(expected.height)
  const differentChannels = actual.data.reduce(
    (count, channel, index) => count + Number(channel !== expected.data[index]),
    0,
  )
  // Chromium occasionally shifts a handful of edge-antialiasing channels
  // between otherwise identical captures; a visible rail regression changes
  // substantially more than this single-channel raster noise budget.
  expect(differentChannels).toBeLessThanOrEqual(256)
}

async function openSeed(page: Page): Promise<void> {
  const searchButton = page.getByRole('button', { name: 'Search sessions' })
  if (await searchButton.getAttribute('aria-expanded') !== 'true') await searchButton.click()
  await page.getByRole('textbox', { name: 'Search sessions...', exact: true }).fill(FIXTURE.markers.user(1))
  const results = page.getByRole('tree', { name: 'Search results' }).getByRole('treeitem')
  const deadline = Date.now() + 60_000
  while (await results.count() !== 1) {
    if (Date.now() >= deadline) throw new Error('prompt rail seed did not appear in search results')
    await page.waitForTimeout(100)
  }
  await results.click()
  await page.getByText(FIXTURE.markers.assistant(FIXTURE.turns), { exact: false }).last().waitFor({ timeout: 30_000 })
}

/** Capture the rendered desktop gutter itself, isolated from transcript layout and text antialiasing. */
async function railImage(page: Page): Promise<Buffer> {
  const track = page.locator('[data-prompt-rail-track]')
  await track.waitFor({ timeout: 30_000 })
  return await track.screenshot()
}

describe('web e2e: prompt rail stays reachable outside the desktop gutter', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    await seedSession(scaffold, FIXTURE.log, SEED_ID)
    browser = await chromium.launch()
    page = await newEnglishPage(browser, 900)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await openSeed(page)
  }, 180_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it.skipIf(MODE === 'record')('replays approved light and dark desktop rail pixels', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-prompt-rail-visual'))
    const light = await railImage(page)
    await compareVisualGolden(LIGHT_SNAPSHOT, light, page)
    await page.evaluate(() => { document.body.setAttribute('data-ds-dark-theme', '') })
    const dark = await railImage(page)
    await compareVisualGolden(DARK_SNAPSHOT, dark, page)
    const [lightPixels, darkPixels] = await Promise.all([pngPixels(page, light), pngPixels(page, dark)])
    expect(darkPixels.data.some((channel, index) => channel !== lightPixels.data[index])).toBe(true)
    await page.evaluate(() => { document.body.removeAttribute('data-ds-dark-theme') })
  })

  it.skipIf(MODE === 'record')('uses system colors in forced-colors and a compact dialog at 860px', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-prompt-rail-compact'))
    await page.emulateMedia({ forcedColors: 'active' })
    const forced = await page.evaluate(() => {
      const track = document.querySelector<HTMLElement>('[data-prompt-rail-track]')
      const tick = track?.querySelector<HTMLElement>('[class*="promptRailTick"]')
      const dot = track?.querySelector<HTMLElement>('[class*="promptRailActiveDot"]')
      if (track === null || tick == null || dot == null) throw new Error('prompt rail visual primitives are missing')
      return {
        active: matchMedia('(forced-colors: active)').matches,
        track: getComputedStyle(track, '::before').backgroundColor,
        tick: getComputedStyle(tick).backgroundColor,
        dotBorder: getComputedStyle(dot).borderTopColor,
      }
    })
    expect(forced.active).toBe(true)
    expect(forced.track).not.toBe('rgba(0, 0, 0, 0)')
    expect(forced.tick).not.toBe('rgba(0, 0, 0, 0)')
    expect(forced.dotBorder).not.toBe('rgba(0, 0, 0, 0)')

    await page.emulateMedia({ forcedColors: 'none' })
    await page.setViewportSize({ width: 860, height: 900 })
    const trigger = page.getByRole('button', { name: /^Prompt navigation \(\d+ \/ 4\)$/ })
    await trigger.waitFor({ timeout: 10_000 })
    await trigger.click()
    const dialog = page.getByRole('dialog', { name: 'Prompt navigation' })
    expect(await dialog.getByRole('list').getByRole('listitem').count()).toBe(4)
    await page.keyboard.press('Escape')
    expect(await dialog.count()).toBe(0)
    await expect.poll(() => trigger.evaluate(element => document.activeElement === element), { timeout: 5_000 }).toBe(true)
  })
})
