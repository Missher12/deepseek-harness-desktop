/** Desktop no-project selection uses the shared cwd policy and real Agent filesystem. */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { launchWebScaffold, watchConsole } from './scaffold.ts'
import { newEnglishPage } from './support.ts'

it('creates no-project output directories through the composed UI and retains their files on reopen', async () => {
  const scaffold = await launchWebScaffold({
    extraOverlayPath: fileURLToPath(new URL('../../desktop/desktop.cordis.patch.yml', import.meta.url)),
    extraInstallAnchors: [fileURLToPath(new URL('../../desktop/package.json', import.meta.url))],
  })
  const browser = await chromium.launch()
  try {
    const page = await newEnglishPage(browser)
    const consoleWatch = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.getByRole('button', { name: 'Choose workspace', exact: true }).click()
    await page.getByRole('menuitem', { name: 'No project', exact: true }).click()
    await page.locator('[data-composer-input][contenteditable="true"]').waitFor()
    await expect.poll(() => scaffold.ctx.sessions.list().length).toBe(1)
    const first = scaffold.ctx.sessions.list()[0]
    if (first === undefined) throw new Error('No-project selection did not create a Session')
    const second = await scaffold.ctx.sessionController.create({})
    expect(second.sessionId).not.toBe(first.id)

    for (const sessionId of [first.id, second.sessionId]) {
      const result = await scaffold.ctx.sessionController.resolveAgent(sessionId)
      if ('error' in result) throw result.error
      const cwd = result.agent.session.header.cwd
      expect(cwd).toBe(join(scaffold.workspaceCwd, 'deepseek-temp', sessionId))
      if (cwd === undefined) throw new Error('Session has no working directory')
      const writer = await result.agent.ctx.plugin({
        inject: ['fs'],
        async apply(ctx) {
          const target = await ctx.fs.resolve('generated.txt', { cwd })
          await ctx.fs.writeText(target, `output for ${sessionId}`)
        },
      })
      await writer.dispose()
      expect(await readFile(join(cwd, 'generated.txt'), 'utf8')).toBe(`output for ${sessionId}`)
    }
    expect(scaffold.ctx.workspaceRegistry.list()).toEqual([])
    await page.reload({ waitUntil: 'load' })
    await page.getByRole('button', { name: 'Choose workspace', exact: true }).click()
    await page.getByRole('menuitem', { name: 'No project', exact: true }).click()
    await page.locator('[data-composer-input][contenteditable="true"]').waitFor()
    expect(scaffold.ctx.sessions.list()).toHaveLength(2)
    for (const sessionId of [first.id, second.sessionId]) {
      expect(await readFile(join(scaffold.workspaceCwd, 'deepseek-temp', sessionId, 'generated.txt'), 'utf8'))
        .toBe(`output for ${sessionId}`)
    }
    expect(consoleWatch.pageErrors).toEqual([])
  } finally {
    try { await browser.close() } finally { await scaffold.close() }
  }
})
