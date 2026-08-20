import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

async function rendererPage(name: string): Promise<string> {
  return readFile(new URL(`../renderer/${name}`, import.meta.url), 'utf8')
}

describe('local renderer pages', () => {
  it('ships a self-contained loading page with a restrictive policy', async () => {
    const html = await rendererPage('loading.html')
    expect(html).toContain("default-src 'none'")
    expect(html).toContain('Starting DeepSeek Harness')
    expect(html).not.toMatch(/https?:\/\//u)
  })

  it('ships the self-contained minimal macOS startup progress surface', async () => {
    const html = await rendererPage('loading-macos.html')
    expect(html).toContain("default-src 'none'")
    expect(html).toContain("img-src 'self'")
    expect(html).toContain('data-macos-startup')
    expect(html).toContain('data-macos-local-progress')
    expect(html).toContain('../assets/icon-source.png')
    expect(html).toContain('正在准备你的工作区')
    expect(html).toContain('启动本地服务')
    expect(html).toContain('aria-valuetext="正在启动本地服务"')
    expect(html).toContain('height: 5px')
    expect(html).toContain('#4d6bfe')
    expect(html).toContain('prefers-reduced-motion: reduce')
    expect(html).not.toContain('class="grid"')
    expect(html).not.toContain('class="rail"')
    expect(html).not.toMatch(/https?:\/\//u)
  })

  it('renders only closed failure reasons and recovery actions', async () => {
    const html = await rendererPage('failure.html')
    expect(html).toContain('runtime-conflict')
    expect(html).toContain("['retry', 'open-logs', 'quit']")
    expect(html).toContain('DeepSeek Harness could not start.')
    expect(html).not.toContain('innerHTML')
  })
})
