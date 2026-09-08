import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import {
  activateSmokeSession, exerciseExistingSessionModelSwitch, seedWindowsClipboardSmokeState,
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
