import { describe, expect, it } from 'vitest'
import { allowRendererPermission, classifyNavigation } from '../src/window/navigation.ts'

describe('classifyNavigation', () => {
  const owned = 'http://127.0.0.1:45678/'

  it('keeps the owned origin inside the window', () => {
    expect(classifyNavigation('http://127.0.0.1:45678/session/1', owned)).toBe('internal')
  })

  it.each([
    'https://github.com/deepseek-ai',
    'http://example.com/',
  ])('hands %s to the system browser', (url) => {
    expect(classifyNavigation(url, owned)).toBe('external')
  })

  it.each([
    'file:///etc/passwd',
    'javascript:alert(1)',
    'http://127.0.0.1:50000/',
    'not a url',
  ])('blocks %s', (url) => {
    expect(classifyNavigation(url, owned)).toBe('blocked')
  })
})

describe('allowRendererPermission', () => {
  const owned = 'http://127.0.0.1:45678/'

  it('allows only an owned main-frame clipboard write', () => {
    expect(allowRendererPermission(
      'clipboard-sanitized-write',
      'http://127.0.0.1:45678/session/1',
      true,
      owned,
      true,
    )).toBe(true)
  })

  it.each([
    ['clipboard-read', 'http://127.0.0.1:45678/', true, owned, true],
    ['clipboard-write', 'http://127.0.0.1:45678/', true, owned, true],
    ['clipboard-sanitized-write', 'http://127.0.0.1:45678/', false, owned, true],
    ['clipboard-sanitized-write', 'http://127.0.0.1:45678/', true, owned, false],
    ['clipboard-sanitized-write', 'http://127.0.0.1:50000/', true, owned, true],
    ['clipboard-sanitized-write', 'http://localhost:45678/', true, owned, true],
    ['clipboard-sanitized-write', 'https://127.0.0.1:45678/', true, owned, true],
    ['clipboard-sanitized-write', 'https://example.com/', true, owned, true],
    ['clipboard-sanitized-write', 'not a url', true, owned, true],
    ['clipboard-sanitized-write', 'http://127.0.0.1:45678/', true, undefined, true],
    ['clipboard-sanitized-write', 'http://127.0.0.1:45678/', true, 'http://127.0.0.1/', true],
    ['clipboard-sanitized-write', 'http://127.0.0.1:45678/', true, 'http://127.0.0.1:0/', true],
  ] as const)(
    'denies permission=%s url=%s main=%s owned=%s trusted=%s',
    (permission, url, main, root, trusted) => {
      expect(allowRendererPermission(permission, url, main, root, trusted)).toBe(false)
    },
  )
})
