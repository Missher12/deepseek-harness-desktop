import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { en, zh } from '../src/client/locales.ts'

describe('Cordis @ discovery source', () => {
  it('sits after skills and marks every candidate as a dynamic plugin', async () => {
    const source = await readFile(new URL('../src/client/index.ts', import.meta.url), 'utf8')

    expect(source).toMatch(/name:\s*'cordis',[\s\S]*?order:\s*-1/u)
    expect(source).toMatch(/icon:\s*'plugin'/u)
    expect(source).toMatch(/section:\s*t\('menu\.section'\)/u)
    expect(zh['menu.section']).toBe('Cordis 插件')
    expect(en['menu.section']).toBe('Cordis plugins')
  })
})
