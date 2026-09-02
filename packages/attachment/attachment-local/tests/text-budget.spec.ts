import { describe, expect, it, vi } from 'vitest'
import { fitUtf8, Utf8BudgetBuilder } from '../src/text-budget.ts'

describe('fitUtf8', () => {
  it('returns text unchanged when it already fits', () => {
    expect(fitUtf8('hello', 5)).toEqual({ text: 'hello', truncated: false })
  })

  it('returns an empty truncation when no complete code point fits', () => {
    expect(fitUtf8('甲', 0)).toEqual({ text: '', truncated: true })
    expect(fitUtf8('甲', 2)).toEqual({ text: '', truncated: true })
  })

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects an invalid byte budget %s', (maxBytes) => {
    expect(() => fitUtf8('text', maxBytes)).toThrow(TypeError)
  })
})

describe('Utf8BudgetBuilder', () => {
  it('retains an exact UTF-8 prefix across fragments', () => {
    const output = new Utf8BudgetBuilder(7)
    expect(output.append('a甲')).toBe(true)
    expect(output.byteLength).toBe(4)
    expect(output.append('乙丙')).toBe(false)
    expect(output.append('ignored')).toBe(false)
    expect(output.result()).toEqual({ text: 'a甲乙', truncated: true })
  })

  it('keeps empty output untruncated until omitted source is explicit', () => {
    const output = new Utf8BudgetBuilder(0)
    expect(output.append('')).toBe(true)
    output.markTruncated()
    expect(output.truncated).toBe(true)
    expect(output.result()).toEqual({ text: '', truncated: true })
  })

  it('does not retain a partial UTF-8 code point', () => {
    const output = new Utf8BudgetBuilder(2)
    expect(output.append('甲')).toBe(false)
    expect(output.result()).toEqual({ text: '', truncated: true })
  })

  it('bounds source-character work before UTF-8 encoding', () => {
    const output = new Utf8BudgetBuilder(4)
    const encode = vi.spyOn(TextEncoder.prototype, 'encode')
    try {
      expect(output.appendBounded('x'.repeat(1_000), 100)).toBe(false)
      expect(output.result()).toEqual({ text: 'xxxx', truncated: true })
      expect(encode.mock.calls.map(([value]) => value?.length ?? 0)).toEqual([5])
    } finally {
      encode.mockRestore()
    }
  })

  it('does not retain a replacement character when a character limit meets a surrogate pair', () => {
    const output = new Utf8BudgetBuilder(4)
    expect(output.appendBounded('😀', 1)).toBe(false)
    expect(output.result()).toEqual({ text: '', truncated: true })
  })

  it('handles complete, empty, exhausted, and zero-character bounded appends', () => {
    const large = new Utf8BudgetBuilder(Number.MAX_SAFE_INTEGER)
    expect(large.appendBounded('', 0)).toBe(true)
    expect(large.appendBounded('a', 1)).toBe(true)
    large.markTruncated()
    expect(large.appendBounded('ignored', 7)).toBe(false)

    const zero = new Utf8BudgetBuilder(4)
    expect(zero.appendBounded('x', 0)).toBe(false)
    expect(zero.result()).toEqual({ text: '', truncated: true })

    const multibyte = new Utf8BudgetBuilder(2)
    expect(multibyte.appendBounded('甲', 1)).toBe(false)
    expect(multibyte.result()).toEqual({ text: '', truncated: true })
  })

  it.each(['\ud800x', '\ud800\ue000', '\udc00x'])('bounds malformed surrogate source %s deterministically', (value) => {
    const output = new Utf8BudgetBuilder(4)
    expect(output.appendBounded(value, 1)).toBe(false)
    expect(output.result()).toMatchObject({ text: value.slice(0, 1), truncated: true })
  })

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects an invalid source-character budget %s', (maxCharacters) => {
    expect(() => new Utf8BudgetBuilder(1).appendBounded('x', maxCharacters)).toThrow(TypeError)
  })

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects an invalid builder budget %s', (maxBytes) => {
    expect(() => new Utf8BudgetBuilder(maxBytes)).toThrow(TypeError)
  })
})
