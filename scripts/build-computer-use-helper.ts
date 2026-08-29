import { spawnSync } from 'node:child_process'
import { chmod, copyFile, mkdir, readFile, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Stable nested identifier retained when the packaged app uses a stable signing identity. */
export const MACOS_COMPUTER_USE_HELPER_IDENTIFIER = 'computer-use-helper'

/** Exact native target and output selected for one supported Desktop build host. */
export interface ComputerUseHelperBuildSpec {
  readonly rustTarget: 'x86_64-apple-darwin' | 'x86_64-pc-windows-msvc'
  readonly artifactName: 'computer-use-helper' | 'computer-use-helper.exe'
  readonly nativeRelativePath: 'darwin-x64/computer-use-helper' | 'win32-x64/computer-use-helper.exe'
}

/** Resolve only the two release architectures supported by Desktop 0.4.5. */
export function computerUseHelperBuildSpec(
  platform: NodeJS.Platform,
  arch: string,
): ComputerUseHelperBuildSpec {
  if (platform === 'darwin' && arch === 'x64') {
    return {
      rustTarget: 'x86_64-apple-darwin',
      artifactName: 'computer-use-helper',
      nativeRelativePath: 'darwin-x64/computer-use-helper',
    }
  }
  if (platform === 'win32' && arch === 'x64') {
    return {
      rustTarget: 'x86_64-pc-windows-msvc',
      artifactName: 'computer-use-helper.exe',
      nativeRelativePath: 'win32-x64/computer-use-helper.exe',
    }
  }
  throw new Error(`Computer Use helper: unsupported Desktop target ${platform}-${arch}.`)
}

/** Verify the actual executable header independently of Cargo's output directory name. */
export function assertComputerUseHelperArchitecture(
  bytes: Uint8Array,
  platform: NodeJS.Platform,
  arch: string,
): void {
  computerUseHelperBuildSpec(platform, arch)
  if (platform === 'darwin') {
    const expected = [0xcf, 0xfa, 0xed, 0xfe, 0x07, 0x00, 0x00, 0x01]
    if (bytes.byteLength < 8 || expected.some((value, index) => bytes[index] !== value)) {
      throw new Error('Computer Use helper is not an x64 little-endian Mach-O executable.')
    }
    return
  }
  if (bytes.byteLength < 0x40 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) {
    throw new Error('Computer Use helper is not an AMD64 PE executable.')
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const peOffset = view.getUint32(0x3c, true)
  if (peOffset > bytes.byteLength - 6
    || bytes[peOffset] !== 0x50
    || bytes[peOffset + 1] !== 0x45
    || bytes[peOffset + 2] !== 0
    || bytes[peOffset + 3] !== 0
    || view.getUint16(peOffset + 4, true) !== 0x8664) {
    throw new Error('Computer Use helper PE architecture is not AMD64.')
  }
}

interface BuildDependencies {
  readonly platform: NodeJS.Platform
  readonly arch: string
  run(command: string, args: readonly string[], cwd: string): void
  remove(path: string): Promise<void>
  read(path: string): Promise<Uint8Array>
  makeDirectory(path: string): Promise<void>
  copy(source: string, target: string): Promise<void>
  makeExecutable(path: string): Promise<void>
}

const realDependencies: BuildDependencies = {
  platform: process.platform,
  arch: process.arch,
  run(command, args, cwd) {
    const result = spawnSync(command, [...args], { cwd, stdio: 'inherit', shell: false })
    if (result.error !== undefined) throw result.error
    if (result.status !== 0) throw new Error(`Computer Use helper build failed with status ${String(result.status)}.`)
  },
  remove: async (path) => { await rm(path, { recursive: true, force: true }) },
  read: async path => new Uint8Array(await readFile(path)),
  makeDirectory: async (path) => { await mkdir(path, { recursive: true }) },
  copy: async (source, target) => { await copyFile(source, target) },
  makeExecutable: async (path) => { await chmod(path, 0o755) },
}

/** Build and stage exactly one verified native helper for the current release platform. */
export async function buildComputerUseHelper(
  repositoryRoot: string,
  dependencies: BuildDependencies = realDependencies,
): Promise<string> {
  const root = resolve(repositoryRoot)
  const workspace = join(root, 'native', 'computer-use-helper')
  const nativeBin = join(root, 'apps', 'desktop', 'native-bin')
  const spec = computerUseHelperBuildSpec(dependencies.platform, dependencies.arch)
  dependencies.run('cargo', [
    'build', '--locked', '--release', '--target', spec.rustTarget,
  ], workspace)
  const artifact = join(workspace, 'target', spec.rustTarget, 'release', spec.artifactName)
  assertComputerUseHelperArchitecture(await dependencies.read(artifact), dependencies.platform, dependencies.arch)
  await dependencies.remove(nativeBin)
  const target = join(nativeBin, spec.nativeRelativePath)
  await dependencies.makeDirectory(dirname(target))
  await dependencies.copy(artifact, target)
  if (dependencies.platform === 'darwin') {
    await dependencies.makeExecutable(target)
    dependencies.run('codesign', [
      '--force', '--sign', '-', '--identifier', MACOS_COMPUTER_USE_HELPER_IDENTIFIER, target,
    ], root)
  }
  assertComputerUseHelperArchitecture(await dependencies.read(target), dependencies.platform, dependencies.arch)
  return target
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && import.meta.url === pathToFileURL(resolve(invokedPath)).href) {
  try {
    const target = await buildComputerUseHelper(resolve(import.meta.dirname, '..'))
    console.log(`Computer Use helper: staged ${target}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Computer Use helper build failed.')
    process.exitCode = 1
  }
}
