import { readdir, readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

async function readSourceTree(directory = new URL('../src/', import.meta.url)): Promise<string> {
  const entries = await readdir(directory, { withFileTypes: true })
  const parts = await Promise.all(entries
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(entry => entry.isDirectory()
      ? readSourceTree(new URL(`${entry.name}/`, directory))
      : entry.name.endsWith('.ts')
        ? readFile(new URL(entry.name, directory), 'utf8')
        : Promise.resolve('')))
  return parts.join('\n')
}

describe('tool-browser-control source boundary', () => {
  it('does not create selector, coordinate, upload, file, or encoded screenshot control paths', async () => {
    const source = await readSourceTree()
    expect(source).toContain("from '@deepseek-ai/dsh-browser-control'")
    expect(source).not.toMatch(/\b(?:selector|chooser|upload|file_path|approved|digest|grant)\s*:/u)
    expect(source).not.toMatch(/\b(?:x|y|fromX|fromY|toX|toY)\s*:/u)
    expect(source).not.toMatch(/(?:base64|toString\(\s*['"]base64)/u)
    expect(source).not.toMatch(/\b(?:eval|Runtime\.evaluate)\s*\(/u)
  })
})
