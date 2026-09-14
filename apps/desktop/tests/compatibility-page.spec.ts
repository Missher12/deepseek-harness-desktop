import { readFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'
import { afterEach, expect, it, vi } from 'vitest'
const documents: JSDOM[] = []
afterEach(() => { for (const document of documents.splice(0)) document.window.close() })
it('keeps native updates reachable when plugin discovery fails without displaying raw errors', async () => {
  const html = await readFile(new URL('../renderer/compatibility.html', import.meta.url), 'utf8')
  const script = await readFile(new URL('../renderer/compatibility.js', import.meta.url), 'utf8')
  const dom = new JSDOM(html, { runScripts: 'outside-only' })
  documents.push(dom)
  const state = { phase: 'desktop-available', runningDesktop: '0.6.0', includedHarness: '0.1.5-rc.2', message: null, downloadProgress: null }
  const check = vi.fn(async () => state)
  const getCompatibility = vi.fn(async () => { throw new Error('private error content') })
  Object.defineProperty(dom.window, 'dshDesktop', { value: { getCompatibility, getUpdateStatus: async () => state,
    checkForUpdates: check, onUpdateStatus: () => () => {} } })
  dom.window.eval(script)
  await vi.waitFor(() => { expect(dom.window.document.getElementById('versions')?.textContent).toContain('0.6.0') })
  expect(dom.window.document.body.textContent).not.toContain('private error content')
  dom.window.document.getElementById('check')?.click()
  await vi.waitFor(() => { expect(check).toHaveBeenCalledOnce() })
})
