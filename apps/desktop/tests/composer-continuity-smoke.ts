import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from 'playwright'
import { expect } from 'vitest'

/** Native evidence over isolated, already-seeded Sessions; no model request is sent. */
interface ComposerContinuityOptions {
  selectSession: (title: string) => Promise<void>
  primaryTitle: string
  primaryTurns: number
  secondaryTitle: string
  evidenceDirectory: string
  platform: NodeJS.Platform
}

/**
 * Verify current-session statistics and actual light/dark resting and focused outlines.
 * @param page - The packaged application's renderer.
 * @param options - Seed ownership, sidebar navigation and private evidence destination.
 * @returns After the primary Session and original theme preference are restored.
 */
export async function exerciseComposerContinuity(page: Page, options: ComposerContinuityOptions): Promise<void> {
  const settings = page.locator('[data-dsh-desktop-command="open-settings"]')
  const stats = page.locator('[data-conversation-stats]')
  const card = page.locator('[data-composer-card]').last()
  const input = card.locator('[data-composer-input][contenteditable="true"]')
  const samples: unknown[] = []
  const openGeneral = async () => {
    await settings.click()
    const dialog = page.getByRole('dialog').last()
    await dialog.waitFor({ state: 'visible' })
    await dialog.getByRole('button', { name: /^(?:General|通用设置)$/u }).click()
    return dialog
  }
  const closeSettings = async () => {
    await page.keyboard.press('Escape')
    await expect.poll(() => settings.getAttribute('aria-expanded')).not.toBe('true')
  }
  const expectTurns = async (turns: number) => {
    await stats.waitFor({ state: 'visible', timeout: 15_000 })
    await expect.poll(() => stats.innerText(), { timeout: 15_000 })
      .toMatch(new RegExp(`^${turns} (?:turns|轮)`, 'u'))
    const bounds = await stats.boundingBox()
    expect(bounds?.height).toBeGreaterThan(0)
    return stats.innerText()
  }

  await mkdir(options.evidenceDirectory, { recursive: true })
  await options.selectSession(options.primaryTitle)
  const primaryStats = await expectTurns(options.primaryTurns)
  await options.selectSession(options.secondaryTitle)
  const secondaryStats = await expectTurns(1)
  expect(secondaryStats).not.toBe(primaryStats)
  await options.selectSession(options.primaryTitle)
  expect(await expectTurns(options.primaryTurns)).toBe(primaryStats)

  let savedTheme: string | undefined
  try {
    const initial = await openGeneral()
    savedTheme = await initial.getByRole('button', {
      name: /^(?:Light|Dark|System|浅色|深色|跟随系统)$/u, pressed: true,
    }).innerText()
    await closeSettings()
    for (const theme of ['light', 'dark'] as const) {
      const dialog = await openGeneral()
      await dialog.getByRole('button', {
        name: theme === 'light' ? /^(?:Light|浅色)$/u : /^(?:Dark|深色)$/u,
      }).click()
      await closeSettings()
      await expect.poll(() => page.locator('body').evaluate(body => body.hasAttribute('data-ds-dark-theme')))
        .toBe(theme === 'dark')
      for (const focused of [false, true]) {
        if (focused) await input.focus()
        else await settings.focus()
        const style = await card.evaluate((element, active) => {
          const css = getComputedStyle(element)
          return {
            focused: element.matches(':focus-within'),
            stroke: css.getPropertyValue('--dsw-elevation-stroke-color').trim(),
            expected: css.getPropertyValue(active ? '--dsw-alias-state-business-primary' : '--dsw-alias-border-l4').trim(),
            boxShadow: css.boxShadow,
          }
        }, focused)
        expect(style.focused).toBe(focused)
        expect(style.stroke).not.toBe('')
        expect(style.stroke).toBe(style.expected)
        expect(style.boxShadow).toContain(`0px 0px 0px ${focused ? 2 : 1}px`)
        expect(await stats.isVisible()).toBe(true)
        samples.push({ theme, ...style })
        await page.screenshot({ path: join(options.evidenceDirectory,
          `desktop-smoke-composer-${theme}-${focused ? 'focus' : 'rest'}-${options.platform}.png`) })
      }
    }
  } finally {
    if (await settings.getAttribute('aria-expanded') === 'true') await closeSettings()
    if (savedTheme !== undefined) {
      const dialog = await openGeneral()
      await dialog.getByRole('button', { name: savedTheme, exact: true }).click()
      await closeSettings()
    }
  }
  await writeFile(join(options.evidenceDirectory, `desktop-smoke-composer-${options.platform}.json`),
    `${JSON.stringify({ primaryStats, secondaryStats, samples }, null, 2)}\n`)
}
