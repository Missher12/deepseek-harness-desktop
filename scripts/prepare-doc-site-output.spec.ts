import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { prepareDocSiteOutput } from './prepare-doc-site-output.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('prepareDocSiteOutput', () => {
  it('removes only the fixed generated site directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-doc-output-'))
    roots.push(root)
    mkdirSync(join(root, 'website/.dist'), { recursive: true })
    writeFileSync(join(root, 'website/.dist/index.md'), 'stale\n')
    writeFileSync(join(root, 'website/keep.txt'), 'keep\n')

    prepareDocSiteOutput(root)

    expect(existsSync(join(root, 'website/.dist'))).toBe(false)
    expect(existsSync(join(root, 'website/keep.txt'))).toBe(true)
  })

  it('rejects a website directory that resolves outside the repository', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-doc-output-'))
    const outside = mkdtempSync(join(tmpdir(), 'dsh-doc-output-outside-'))
    roots.push(root, outside)
    symlinkSync(outside, join(root, 'website'))

    expect(() => {
      prepareDocSiteOutput(root)
    }).toThrow('refusing output through a linked website directory')
    expect(existsSync(outside)).toBe(true)
  })
})
