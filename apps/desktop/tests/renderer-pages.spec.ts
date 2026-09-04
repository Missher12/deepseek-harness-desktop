import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

async function rendererPage(name: string): Promise<string> {
  return readFile(new URL(`../renderer/${name}`, import.meta.url), 'utf8')
}

describe('local renderer pages', () => {
  it('ships one polished self-contained Desktop loading page', async () => {
    const html = await rendererPage('loading.html')
    expect(html).toContain("default-src 'none'")
    expect(html).toContain("img-src 'self'")
    expect(html).toContain('data-desktop-startup')
    expect(html).toContain('data-desktop-local-progress')
    expect(html).toContain('../assets/icon-source.png')
    expect(html).toContain('正在准备你的工作区')
    expect(html).toContain('启动本地服务')
    expect(html).toContain('aria-valuetext="正在启动本地服务"')
    expect(html).toContain('height: 5px')
    expect(html).toContain('#4d6bfe')
    expect(html).toContain('color-scheme: light')
    expect(html).toContain('background: #f6f7fb')
    expect(html).not.toContain('#07090f')
    expect(html).toContain('prefers-reduced-motion: reduce')
    expect(html).not.toContain('class="grid"')
    expect(html).not.toContain('class="rail"')
    expect(html).not.toMatch(/https?:\/\//u)
  })

  it('selects the same local loading document on every native platform', async () => {
    const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')
    expect(main).toContain("new URL('../renderer/loading.html', import.meta.url)")
    expect(main).not.toContain('loading-macos.html')
  })

  it('keeps the shared Desktop plugin-loading surface on the same light theme', async () => {
    const css = await readFile(
      new URL('../../../packages/client/web/src/boot-page.module.css', import.meta.url),
      'utf8',
    )
    const desktopSurface = css.slice(css.indexOf('.boot[data-dsh-boot-desktop]'))
    expect(desktopSurface).toContain('--dsh-boot-bg: #f6f7fb')
    expect(desktopSurface).toContain('--dsh-boot-label-primary: #171a21')
    expect(desktopSurface).not.toContain('--dsh-boot-bg: #07090f')
  })

  it('renders only closed failure reasons and recovery actions', async () => {
    const html = await rendererPage('failure.html')
    expect(html).toContain('runtime-conflict')
    expect(html).toContain("['retry', 'open-logs', 'quit']")
    expect(html).toContain('DeepSeek Harness could not start.')
    expect(html).not.toContain('innerHTML')
  })
})
