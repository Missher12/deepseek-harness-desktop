// Browser coverage for the prompt ruler's responsive accessibility boundary.
// The fixture is cold-seeded through the shipped persistence path, so prompt
// anchors are the same projection users navigate rather than a test-only DOM.
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Browser, Locator, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, afterEach, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
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
// Three targeted replay calibrations (three light and three dark captures
// each) measured 0–63 changed pixels. The per-tick raster assertion below
// separately protects every fully drawable tick, so this budget covers only
// known one-channel edge-compositing noise rather than an interior line loss.
const MAX_RAIL_PIXEL_DIFFERENCE = 63

/** Record only under the explicit snapshot refresh mode; replay never heals a missing visual baseline. */
interface PngPixels {
  readonly width: number
  readonly height: number
  readonly data: readonly number[]
}

interface PromptScrollCall {
  readonly seq: string
  readonly behavior: string | null
  readonly block: string | null
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

function differingPixels(expected: PngPixels, actual: PngPixels): number {
  let count = 0
  for (let index = 0; index < actual.data.length; index += 4) {
    if (
      actual.data[index] !== expected.data[index]
      || actual.data[index + 1] !== expected.data[index + 1]
      || actual.data[index + 2] !== expected.data[index + 2]
      || actual.data[index + 3] !== expected.data[index + 3]
    ) count += 1
  }
  return count
}

async function compareVisualGolden(path: string, image: Buffer, page: Page): Promise<number> {
  if (MODE === 'refresh') {
    await mkdir(SNAPSHOT_DIR, { recursive: true })
    await writeFile(path, image)
    return 0
  }
  if (!existsSync(path)) {
    throw new Error(`missing visual golden ${path} — run DSH_SNAPSHOT=refresh pnpm run test:web to generate it`)
  }
  const [expected, actual] = await Promise.all([pngPixels(page, await readFile(path)), pngPixels(page, image)])
  expect(actual.width).toBe(expected.width)
  expect(actual.height).toBe(expected.height)
  const differentPixelCount = differingPixels(expected, actual)
  expect(differentPixelCount).toBeLessThanOrEqual(MAX_RAIL_PIXEL_DIFFERENCE)
  return differentPixelCount
}

interface PromptTickBounds {
  readonly active: boolean
  readonly height: number
  readonly width: number
  readonly x: number
  readonly y: number
}

function imageRgb(pixels: PngPixels, x: number, y: number): readonly [number, number, number] {
  const start = (y * pixels.width + x) * 4
  return [pixels.data[start]!, pixels.data[start + 1]!, pixels.data[start + 2]!]
}

/** Verify the actual captured rails retain each fully drawable tick. */
async function expectRailTicksPainted(page: Page, image: Buffer): Promise<void> {
  const [pixels, ticks] = await Promise.all([
    pngPixels(page, image),
    page.locator('[data-prompt-rail-mark] [class*="promptRailTick"]').evaluateAll((nodes) => {
      const track = document.querySelector<HTMLElement>('[data-prompt-rail-track]')
      if (track === null) throw new Error('prompt rail track is missing')
      const trackRect = track.getBoundingClientRect()
      return nodes.map((node) => {
        const rect = (node as HTMLElement).getBoundingClientRect()
        return {
          active: node.closest('[data-prompt-rail-mark]')?.hasAttribute('data-active') ?? false,
          height: rect.height,
          width: rect.width,
          x: rect.left - trackRect.left,
          y: rect.top - trackRect.top,
        }
      })
    }),
  ])
  expect(ticks).toHaveLength(FIXTURE.turns)
  const track = await page.locator('[data-prompt-rail-track]').boundingBox()
  if (track === null) throw new Error('prompt rail track has no bounding box')
  const scaleX = pixels.width / track.width
  const scaleY = pixels.height / track.height
  let drawableTicks = 0
  for (const tick of ticks as PromptTickBounds[]) {
    // End marks are centered on the rail endpoints by design, leaving half of
    // their one-pixel line outside the screenshot clip. The two interior marks
    // are full raster targets; endpoint geometry remains covered by the golden.
    if (tick.y < 0 || tick.y + tick.height > track.height) continue
    drawableTicks += 1
    // The active dot covers the first 8px of its tick. Its exposed tail is
    // still a genuine 17px-wide raster target; neutral ticks use their whole line.
    const left = Math.max(0, Math.ceil((tick.x + (tick.active ? 8 : 0)) * scaleX))
    const right = Math.min(pixels.width, Math.floor((tick.x + tick.width) * scaleX))
    const top = Math.max(0, Math.floor(tick.y * scaleY))
    const bottom = Math.min(pixels.height, Math.ceil((tick.y + tick.height) * scaleY))
    const candidatePixels = (right - left) * (bottom - top)
    expect(candidatePixels).toBeGreaterThan(0)
    const centerY = Math.max(0, Math.min(pixels.height - 1, Math.round((tick.y + tick.height / 2) * scaleY)))
    const backgroundY = centerY + 5 < pixels.height ? centerY + 5 : centerY - 5
    let painted = 0
    for (let y = top; y < bottom; y += 1) {
      for (let x = left; x < right; x += 1) {
        const [red, green, blue] = imageRgb(pixels, x, y)
        const [backgroundRed, backgroundGreen, backgroundBlue] = imageRgb(pixels, x, backgroundY)
        if (Math.abs(red - backgroundRed) + Math.abs(green - backgroundGreen) + Math.abs(blue - backgroundBlue) >= 24) {
          painted += 1
        }
      }
    }
    // Fractional top positions may spread a 1px tick over two device rows.
    // Half the candidate box requires one complete visible raster row; a missing tick is zero.
    const required = Math.ceil(candidatePixels * 0.5)
    if (painted < required) {
      throw new Error(`prompt rail tick raster is missing: ${JSON.stringify({ tick, candidatePixels, painted, required })}`)
    }
  }
  expect(drawableTicks).toBe(FIXTURE.turns - 2)
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

async function expectFocused(locator: Locator): Promise<void> {
  await expect.poll(
    () => locator.evaluate(element => document.activeElement === element),
    { timeout: 5_000 },
  ).toBe(true)
}

async function installScrollProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    type NativeScrollIntoView = (this: Element, options?: boolean | ScrollIntoViewOptions) => void
    type Probe = {
      original: NativeScrollIntoView
      calls: Array<{ seq: string; behavior: string | null; block: string | null }>
    }
    const target = window as typeof window & { __dshPromptRailScrollProbe?: Probe }
    if (target.__dshPromptRailScrollProbe !== undefined) {
      throw new Error('prompt rail scroll probe is already installed')
    }
    const original: NativeScrollIntoView = Reflect.get(Element.prototype, 'scrollIntoView')
    const calls: Probe['calls'] = []
    target.__dshPromptRailScrollProbe = { original, calls }
    Element.prototype.scrollIntoView = function scrollIntoViewProbe(options?: boolean | ScrollIntoViewOptions): void {
      if (this instanceof HTMLElement && this.dataset.userMessageSeq !== undefined) {
        const normalized = typeof options === 'object' && options !== null ? options : undefined
        calls.push({
          seq: this.dataset.userMessageSeq,
          behavior: normalized?.behavior ?? null,
          block: normalized?.block ?? null,
        })
      }
      original.call(this, options)
    }
  })
}

