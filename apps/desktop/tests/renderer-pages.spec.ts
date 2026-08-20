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

  it('ships a self-contained DeepSeek-colored macOS startup intro', async () => {
    const html = await rendererPage('loading-macos.html')
    expect(html).toContain("default-src 'none'")
    expect(html).toContain('data-macos-startup')
    expect(html).toContain('#4d6bfe')
    expect(html).toContain('prefers-reduced-motion: reduce')
    expect(html).toContain('role="progressbar"')
    expect(html).toContain('aria-label="正在启动"')
    expect(html).toContain('aria-valuetext="正在初始化桌面运行时"')
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
