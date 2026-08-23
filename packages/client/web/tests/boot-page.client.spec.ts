// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { BootPage } from '../src/boot-page.ts'

afterEach(() => { document.body.innerHTML = '' })

function mount() {
  const el = document.createElement('div')
  document.body.append(el)
  return { el, page: new BootPage(el) }
}

function mountDesktop(userAgent = 'Macintosh') {
  const el = document.createElement('div')
  document.body.append(el)
  return {
    el,
    page: new BootPage(el, { search: '?surface=desktop', userAgent }),
  }
}

describe('BootPage', () => {
  it('draws the loading skeleton before any plugin state arrives', () => {
    const { el } = mount()
    expect(el.firstElementChild?.getAttribute('data-dsh-boot')).toBe('')
    expect(el.textContent).toContain('HARNESS')
    expect(el.textContent).toContain('Loading plugins…')
  })

  it('keeps loading while entries are active or loading', () => {
    const { el, page } = mount()
    page.setTotal(2)
    const spinner = el.querySelector<HTMLElement>('[data-dsh-boot-spinner]')
    expect(spinner?.style.getPropertyValue('--dsh-boot-arc')).toBe('72deg')
    page.setState('a', 'active')
    expect(spinner?.style.getPropertyValue('--dsh-boot-arc')).toBe('180deg')
    page.setState('b', 'loading')
    expect(el.querySelector('[data-dsh-boot-spinner]')).toBe(spinner)
    page.setState('b', 'active')
    expect(spinner?.style.getPropertyValue('--dsh-boot-arc')).toBe('288deg')
    expect(el.textContent).toContain('Loading plugins…')
    expect(el.textContent).not.toContain('Failed to load plugins')
  })

  it('shows truthful linear plugin progress on the native Desktop surface', () => {
    const { el, page } = mountDesktop()
    page.setTotal(4)
    const progress = el.querySelector<HTMLElement>('[data-dsh-boot-linear]')
    expect(el.firstElementChild?.getAttribute('data-dsh-boot-desktop')).toBe('')
    expect(el.querySelector<HTMLImageElement>('[data-dsh-boot-icon]')?.src).toMatch(/\/desktop-icon\.png$/u)
    expect(progress?.getAttribute('aria-valuenow')).toBe('0')
    expect(el.textContent).toContain('正在加载组件 0 / 4')
    page.setState('a', 'active')
    page.setState('a', 'active')
    expect(progress?.getAttribute('aria-valuenow')).toBe('25')
    expect(el.textContent).toContain('25%')
    page.setState('b', 'active')
    page.setState('c', 'active')
    page.setState('d', 'active')
    expect(progress?.getAttribute('aria-valuenow')).toBe('100')
    expect(el.textContent).toContain('正在加载组件 4 / 4')
  })

  it('uses the same truthful plugin progress on Windows Desktop', () => {
    const { el, page } = mountDesktop('Mozilla/5.0 (Windows NT 10.0)')
    page.setTotal(4)
    page.setState('a', 'active')
    expect(el.firstElementChild?.getAttribute('data-dsh-boot-desktop')).toBe('')
    expect(el.querySelector('[data-dsh-boot-linear]')?.getAttribute('aria-valuenow')).toBe('25')
    expect(el.textContent).toContain('正在加载组件 1 / 4')
  })

  it('lists failed entries', () => {
    const { el, page } = mount()
    page.setState('@deepseek-ai/dsh-client-ui-layout', 'failed')
    page.setState('ok', 'active')
    page.setState('@deepseek-ai/dsh-client-ui-tool', 'failed')
    expect(el.textContent).toContain('@deepseek-ai/dsh-client-ui-layout')
    expect(el.textContent).toContain('@deepseek-ai/dsh-client-ui-tool')
    expect(el.textContent).not.toContain('ok')
    expect(el.textContent).not.toContain('Loading plugins…')
  })

  it('shows the complete sweep report', () => {
    const { el, page } = mount()
    const report = 'web boot: 1 entry did not activate\nx: pending (waiting for service: y)'
    page.fail(report)
    page.setState('a', 'active')
    expect(el.textContent).toContain(report)
    expect(el.textContent).not.toContain('Loading plugins…')
  })

  it('replaces the native Desktop progress surface with the failure report', () => {
    const { el, page } = mountDesktop()
    page.setTotal(2)
    page.setState('a', 'active')
    page.fail('plugin activation stopped')
    expect(el.querySelector('[data-dsh-boot-linear]')).toBeNull()
    expect(el.textContent).toContain('Failed to load plugins')
    expect(el.textContent).toContain('plugin activation stopped')
  })

  it('detaches on disposal', () => {
    const { el, page } = mount()
    page.dispose()
    expect(el.childNodes).toHaveLength(0)
  })
})
