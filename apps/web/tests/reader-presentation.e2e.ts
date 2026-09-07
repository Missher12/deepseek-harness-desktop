/** Assembled native Chat presentation driven by a keyless, explicitly paced model. */
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import {
  captureStableAria, compareOrRefreshGolden, launchWebScaffold, watchConsole,
  webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'
import { exerciseReaderPresentation } from '../../desktop/tests/reader-presentation-smoke.ts'
import { NATIVE_READER_REASONING as REASONING, NATIVE_READER_APPEND as APPEND, NATIVE_READER_ANSWER as ANSWER } from '../../desktop/tests/reader-smoke-provider.ts'

const MODE = webSnapshotMode()
const EXPECTED = fileURLToPath(new URL('./expected/reader-presentation/completed.expected.md', import.meta.url))

function checkpoint() {
  let release!: () => void
  const reached = new Promise<void>((resolve) => { release = resolve })
  return { reached, release }
}

class ReaderAdapter extends LlmAdapter {
  readonly grow = checkpoint()
  readonly answer = checkpoint()
  readonly finish = checkpoint()

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    yield { type: 'block-start', index: 0, blockType: 'reasoning' }
    yield { type: 'reasoning-delta', index: 0, text: REASONING }
    await this.grow.reached
    options.signal?.throwIfAborted()
    yield { type: 'reasoning-delta', index: 0, text: APPEND }
    await this.answer.reached
    options.signal?.throwIfAborted()
    yield { type: 'block-end', index: 0, block: { type: 'reasoning', text: REASONING + APPEND } }
    yield { type: 'block-start', index: 1, blockType: 'text' }
    yield { type: 'text-delta', index: 1, text: ANSWER }
    await this.finish.reached
    options.signal?.throwIfAborted()
    yield { type: 'block-end', index: 1, block: { type: 'text', text: ANSWER } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }

  release(): void {
    this.grow.release()
    this.answer.release()
    this.finish.release()
  }
}

describe.skipIf(MODE === 'record')('web e2e: built-in reading presentation', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let consoleWatch: ReturnType<typeof watchConsole>
  const adapter = new ReaderAdapter()

  beforeAll(async () => {
    scaffold = await launchWebScaffold()
    scaffold.ctx.effect(() => scaffold.ctx.llm.registerAdapter(['reader-presentation-test'], adapter), 'reader test adapter')
    await scaffold.ctx.agentDefaultModel.saveSelection({ provider: 'reader-presentation-test', model: 'reader' })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    await page.setViewportSize({ width: 1280, height: 850 })
    consoleWatch = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
  })

  afterAll(async () => {
    adapter.release()
    try { await browser?.close() } finally { await scaffold?.close() }
  })

  it('follows real reasoning, preserves a selection across streaming and folding, and keeps native Markdown', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-reader-presentation'))
    const evidence = process.env.DSH_READER_EVIDENCE_DIR
    await exerciseReaderPresentation(page, {
      driver: {
        arm() {},
        append: () =>{  adapter.grow.release() },
        answer: () =>{  adapter.answer.release() },
        finish: () =>{  adapter.finish.release() },
      },
      settled: scaffold.whenTurnSettled(60_000),
      ...evidence === undefined ? {} : { evidence: { directory: evidence, prefix: 'reader' } },
      onCompleted: async () => {
        const aria = await captureStableAria(page, '[data-chat-flow-kind="assistant-step"]', scaffold.workspaceCwd)
        await compareOrRefreshGolden(EXPECTED, aria, MODE)
      },
    })
    expect(consoleWatch.pageErrors).toEqual([])
  })
})
