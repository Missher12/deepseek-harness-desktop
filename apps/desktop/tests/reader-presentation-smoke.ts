import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Locator, Page } from 'playwright'
import { expect } from 'vitest'
import {
  NATIVE_READER_APPEND, NATIVE_READER_PROMPT, NATIVE_READER_REASONING,
  type ReaderSmokeProvider,
} from './reader-smoke-provider.ts'

/** Native and browser readers share the same UI checks and deterministic barriers. */
export interface ReaderPresentationOptions {
  /** Advance the fixture only after the preceding visible state is verified. */
  driver: Pick<ReaderSmokeProvider, 'arm' | 'append' | 'answer' | 'finish'>
  /** Optional owned observer for the Host's durable Turn completion. */
  settled?: Promise<unknown>
  /** Optional screenshot folder; callers choose a private or CI evidence directory. */
  evidence?: { directory: string; prefix: string; suffix?: string }
  /** Capture the native final-answer projection while its process is folded. */
  onCompleted?: () => Promise<void>
}

/**
 * The reasoning body element the reader sees.
 *
 * The body is the row's last element, and it holds the literal text as one
 * child node. Anchoring here reads rendered text rather than an accessibility
 * attribute, so a paint that never reached the DOM fails the check.
 * @param page - the renderer page under test.
 * @returns the locator for the reasoning body element.
 */
function reasoningBody(page: Page): Locator {
  return page.locator('[data-variant="think"] > div:last-child').first()
}

/**
 * Exercise live reading through an already-open, empty native composer.
 * @param page - The actual renderer page from Chromium or packaged Electron.
 * @param options - Fixture barriers and optional evidence owners.
 * @returns after literal text, growth, selection, Markdown and geometry checks pass.
 */
export async function exerciseReaderPresentation(page: Page, options: ReaderPresentationOptions): Promise<void> {
  const previousViewport = page.viewportSize()
  const previousMotion = await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)
  void options.settled?.catch(() => {})
  const screenshot = async (state: string) => {
    if (options.evidence === undefined) return
    await mkdir(options.evidence.directory, { recursive: true })
    await page.screenshot({ path: join(options.evidence.directory, `${options.evidence.prefix}-${state}${options.evidence.suffix ?? ''}.png`) })
  }
  try {
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    const input = page.locator('[data-composer-input][contenteditable="true"]').first()
    await input.waitFor({ state: 'visible' })
    await input.click()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type(NATIVE_READER_PROMPT)
    options.driver.arm()
    await input.press('Enter')

    // The reasoning text itself, rendered in the reading flow. It arrives
    // progressively, so the poll waits for the paint to reach the complete
    // first delta rather than reading a partially revealed prefix.
    const body = reasoningBody(page)
    await body.waitFor({ state: 'visible', timeout: 30_000 })
    await expect.poll(() => body.textContent()).toBe(NATIVE_READER_REASONING)
    // One text node holds it, so a reader's Range offsets stay valid.
    expect(await body.evaluate(node => node.childNodes.length)).toBe(1)
    expect(await body.evaluate(node => node.firstChild?.nodeType)).toBe(3)

    // No reading control of its own: no button and no second scrollport.
    const row = page.locator('[data-variant="think"]').first()
    expect(await row.locator('button').count()).toBe(0)
    expect(await row.locator('[role="region"]').count()).toBe(0)

    // The block grows with its content instead of clipping it: a 24-line
    // fixture is taller than the 84px reading cap the block used to carry.
    const firstHeight = await body.evaluate(node => node.getBoundingClientRect().height)
    expect(firstHeight).toBeGreaterThan(150)
    expect(await row.evaluate(node => node.scrollHeight <= node.clientHeight + 1)).toBe(true)

    // A reader's selection inside the literal text survives the next append.
    await input.focus()
    await body.evaluate((node) => {
      const text = node.firstChild
      if (text === null) throw new Error('missing literal reasoning Text node')
      const range = document.createRange()
      range.setStart(text, 0)
      range.setEnd(text, 7)
      const selection = document.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
    })
    options.driver.append()
    await expect.poll(() => body.textContent()).toBe(NATIVE_READER_REASONING + NATIVE_READER_APPEND)
    expect(await page.evaluate(() => document.getSelection()?.toString())).toBe('Line 01')
    // The appended line made the block taller; nothing scrolled inside it.
    expect(await body.evaluate(node => node.getBoundingClientRect().height))
      .toBeGreaterThan(firstHeight)

    await page.emulateMedia({ reducedMotion: 'reduce' })
    expect(await page.locator('[data-variant="think"] [class*="status"]').evaluate(node => getComputedStyle(node).animationName)).toBe('none')
    await screenshot('streaming')

    options.driver.answer()
    const answer = page.getByRole('heading', { name: 'Native reader verified', exact: true })
    await answer.waitFor()
    expect(await body.isVisible()).toBe(true)
    // The reader's selection survived the answer arriving; the reveal only ever
    // appends to the same text node, so its Range offsets stay valid.
    expect(await page.evaluate(() => document.getSelection()?.toString())).toBe('Line 01')
    await page.evaluate(() => { document.getSelection()?.removeAllRanges() })
    options.driver.finish()
    await options.settled

    // The Turn's process disclosure covers tool and context rows; reasoning
    // stays in the reading flow whether or not it is open, including after the
    // Turn completes.
    const processControl = page.locator('[data-turn-process]')
    await processControl.waitFor({ state: 'visible', timeout: 30_000 })
    expect(await body.isVisible()).toBe(true)
    expect(await body.textContent()).toBe(NATIVE_READER_REASONING + NATIVE_READER_APPEND)
    expect(await answer.isVisible()).toBe(true)
    expect(await page.locator('.md-code-block pre.shiki').isVisible()).toBe(true)
    expect(await page.getByRole('table').isVisible()).toBe(true)
    await options.onCompleted?.()
    await screenshot('completed')

    // Reopening the disclosure keeps it visible; a narrow viewport wraps it
    // rather than hiding or clipping it.
    await processControl.click()
    expect(await body.isVisible()).toBe(true)
    expect(await body.textContent()).toBe(NATIVE_READER_REASONING + NATIVE_READER_APPEND)
    if (previousViewport !== null) {
      await page.setViewportSize({ width: 760, height: 700 })
      expect(await body.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
      expect(await body.isVisible()).toBe(true)
    }
    await processControl.click()
    expect(await body.isVisible()).toBe(true)
    expect(await body.textContent()).toBe(NATIVE_READER_REASONING + NATIVE_READER_APPEND)
  } finally {
    await page.emulateMedia({ reducedMotion: previousMotion ? 'reduce' : 'no-preference' })
    if (previousViewport !== null) await page.setViewportSize(previousViewport)
  }
}
