import { readdir, readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const PROTOCOL_DECLARATIONS = [
  'ActionResult', 'BridgeRequest', 'BridgeRequestKind', 'BrowserClickRequest',
  'BrowserKeyRequest', 'BrowserNavigateRequest', 'BrowserNavigationRequest',
  'BrowserNavigationResult', 'BrowserRef', 'BrowserScrollRequest',
  'BrowserSelectRequest', 'BrowserSemanticRef', 'BrowserSnapshotRequest',
  'BrowserSnapshotResult', 'BrowserStopRequest', 'BrowserTypeRequest',
  'BrowserWaitRequest', 'ComputerClickRequest', 'ComputerDragRequest',
  'ComputerFocusRequest', 'ComputerKeyRequest', 'ComputerListRequest',
  'ComputerListResult', 'ComputerRef', 'ComputerScrollRequest',
  'ComputerSemanticRef', 'ComputerSnapshotRequest', 'ComputerSnapshotResult',
  'ComputerStatusRequest', 'ComputerStatusResult', 'ComputerStopRequest',
  'ComputerTypeRequest', 'ComputerWaitRequest', 'ControlKind', 'ControlLeaseId',
  'DesktopControlControl', 'DesktopControlError', 'DesktopControlErrorCode',
  'DesktopControlErrorResponse', 'DesktopControlOkResponse',
  'DesktopControlResultMap', 'DesktopStatusRequest', 'DesktopStatusResult',
  'GrantableApplication', 'KeyModifier', 'PngMetadata', 'PngTransferId',
  'PointerButton', 'RequestId', 'SessionId', 'StopResult', 'WaitResult',
  'ControlLeaseQuotaSnapshot', 'HelperClickRequest', 'HelperDragRequest',
  'HelperErrorResponse', 'HelperFocusRequest', 'HelperInputReleaseRequest',
  'HelperInputReleaseResult', 'HelperKeyRequest', 'HelperLeaseInstallRequest',
  'HelperLeaseInstallResult', 'HelperListRequest', 'HelperOkResponse',
  'HelperRequest', 'HelperRequestKind', 'HelperResultMap', 'HelperScrollRequest',
  'HelperSnapshotRequest', 'HelperStatusRequest', 'HelperStopRequest',
  'HelperTypeRequest', 'HelperWaitRequest', 'DecodedDesktopControlEnvelope',
  'DecodedPngFrame', 'DesktopControlMessage',
] as const

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

describe('browser-control source boundary', () => {
  it('has no copied wire DTO or generic escape hatch', async () => {
    const source = await readSourceTree()
    const names = `(?:${PROTOCOL_DECLARATIONS.join('|')})`
    const copiedDeclaration = new RegExp(
      `\\b(?:interface|type|class|enum)\\s+${names}\\b(?:\\s*<[^>]*>)?\\s*(?:=|\\{|extends\\b)`
      + `|\\bfunction\\s+${names}\\b\\s*\\(`
      + `|\\b(?:const|let|var)\\s+${names}\\b(?:\\s*:[^=]+)?\\s*=`,
    )

    expect(source).toContain("from '@deepseek-ai/dsh-desktop-control-protocol'")
    expect(source).toContain('BrowserSnapshotResult as BrowserSnapshot')
    expect(source).toContain('PngTransferId')
    expect(source).toContain('KeyModifier')
    expect(source).toContain('PngMetadata')
    expect(source).not.toMatch(copiedDeclaration)
    expect(source).not.toMatch(/\b(?:payload|schema|body)\??\s*:\s*(?:any|unknown)\b/)
    expect(source).not.toMatch(/\bRecord\s*</)
    expect(source).not.toMatch(/\[\s*key\s*:\s*string\s*\]/)
  })
})
