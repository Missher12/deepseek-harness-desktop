import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('computer-control source boundary', () => {
  it('has no copied wire DTO or generic escape hatch', async () => {
    const source = await Promise.all([
      readFile(new URL('../src/index.ts', import.meta.url), 'utf8'),
      readFile(new URL('../src/types.ts', import.meta.url), 'utf8'),
      readFile(new URL('../src/policy.ts', import.meta.url), 'utf8'),
    ]).then(parts => parts.join('\n'))

    expect(source).toContain("from '@deepseek-ai/dsh-desktop-control-protocol'")
    expect(source).toContain('ComputerStatusResult as ComputerControlStatus')
    expect(source).toContain('ComputerSnapshotResult as ComputerSnapshot')
    expect(source).toContain('ComputerStatusRequest')
    expect(source).toContain('PngTransferId')
    expect(source).toContain('KeyModifier')
    expect(source).toContain('PngMetadata')
    expect(source).toContain('PointerButton')
    expect(source).not.toMatch(
      /(?:interface|type)\s+(?:ComputerSnapshotRequest|ComputerClickRequest|ComputerTypeRequest|ComputerSnapshotResult)\s*(?:=|\{)/,
    )
    expect(source).not.toMatch(/\b(?:payload|schema)\s*:\s*unknown\b/)
    expect(source).not.toMatch(/\bRecord\s*</)
    expect(source).not.toMatch(/\[\s*key\s*:\s*string\s*\]/)
  })
})
