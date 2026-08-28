import { readdir, readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const PROTOCOL_OWNED_DECLARATIONS = [
  'BridgeRequest',
  'ControlLeaseAcquireRequest',
  'ControlLeaseAcquireResult',
  'ControlLeaseCapability',
  'ControlLeaseId',
  'ControlLeaseReleaseRequest',
  'ControlLeaseReleaseResult',
  'ControlLeaseSurfaceKind',
  'ControlLeaseTarget',
  'DecodedDesktopControlEnvelope',
  'DesktopControlControl',
  'DesktopControlMessage',
  'ImmutablePng',
  'RequestId',
  'SessionId',
] as const

async function readSourceTree(directory: URL): Promise<string> {
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

describe('desktop-control-host source boundary', () => {
  it('imports every wire and lease DTO instead of copying the protocol vocabulary', async () => {
    const host = await readSourceTree(new URL('../src/', import.meta.url))
    const desktopBridge = await readFile(new URL(
      '../../../../apps/desktop/src/control/bridge-server.ts',
      import.meta.url,
    ), 'utf8')
    const source = `${host}\n${desktopBridge}`
    const names = `(?:${PROTOCOL_OWNED_DECLARATIONS.join('|')})`
    const copiedDeclaration = new RegExp(
      `\\b(?:interface|type|class|enum)\\s+${names}\\b(?:\\s*<[^>]*>)?\\s*(?:=|\\{|extends\\b)`
      + `|\\bfunction\\s+${names}\\b\\s*\\(`
      + `|\\b(?:const|let|var)\\s+${names}\\b(?:\\s*:[^=]+)?\\s*=`,
    )

    expect(source).toContain("from '@deepseek-ai/dsh-desktop-control-protocol'")
    expect(source).not.toMatch(copiedDeclaration)
    expect(source).not.toMatch(/\b(?:payload|data|schema|body)\??\s*:\s*(?:any|unknown)\b/)
    expect(source).not.toMatch(/\bRecord\s*</)
    expect(source).not.toMatch(/\[\s*key\s*:\s*string\s*\]/)
  })
})
