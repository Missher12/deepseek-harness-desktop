/** Desktop no-project selection uses the shared cwd policy and real Agent filesystem. */

import { readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser } from 'playwright'
import { expect, it, vi } from 'vitest'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { activateSmokeSession, seedWindowsClipboardSmokeState } from '../../desktop/tests/packaged-smoke.ts'
import { startReaderSmokeProvider } from '../../desktop/tests/reader-smoke-provider.ts'
import { exerciseNativeSessionWorkspaces, NativeSessionWrites, seedLegacySessionWorkspace } from '../../desktop/tests/session-workspace-smoke.ts'
import { verifySessionWorkspaceReceipt } from '../../../scripts/desktop-session-workspace-receipt.ts'
import { launchWebScaffold, watchConsole } from './scaffold.ts'
import { newEnglishPage } from './support.ts'

it('rehearses the exact native directory and copied-V2 checks through real model tool calls', async () => {
  const scaffold = await launchWebScaffold({
    extraOverlayPath: fileURLToPath(new URL('../../desktop/desktop.cordis.patch.yml', import.meta.url)),
    extraInstallAnchors: [fileURLToPath(new URL('../../desktop/package.json', import.meta.url))],
  })
  const writes = new NativeSessionWrites()
  let provider: Awaited<ReturnType<typeof startReaderSmokeProvider>> | undefined
  let browser: Browser | undefined
  try {
    provider = await startReaderSmokeProvider(body => writes.respond(body))
    browser = await chromium.launch()
    vi.stubEnv('DSH_DESKTOP_SMOKE_MODEL_KEY', 'isolated-desktop-test-key')
    const seeded = await seedWindowsClipboardSmokeState(scaffold.harnessHome, scaffold.persistenceRoot)
    const legacy = await seedLegacySessionWorkspace(scaffold.harnessHome, scaffold.persistenceRoot)
    expect(await readdir(dirname(legacy.path))).toEqual(['session.v2.jsonl.zstd'])
    const workspace = await scaffold.ctx.workspaceRegistry.create(join(scaffold.harnessHome, seeded.activeSessionTitle))
    await workspace.attachSession(SessionId(seeded.activeSessionId))
    await scaffold.ctx.settings.update('llm-pi-ai', { providers: {
      'desktop-smoke': {
        displayName: 'Desktop Smoke', apiKeyEnv: 'DSH_DESKTOP_SMOKE_MODEL_KEY', api: 'openai-completions',
        baseURL: provider.url, reasoning: 'high',
        models: [{ id: 'native-thinker', name: 'Native Smoke Thinker', contextWindow: 65536, maxTokens: 4096, reasoningEfforts: { high: 'high' } }],
      },
    } })
    await scaffold.ctx.agentDefaultModel.saveSelection({ provider: 'desktop-smoke', model: 'native-thinker', reasoningEffort: ReasoningEffortId('high') })
    const page = await newEnglishPage(browser)
    const consoleWatch = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.goto(`${scaffold.baseUrl}/?surface=desktop`, { waitUntil: 'load' })
    // Native piano navigation leaves this narrow viewport active before the reload checks.
    await page.setViewportSize({ width: 1012, height: 760 })
    await expect.poll(() => page.locator('[data-sidebar-collapsed="true"]').count()).toBe(1)
    await exerciseNativeSessionWorkspaces(page, {
      persistenceRoot: scaffold.persistenceRoot, noProjectRoot: join(scaffold.workspaceCwd, 'deepseek-temp'),
      projectTitle: seeded.activeSessionTitle, projectCwd: workspace.path,
      legacy, writes, selectSession: (title, id) => activateSmokeSession(page, title, id),
      evidencePath: join(scaffold.harnessHome, 'native-session-evidence.json'),
    })
    await verifySessionWorkspaceReceipt(join(scaffold.harnessHome, 'native-session-evidence.json'))
    expect(provider.requests).toEqual([])
    expect(provider.acceptedRequests).toBe(0)
    expect(scaffold.ctx.workspaceRegistry.list()).toHaveLength(1)
    expect(consoleWatch.pageErrors).toEqual([])
  } finally {
    try { await browser?.close() } finally {
      try { await provider?.close() } finally {
        try { await scaffold.close() } finally { vi.unstubAllEnvs() }
      }
    }
  }
})
