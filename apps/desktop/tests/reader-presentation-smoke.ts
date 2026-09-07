import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from 'playwright'
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
 * Exercise live reading through an already-open, empty native composer.
 * @param page - The actual renderer page from Chromium or packaged Electron.
 * @param options - Fixture barriers and optional evidence owners.
 * @returns after literal text, selection, folding, Markdown and geometry checks pass.
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
    const port = page.getByRole('region', { name: /^(?:Reasoning content|思考内容)$/u })
    await port.waitFor({ state: 'visible', timeout: 30_000 })
    await expect.poll(() => port.textContent()).toBe(NATIVE_READER_REASONING)
    await expect.poll(() => port.evaluate(node => node.scrollTop), { timeout: 5_000 }).toBeGreaterThan(0)
    await port.hover()
    await page.mouse.wheel(0, -80)
    await page.getByRole('button', { name: /^(?:Follow latest|跟随最新)$/u }).waitFor()
    await page.getByRole('button', { name: /^(?:Expand reasoning|展开思考)$/u }).click()
    const expandedHeight = await port.evaluate(node => node.clientHeight)
    expect(expandedHeight).toBeGreaterThan(200)
    await page.getByRole('button', { name: /^(?:Collapse reasoning|收起思考)$/u }).click()
    expect(await port.evaluate(node => node.clientHeight)).toBeLessThan(expandedHeight)
    await input.focus()
    await port.evaluate((node) => {
      const text = node.firstElementChild?.firstChild
      if (text === undefined || text === null) throw new Error('missing literal reasoning Text node')
      const range = document.createRange()
      range.setStart(text, 0)
      range.setEnd(text, 7)
      const selection = document.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      node.setAttribute('data-reader-retained', 'true')
    })
    options.driver.append()
    await expect.poll(() => port.textContent()).toBe(NATIVE_READER_REASONING + NATIVE_READER_APPEND)
    expect(await page.evaluate(() => document.getSelection()?.toString())).toBe('Line 01')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    expect(await page.locator('[data-variant="think"] [class*="status"]').evaluate(node => getComputedStyle(node).animationName)).toBe('none')
    await screenshot('streaming')
    options.driver.answer()
    const answer = page.getByRole('heading', { name: 'Native reader verified', exact: true })
    await answer.waitFor()
    expect(await port.isVisible()).toBe(true)
    options.driver.finish()
    await options.settled
    const processControl = page.locator('[data-turn-process]')
    await processControl.waitFor({ state: 'visible', timeout: 30_000 })
    expect(await port.isVisible()).toBe(true)
    expect(await port.getAttribute('data-reader-retained')).toBe('true')
    await page.evaluate(() => { document.getSelection()?.removeAllRanges() })
    await expect.poll(() => port.isVisible()).toBe(false)
    expect(await answer.isVisible()).toBe(true)
    expect(await page.locator('.md-code-block pre.shiki').isVisible()).toBe(true)
    expect(await page.getByRole('table').isVisible()).toBe(true)
    await options.onCompleted?.()
    await screenshot('completed')
    await processControl.click()
    expect(await port.isVisible()).toBe(true)
    expect(await port.textContent()).toBe(NATIVE_READER_REASONING + NATIVE_READER_APPEND)
    if (previousViewport !== null) {
      await page.setViewportSize({ width: 760, height: 700 })
      expect(await port.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
    }
    await processControl.click()
    await expect.poll(() => port.isVisible()).toBe(false)
  } finally {
    await page.emulateMedia({ reducedMotion: previousMotion ? 'reduce' : 'no-preference' })
    if (previousViewport !== null) await page.setViewportSize(previousViewport)
  }
}
