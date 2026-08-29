import { describe, expect, it } from 'vitest'
import {
  BROWSER_AGENT_LIMITS,
  isAgentBrowserAction,
  isDesktopBrowserBounds,
  isDesktopBrowserRequest,
  normalizeAgentBrowserTarget,
  normalizeBrowserTarget,
  toAgentBrowserRef,
} from '../src/browser/contracts.ts'

describe('workbench Browser contracts', () => {
  it('converts only canonical protocol references at the adapter boundary', () => {
    expect(toAgentBrowserRef('browser:00000000000000000000000000000001'))
      .toBe('browser:00000000000000000000000000000001')
    expect(() => toAgentBrowserRef('not-a-ref')).toThrow('browser reference is invalid')
  })

  it('accepts only finite visible bounds', () => {
    expect(isDesktopBrowserBounds({ x: 0, y: 0, width: 400, height: 300 })).toBe(true)
    expect(isDesktopBrowserBounds({ x: 0, y: 0, width: Number.NaN, height: 300 })).toBe(false)
    expect(isDesktopBrowserBounds({ x: 0, y: 0, width: 0, height: 300 })).toBe(false)
  })

  it('allows HTTP(S) navigation and rejects privileged schemes', () => {
    expect(isDesktopBrowserRequest({ kind: 'navigate', value: 'https://example.com' })).toBe(true)
    expect(isDesktopBrowserRequest({ kind: 'navigate', value: 'file:///tmp/a' })).toBe(false)
    expect(isDesktopBrowserRequest({ kind: 'navigate', value: 'javascript:alert(1)' })).toBe(false)
    expect(normalizeBrowserTarget('deepseek.com')).toBe('https://deepseek.com/')
  })

  it('keeps the human Workbench target behavior while Agent URLs reject userinfo', () => {
    expect(normalizeBrowserTarget('https://user:secret@example.com/path'))
      .toBe('https://user:secret@example.com/path')
    expect(normalizeAgentBrowserTarget('example.com/path')).toBe('https://example.com/path')
    expect(normalizeAgentBrowserTarget('https://user:secret@example.com/path')).toBeUndefined()
    expect(normalizeAgentBrowserTarget('search words')).toBeUndefined()
    expect(normalizeAgentBrowserTarget('file:///tmp/a')).toBeUndefined()
  })

  it('pins every Agent browser resource limit to the frozen protocol and plan', () => {
    expect(BROWSER_AGENT_LIMITS).toEqual({
      rawNodes: 2_000,
      depth: 32,
      cdpCalls: 512,
      startupMs: 10_000,
      startupAttempts: 2,
      cleanupMs: 2_000,
      wallMs: 10_000,
      actionableNodes: 300,
      semanticUtf8Bytes: 49_152,
      encodedJsonBytes: 65_536,
      pngBytes: 4_194_304,
      screenshotEdge: 2_048,
      screenshotPixels: 4_194_304,
      screenshotAttempts: 3,
      waitDurationMs: 10_000,
    })
    expect(Object.isFrozen(BROWSER_AGENT_LIMITS)).toBe(true)
  })

  it('accepts only the ref-based closed action roster', () => {
    expect(isAgentBrowserAction({ kind: 'click', ref: 'browser:00000000000000000000000000000001' })).toBe(true)
    expect(isAgentBrowserAction({
      kind: 'type', ref: 'browser:00000000000000000000000000000001', text: 'hello',
    })).toBe(true)
    expect(isAgentBrowserAction({ kind: 'key', key: 'Enter', modifiers: ['Shift'] })).toBe(true)
    expect(isAgentBrowserAction({
      kind: 'select', ref: 'browser:00000000000000000000000000000001', value: 'one',
    })).toBe(true)
    expect(isAgentBrowserAction({ kind: 'scroll', deltaX: 0, deltaY: 120 })).toBe(true)
    expect(isAgentBrowserAction({ kind: 'scroll', deltaX: 0.5, deltaY: -1.25 })).toBe(true)
    expect(isAgentBrowserAction({
      kind: 'scroll', ref: 'browser:00000000000000000000000000000001', deltaX: 0, deltaY: 120,
    })).toBe(true)
    expect(isAgentBrowserAction({ kind: 'wait', mode: 'duration', durationMs: 10_000 })).toBe(true)
    expect(isAgentBrowserAction({ kind: 'wait', mode: 'navigation' })).toBe(true)
    expect(isAgentBrowserAction({ kind: 'wait', mode: 'loading-idle' })).toBe(true)
    expect(isAgentBrowserAction({ kind: 'navigate', url: 'https://example.com/' })).toBe(true)
    expect(isAgentBrowserAction({ kind: 'back' })).toBe(true)
    expect(isAgentBrowserAction({ kind: 'forward' })).toBe(true)
    expect(isAgentBrowserAction({ kind: 'reload' })).toBe(true)
    expect(isAgentBrowserAction({
      kind: 'select', ref: 'browser:00000000000000000000000000000001', value: '',
    })).toBe(true)

    expect(isAgentBrowserAction({ kind: 'click', x: 10, y: 20 })).toBe(false)
    expect(isAgentBrowserAction({
      kind: 'click', ref: 'browser:00000000000000000000000000000001', selector: '#send',
    })).toBe(false)
    expect(isAgentBrowserAction({ kind: 'type', ref: 'not-a-ref', text: 'hello' })).toBe(false)
    expect(isAgentBrowserAction({ kind: 'wait', mode: 'duration', durationMs: 10_001 })).toBe(false)
    expect(isAgentBrowserAction({ kind: 'wait', mode: 'network-idle' })).toBe(false)
    expect(isAgentBrowserAction({ kind: 'upload', path: '/tmp/a' })).toBe(false)
    expect(isAgentBrowserAction(Object.assign(Object.create({ inherited: true }), { kind: 'back' }))).toBe(false)
  })
})
