import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { collectConfigCatalog, render } from './gen-config-catalog.ts'

const fixtureRoots: string[] = []

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture(schema: string, input = `interface Input {
  /** Legacy input spelling. */
  text: string
}`): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-config-catalog-'))
  fixtureRoots.push(root)
  const dir = join(root, 'packages/preset/fixture')
  mkdirSync(join(dir, 'src'), { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-fixture' }))
  writeFileSync(join(dir, 'src/index.ts'), `import z from '@deepseek-ai/schemastery'
export interface Config {
  /** Normalized persona. */
  prefix: string
}
${input}
${schema}
export function apply(ctx: unknown, config: Config): void {}
`)
  return root
}

describe('config catalog transform inputs', () => {
  it('pastes and checks legacy input separately from normalized config', () => {
    const root = fixture(`const Shape = z.object({ text: z.string() })
const Alias = (Shape)
export const Config = z.transform(Alias, (value: Input) => ({ prefix: value.text }))`)
    const entries = collectConfigCatalog(root)
    expect(entries[0]?.schemaKeys).toEqual(['text'])
    expect(entries[0]?.schemaInputTypeName).toBe('Input')
    const output = render(entries)
    expect(output).toContain('Runtime schema input: `Input`; normalized plugin config: `Config`.')
    expect(output).toContain('text: string')
    expect(output).toContain('prefix: string')
  })

  it('checks nested raw input paths against the callback input declaration', () => {
    const root = fixture(`export const Config = z.transform(
  z.object({ text: z.object({ missing: z.string() }) }),
  (value: Input) => ({ prefix: value.text.name }),
)`, `interface Input {
  /** Structured legacy input. */
  text: {
    /** Accepted field. */
    name: string
  }
}`)
    expect(() => collectConfigCatalog(root)).toThrow("schema validates key 'text.missing'")
  })

  it('keeps the field check for ordinary aliased schemas', () => {
    const root = fixture(`const Shape = z.object({ text: z.string() })
export const Config = Shape`)
    expect(() => collectConfigCatalog(root)).toThrow("config input type 'Config' declares no such member")
  })

  it('accepts an ordinary schema alias when all fields are declared', () => {
    const root = fixture(`const Shape = z.object({ prefix: z.string() })
export const Config = Shape`)
    expect(collectConfigCatalog(root)[0]?.schemaKeys).toEqual(['prefix'])
  })

  it.each([
    ['untyped callback', 'z.transform(z.object({ text: z.string() }), value => ({ prefix: value.text }))', 'named input parameter type'],
    ['unresolved input', 'z.transform(Missing, (value: Input) => ({ prefix: value.text }))', 'not an initialized local constant'],
    ['opaque input', 'z.transform(makeSchema(), (value: Input) => ({ prefix: value.text }))', 'not a statically walkable'],
    ['missing input type', 'z.transform(z.object({ text: z.string() }), (value: Missing) => ({ prefix: value.text }))', "references 'Missing'"],
  ])('refuses %s instead of dropping the input check', (_name, schema, error) => {
    expect(() => collectConfigCatalog(fixture(`export const Config = ${schema}`))).toThrow(error)
  })

  it('rejects cyclic schema aliases', () => {
    const root = fixture(`const First = Second
const Second = First
export const Config = z.transform(First, (value: Input) => ({ prefix: value.text }))`)
    expect(() => collectConfigCatalog(root)).toThrow("schema alias 'First' is cyclic")
  })

  it('rejects mutable schema aliases', () => {
    const root = fixture(`let Shape = z.object({ text: z.string() })
export const Config = z.transform(Shape, (value: Input) => ({ prefix: value.text }))`)
    expect(() => collectConfigCatalog(root)).toThrow('not an initialized local constant')
  })

  it.each([false, true])('requires an explicit input type when composing a transformed schema: %s', (typed) => {
    const root = fixture(`export const Config = z.transform(
  z.object({ text: z.string() }), (value: Input) => ({ prefix: value.text }),
)`)
    const dir = join(root, 'packages/preset/composed')
    mkdirSync(join(dir, 'src'), { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-composed' }))
    writeFileSync(join(dir, 'src/index.ts'), `import z from '@deepseek-ai/schemastery'
import * as Inner from '@deepseek-ai/dsh-fixture'
interface Config {
  /** Normalized value. */
  prefix: string
}
interface Input {
  /** Legacy input. */
  text: string
}
const Shape = z.intersect([Inner.Config])
export const Config = ${typed ? 'z.transform(Shape, (value: Input) => ({ prefix: value.text }))' : 'Shape'}
export function apply(ctx: unknown, config: Config): void {}
`)
    if (typed) expect(collectConfigCatalog(root)).toHaveLength(2)
    else expect(() => collectConfigCatalog(root)).toThrow('requires a typed outer transform input')
  })
})
