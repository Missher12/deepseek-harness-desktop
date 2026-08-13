import { describe, expect, it } from 'vitest'
import { classifyNavigation } from '../src/window/navigation.ts'

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
