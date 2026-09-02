import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/WorkbenchPanel.module.css', import.meta.url)), 'utf8')

function declarations(selector: string): Map<string, string> | undefined {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, ' ')
  for (const [, selectorList = '', body = ''] of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selectorList.split(',').map(value => value.trim()).includes(selector)) continue
    const found = new Map<string, string>()
    for (const part of body.split(';')) {
      const colon = part.indexOf(':')
      if (colon === -1) continue
      found.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim().replace(/\s+/g, ' '))
    }
    return found
  }
  return undefined
}

describe('WorkbenchPanel.module.css', () => {
  it('keeps the launcher and scrollable mode content inside the resizable right column', () => {
    expect(declarations('.panel')?.get('grid-template-columns')).toBe(
      'clamp(96px, 30%, 132px) minmax(0, 1fr)',
    )
    expect(declarations('.tabs')?.get('flex-direction')).toBe('column')
    expect(declarations('.tab')?.get('min-width')).toBe('0')
    expect(declarations('.tabLabel')?.get('text-overflow')).toBe('ellipsis')
    expect(declarations('.tab[data-active]')?.get('background'))
      .toBe('var(--dsw-alias-interactive-bg-active)')
    expect(declarations('.body')?.get('overflow')).toBe('auto')
  })
})
