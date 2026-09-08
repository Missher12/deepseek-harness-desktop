import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import {
  activateSmokeSession, exerciseExistingSessionModelSwitch, seedWindowsClipboardSmokeState, waitForDesktopSessionReady,
} from '../../desktop/tests/packaged-smoke.ts'
import { exerciseComposerContinuity } from '../../desktop/tests/composer-continuity-smoke.ts'
import { startReaderSmokeProvider } from '../../desktop/tests/reader-smoke-provider.ts'
import { launchWebScaffold, watchConsole } from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

// Rehearse the exact native helpers on the assembled UI before an expensive
// platform build. A Session's cwd/title does not register it as a Workspace.
it('navigates grouped and ungrouped seeds, switches routes, and preserves composer statistics and themes', async () => {
  const scaffold = await launchWebScaffold({
    extraOverlayPath: fileURLToPath(new URL('../../desktop/desktop.cordis.patch.yml', import.meta.url)),
    extraInstallAnchors: [fileURLToPath(new URL('../../desktop/package.json', import.meta.url))],
  })
  let browser: Browser | undefined
  let page: Page | undefined
  let provider: Awaited<ReturnType<typeof startReaderSmokeProvider>> | undefined
  try {
    browser = await chromium.launch()
    provider = await startReaderSmokeProvider()
    vi.stubEnv('DSH_DESKTOP_SMOKE_MODEL_KEY', 'isolated-desktop-test-key')
    const baseURL = provider.url
    const seeded = await seedWindowsClipboardSmokeState(scaffold.harnessHome, scaffold.persistenceRoot)
    const workspace = await scaffold.ctx.workspaceRegistry.create(join(scaffold.harnessHome, seeded.activeSessionTitle))
    await workspace.attachSession(SessionId(seeded.activeSessionId))
    await scaffold.ctx.settings.update('llm-pi-ai', {
      providers: Object.fromEntries(([
        ['desktop-smoke', 'Desktop Smoke', 'native-thinker', 'Native Smoke Thinker'],
        ['desktop-smoke-alternate', 'Desktop Smoke Alternate', 'native-switcher', 'Native Smoke Switcher'],
      ] as const).map(([id, displayName, model, name]) => [id, {
        displayName, apiKeyEnv: 'DSH_DESKTOP_SMOKE_MODEL_KEY', api: 'openai-completions',
        baseURL, reasoning: 'high',
        models: [{ id: model, name, contextWindow: 65536, maxTokens: 4096, reasoningEfforts: { high: 'high' } }],
      }] as const)),
    })
    await scaffold.ctx.agentDefaultModel.saveSelection({ provider: 'desktop-smoke', model: 'native-thinker', reasoningEffort: ReasoningEffortId('high') })
    page = await newEnglishPage(browser)
    const renderer = page
    const consoleWatch = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.goto(`${scaffold.baseUrl}/?surface=desktop`, { waitUntil: 'load' })
    await page.locator('[class*="projectRow"]').first().waitFor({ state: 'visible' })

    // Exercise both collapsed group kinds, then the already-visible path.
    for (const title of [seeded.activeSessionTitle, 'Ungrouped']) {
      const group = page.locator('[class*="projectRow"]').filter({ has: page.getByText(title, { exact: true }) }).first()
      await group.waitFor({ state: 'visible' })
      if (await group.getAttribute('aria-expanded') === 'true') await group.click()
      await expect.poll(() => group.getAttribute('aria-expanded')).toBe('false')
      await activateSmokeSession(page, title === 'Ungrouped' ? seeded.messengerSourceSessionTitle : title)
      expect(await group.getAttribute('aria-expanded')).toBe('true')
    }
    expect(await page.locator('[class*="projectRow"]').filter({ hasText: seeded.messengerSourceSessionTitle }).count()).toBe(0)
    await exerciseExistingSessionModelSwitch(page, scaffold.persistenceRoot, seeded, provider)
    await exerciseComposerContinuity(page, {
      selectSession: title => activateSmokeSession(renderer, title),
      primaryTitle: seeded.activeSessionTitle, primaryTurns: 30,
      secondaryTitle: seeded.messengerSourceSessionTitle,
      evidenceDirectory: process.env.DSH_DESKTOP_CONTINUITY_EVIDENCE_DIR
        ?? join(scaffold.harnessHome, 'composer-evidence'), platform: 'darwin',
    })
    expect(consoleWatch.pageErrors).toEqual([])
    expect(provider.requests).toEqual([])
    expect(provider.acceptedRequests).toBe(0)
    // A fresh native origin has no saved group expansion. Hold the initial
    // Session list so the shell paints before automatic Workspace selection.
    const context150 = await browser.newContext({ viewport: { width: 1000, height: 720 }, deviceScaleFactor: 1.5, locale: 'en-US' })
    let releaseOpening = (): void => {}
    const held = new Promise<void>((resolve) => { releaseOpening = resolve })
    let gated = false
    const readList = scaffold.ctx.sessionController.list.bind(scaffold.ctx.sessionController)
    const list = vi.spyOn(scaffold.ctx.sessionController, 'list').mockImplementation(async (request, signal) => {
      const value = await readList(request, signal)
      if (!gated) {
        gated = true
        await held
      }
      return value
    })
    try {
      await context150.request.get(scaffold.authenticatedUrl)
      const page150 = await context150.newPage()
      await page150.goto(`${scaffold.baseUrl}/?surface=desktop`, { waitUntil: 'load' })
      await expect.poll(() => gated, { timeout: 15_000 }).toBe(true)
      const collapsed = page150.locator('[data-sidebar-collapsed="true"]')
      if (await collapsed.count() === 1) {
        await page150.getByRole('button', { name: 'Open sidebar', exact: true }).click()
        await collapsed.waitFor({ state: 'detached' })
      }
      const group = page150.locator('[class*="projectRow"]').filter({ hasText: seeded.activeSessionTitle }).first()
      await group.waitFor({ state: 'visible' })
      expect(await group.getAttribute('aria-expanded')).toBe('false')
      expect(await page150.locator('[data-composer-input]').first().getAttribute('contenteditable')).toBe('false')
      let sessionReady = false
      const ready = waitForDesktopSessionReady(page150).then(() => { sessionReady = true })
      // A round trip while the Host gate is held proves that readiness cannot
      // be inferred from the existing shell or collapsed group alone.
      expect(await group.getAttribute('aria-expanded')).toBe('false')
      expect(sessionReady).toBe(false)
      releaseOpening()
      await ready
      await expect.poll(() => group.getAttribute('aria-expanded')).toBe('true')
      // Reproduce the old stale read(false) -> automatic expansion -> click
      // interleaving, then exercise selection after the real readiness barrier.
      await group.click()
      await expect.poll(() => group.getAttribute('aria-expanded')).toBe('false')
      await waitForDesktopSessionReady(page150)
      await activateSmokeSession(page150, seeded.activeSessionTitle)
      expect(await group.getAttribute('aria-expanded')).toBe('true')
    } finally {
      releaseOpening()
      list.mockRestore()
      await context150.close()
    }
  } catch (error) {
    if (page !== undefined) await saveFailureShot(page, 'desktop-continuity')
    throw error
  } finally {
    try { await browser?.close() } finally {
      try { await provider?.close() } finally {
        try { await scaffold.close() } finally { vi.unstubAllEnvs() }
      }
    }
  }
})