async function clearScrollProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const target = window as typeof window & { __dshPromptRailScrollProbe?: { calls: unknown[] } }
    target.__dshPromptRailScrollProbe?.calls.splice(0)
  })
}

async function readScrollProbe(page: Page): Promise<readonly PromptScrollCall[]> {
  return await page.evaluate(() => {
    type Probe = { calls: Array<{ seq: string; behavior: string | null; block: string | null }> }
    const target = window as typeof window & { __dshPromptRailScrollProbe?: Probe }
    return target.__dshPromptRailScrollProbe?.calls ?? []
  })
}

async function restoreScrollProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    type Probe = { original: typeof Element.prototype.scrollIntoView }
    const target = window as typeof window & { __dshPromptRailScrollProbe?: Probe }
    const probe = target.__dshPromptRailScrollProbe
    if (probe === undefined) return
    Element.prototype.scrollIntoView = probe.original
    delete target.__dshPromptRailScrollProbe
  })
}

async function expectOneScrollTo(page: Page, seq: string): Promise<PromptScrollCall> {
  await expect.poll(() => readScrollProbe(page), { timeout: 5_000 }).toHaveLength(1)
  await page.evaluate(async () => {
    await new Promise<void>(resolve => requestAnimationFrame(() => {
      requestAnimationFrame(() => { resolve() })
    }))
  })
  const calls = await readScrollProbe(page)
  expect(calls).toHaveLength(1)
  const [call] = calls
  expect(call?.seq).toBe(seq)
  return call!
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

  afterEach(async () => {
    await restoreScrollProbe(page)
    await page.emulateMedia({ forcedColors: 'none', reducedMotion: 'no-preference' })
    await page.setViewportSize({ width: 900, height: 900 })
    await page.evaluate(() => { document.body.removeAttribute('data-ds-dark-theme') })
  })

  it.skipIf(MODE === 'record')('replays approved light and dark desktop rail pixels', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-prompt-rail-visual'))
    const lightCaptures: Buffer[] = []
    for (let sample = 0; sample < 3; sample += 1) lightCaptures.push(await railImage(page))
    for (const image of lightCaptures) {
      await expectRailTicksPainted(page, image)
      await compareVisualGolden(LIGHT_SNAPSHOT, image, page)
    }
    await page.evaluate(() => { document.body.setAttribute('data-ds-dark-theme', '') })
    const darkCaptures: Buffer[] = []
    for (let sample = 0; sample < 3; sample += 1) darkCaptures.push(await railImage(page))
    for (const image of darkCaptures) {
      await expectRailTicksPainted(page, image)
      await compareVisualGolden(DARK_SNAPSHOT, image, page)
    }
    const [lightPixels, darkPixels] = await Promise.all([
      pngPixels(page, lightCaptures[0]!),
      pngPixels(page, darkCaptures[0]!),
    ])
    expect(darkPixels.data.some((channel, index) => channel !== lightPixels.data[index])).toBe(true)
  })

  it.skipIf(MODE === 'record')('maps forced-colors rail primitives to distinct system colors', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-prompt-rail-forced-colors'))
    await page.emulateMedia({ forcedColors: 'active' })
    const forced = await page.evaluate(() => {
      const probe = document.createElement('div')
      probe.style.color = 'CanvasText'
      probe.style.background = 'Canvas'
      probe.style.border = '1px solid Highlight'
      probe.style.forcedColorAdjust = 'none'
      document.body.append(probe)
      const probeStyle = getComputedStyle(probe)
      const track = document.querySelector<HTMLElement>('[data-prompt-rail-track]')
      const inactiveTick = track?.querySelector<HTMLElement>('[data-prompt-rail-mark]:not([data-active]) [class*="promptRailTick"]')
      const activeTick = track?.querySelector<HTMLElement>('[data-prompt-rail-mark][data-active] [class*="promptRailTick"]')
      const dot = track?.querySelector<HTMLElement>('[data-prompt-rail-mark][data-active] [class*="promptRailActiveDot"]')
      if (track === null || inactiveTick == null || activeTick == null || dot == null) {
        throw new Error('prompt rail visual primitives are missing')
      }
      const result = {
        active: matchMedia('(forced-colors: active)').matches,
        canvasText: probeStyle.color,
        canvas: probeStyle.backgroundColor,
        highlight: probeStyle.borderTopColor,
        track: getComputedStyle(track, '::before').backgroundColor,
        inactiveTick: getComputedStyle(inactiveTick).borderTopColor,
        activeTick: getComputedStyle(activeTick).borderTopColor,
        dotBorder: getComputedStyle(dot).borderTopColor,
        dotBackground: getComputedStyle(dot).backgroundColor,
      }
      probe.remove()
      return result
    })
    expect(forced.active).toBe(true)
    expect(forced.track).toBe(forced.canvasText)
    expect(forced.inactiveTick).toBe(forced.canvasText)
    expect(forced.activeTick).toBe(forced.highlight)
    expect(forced.dotBorder).toBe(forced.highlight)
    expect(forced.dotBackground).toBe(forced.canvas)
    expect(forced.inactiveTick).not.toBe(forced.activeTick)
  })

  it.skipIf(MODE === 'record')('uses real keyboard roving keys without navigation and exact keyboard activation', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-prompt-rail-keyboard'))
    const rail = page.getByRole('navigation', { name: 'Previous prompts' })
    const marks = rail.locator('[data-prompt-rail-mark]')
    expect(await marks.count()).toBe(4)
    const userSeqs = await page.locator('[data-user-message-seq]').evaluateAll(
      rows => rows.map(row => row.getAttribute('data-user-message-seq')),
    )
    expect(userSeqs).toHaveLength(4)
    const before = await page.evaluate(() => ({
      href: location.href,
      historyLength: history.length,
      active: document.querySelector('[data-prompt-rail-mark][aria-current="true"]')?.getAttribute('aria-label') ?? null,
    }))
    await installScrollProbe(page)
    await clearScrollProbe(page)

    await marks.nth(1).focus()
    await page.keyboard.press('ArrowUp')
    await expectFocused(marks.nth(0))
    await page.keyboard.press('ArrowDown')
    await expectFocused(marks.nth(1))
    await page.keyboard.press('Home')
    await expectFocused(marks.nth(0))
    await page.keyboard.press('End')
    await expectFocused(marks.nth(3))
    expect(await readScrollProbe(page)).toEqual([])
    expect(await page.evaluate(() => ({
      href: location.href,
      historyLength: history.length,
      active: document.querySelector('[data-prompt-rail-mark][aria-current="true"]')?.getAttribute('aria-label') ?? null,
    }))).toEqual(before)

    await clearScrollProbe(page)
    await page.keyboard.press('Enter')
    await expectOneScrollTo(page, userSeqs[3]!)
    await marks.nth(3).focus()
    await clearScrollProbe(page)
    await page.keyboard.press('Space')
    await expectOneScrollTo(page, userSeqs[3]!)
  })

  it.skipIf(MODE === 'record')('restores compact selection focus and transfers it across breakpoint changes', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-prompt-rail-compact'))
    await page.setViewportSize({ width: 860, height: 900 })
    const trigger = page.getByRole('button', { name: /^Prompt navigation \(\d+ \/ 4\)$/ })
    await trigger.waitFor({ timeout: 10_000 })
    await trigger.click()
    const dialog = page.getByRole('dialog', { name: 'Prompt navigation' })
    expect(await dialog.getByRole('list').getByRole('listitem').count()).toBe(4)
    await installScrollProbe(page)
    const firstItem = dialog.getByRole('button').first()
    const firstSeq = (await page.locator('[data-user-message-seq]').evaluateAll(
      rows => rows.map(row => row.getAttribute('data-user-message-seq')),
    ))[0]!
    await firstItem.focus()
    await clearScrollProbe(page)
    await page.keyboard.press('Enter')
    expect(await dialog.count()).toBe(0)
    await expectFocused(trigger)
    await expectOneScrollTo(page, firstSeq)

    await trigger.click()
    await expectFocused(dialog)
    await page.setViewportSize({ width: 900, height: 900 })
    await expectFocused(page.locator('[data-prompt-rail-mark][aria-current="true"]'))

    await page.setViewportSize({ width: 860, height: 900 })
    await expectFocused(trigger)
    await page.setViewportSize({ width: 900, height: 900 })
    await expectFocused(page.locator('[data-prompt-rail-mark][aria-current="true"]'))
  })

  it.skipIf(MODE === 'record')('disables tick transitions and uses immediate prompt scrolling with reduced motion', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-prompt-rail-reduced-motion'))
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const reduced = await page.evaluate(() => {
      const tick = document.querySelector<HTMLElement>('[data-prompt-rail-mark] [class*="promptRailTick"]')
      if (tick === null) throw new Error('prompt rail tick is missing')
      const style = getComputedStyle(tick)
      return {
        enabled: matchMedia('(prefers-reduced-motion: reduce)').matches,
        transitionProperty: style.transitionProperty,
        transitionDuration: style.transitionDuration,
      }
    })
    expect(reduced.enabled).toBe(true)
    expect(reduced.transitionProperty).toBe('none')
    expect(reduced.transitionDuration).toBe('0s')

    const marks = page.locator('[data-prompt-rail-mark]')
    const userSeqs = await page.locator('[data-user-message-seq]').evaluateAll(
      rows => rows.map(row => row.getAttribute('data-user-message-seq')),
    )
    await installScrollProbe(page)
    await marks.first().focus()
    await clearScrollProbe(page)
    await page.keyboard.press('Enter')
    expect((await expectOneScrollTo(page, userSeqs[0]!)).behavior).toBe('auto')
  })
})
