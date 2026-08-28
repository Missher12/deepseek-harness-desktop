import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  MACOS_COMPUTER_USE_HELPER_IDENTIFIER,
  assertComputerUseHelperArchitecture,
  buildComputerUseHelper,
  computerUseHelperBuildSpec,
} from './build-computer-use-helper.ts'

function machoX64(): Uint8Array {
  const bytes = new Uint8Array(32)
  bytes.set([0xcf, 0xfa, 0xed, 0xfe, 0x07, 0x00, 0x00, 0x01])
  return bytes
}

function peX64(): Uint8Array {
  const bytes = new Uint8Array(256)
  bytes.set([0x4d, 0x5a])
  new DataView(bytes.buffer).setUint32(0x3c, 0x80, true)
  bytes.set([0x50, 0x45, 0x00, 0x00, 0x64, 0x86], 0x80)
  return bytes
}

describe('Computer Use helper architecture gate', () => {
  it('accepts only an x64 Mach-O for Intel macOS', () => {
    expect(() => { assertComputerUseHelperArchitecture(machoX64(), 'darwin', 'x64') }).not.toThrow()
    expect(() => { assertComputerUseHelperArchitecture(peX64(), 'darwin', 'x64') }).toThrow(/Mach-O|architecture/i)
    expect(() => { assertComputerUseHelperArchitecture(machoX64(), 'darwin', 'arm64') }).toThrow(/unsupported/i)
  })

  it('accepts only an AMD64 PE image for Windows x64', () => {
    expect(() => { assertComputerUseHelperArchitecture(peX64(), 'win32', 'x64') }).not.toThrow()
    const x86 = peX64()
    x86[0x84] = 0x4c
    x86[0x85] = 0x01
    expect(() => { assertComputerUseHelperArchitecture(x86, 'win32', 'x64') }).toThrow(/PE|architecture/i)
    expect(() => { assertComputerUseHelperArchitecture(peX64(), 'linux', 'x64') }).toThrow(/unsupported/i)
  })

  it('pins exact Rust targets and staged paths', () => {
    expect(computerUseHelperBuildSpec('darwin', 'x64')).toEqual({
      rustTarget: 'x86_64-apple-darwin',
      artifactName: 'computer-use-helper',
      nativeRelativePath: 'darwin-x64/computer-use-helper',
    })
    expect(computerUseHelperBuildSpec('win32', 'x64')).toEqual({
      rustTarget: 'x86_64-pc-windows-msvc',
      artifactName: 'computer-use-helper.exe',
      nativeRelativePath: 'win32-x64/computer-use-helper.exe',
    })
  })

  it('assigns the staged macOS helper a stable nested code identifier', async () => {
    const commands: Array<{ command: string; args: readonly string[]; cwd: string }> = []
    expect(MACOS_COMPUTER_USE_HELPER_IDENTIFIER).toBe(
      computerUseHelperBuildSpec('darwin', 'x64').artifactName,
    )
    const target = await buildComputerUseHelper('/repo', {
      platform: 'darwin',
      arch: 'x64',
      run: (command, args, cwd) => { commands.push({ command, args, cwd }) },
      remove: async () => undefined,
      read: async () => machoX64(),
      makeDirectory: async () => undefined,
      copy: async () => undefined,
      makeExecutable: async () => undefined,
    })

    expect(target).toBe('/repo/apps/desktop/native-bin/darwin-x64/computer-use-helper')
    expect(commands).toEqual([
      {
        command: 'cargo',
        args: ['build', '--locked', '--release', '--target', 'x86_64-apple-darwin'],
        cwd: '/repo/native/computer-use-helper',
      },
      {
        command: 'codesign',
        args: [
          '--force', '--sign', '-', '--identifier',
          MACOS_COMPUTER_USE_HELPER_IDENTIFIER,
          '/repo/apps/desktop/native-bin/darwin-x64/computer-use-helper',
        ],
        cwd: '/repo',
      },
    ])
  })

  it('keeps macOS observation free of fallback capture and permission-request APIs', () => {
    const macosRoot = new URL('../native/computer-use-helper/crates/helper/src/platform/macos/', import.meta.url)
    expect(existsSync(new URL('mod.rs', macosRoot))).toBe(true)
    const source = [
      '../native/computer-use-helper/crates/protocol/src/lib.rs',
      '../native/computer-use-helper/crates/core/src/lib.rs',
      '../native/computer-use-helper/crates/helper/src/main.rs',
      '../native/computer-use-helper/crates/helper/src/platform/macos/mod.rs',
      '../native/computer-use-helper/crates/helper/src/platform/macos/accessibility.rs',
      '../native/computer-use-helper/crates/helper/src/platform/macos/capture.rs',
      '../native/computer-use-helper/crates/helper/src/platform/macos/permissions.rs',
      '../native/computer-use-helper/crates/helper/src/platform/macos/scale.rs',
    ].map(path => readFileSync(new URL(path, import.meta.url), 'utf8')).join('\n')
    expect(source).toMatch(/AXUIElement/)
    expect(source).toMatch(/SCScreenshotManager/)
    expect(source).toMatch(/SCContentFilter/)
    expect(source).toMatch(/SCStreamConfiguration/)
    expect(source).not.toMatch(/CGWindowListCreateImage|CGDisplayCreateImage|CGRequestScreenCaptureAccess|AXIsProcessTrustedWithOptions/)
    expect(source).not.toContain('b"AXValue\\0"')
    expect(source).not.toMatch(/CGEvent|SendInput|AppleScript|PowerShell|std::net/)
  })
})
