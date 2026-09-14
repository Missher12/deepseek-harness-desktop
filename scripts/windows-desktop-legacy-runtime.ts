/** Prepare Windows-only historical runtime inputs without executing its NSIS installer. */
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, mkdir, open, readFile, realpath, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import type { BaseLegacyRuntimeInput } from '../apps/desktop/tests/base-legacy-fixture.ts'

const SETUP_SHA256 = '9d5f01a40b3fa70af31e49ffc50ce16b8ef6c86a3f2c221ae41fa5b6fb05f5ee'
const RELEASE_URL = 'https://github.com/Missher12/deepseek-harness-desktop/releases/download/desktop-v0.5.5/DeepSeek-Harness-Setup-0.5.5-win-x64.exe'
const execFileAsync = promisify(execFile)

async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

async function physicalFile(root: string, path: string): Promise<string> {
  const actual = await realpath(path)
  const local = relative(root, actual)
  if (isAbsolute(local) || local === '..' || local.startsWith(`..${sep}`) || actual !== path
    || !(await lstat(path)).isFile()) throw new Error('Old runtime entry must be a physical file inside its extracted owner.')
  return actual
}

/** @param path Downloaded old Setup. @returns After its fixed release bytes match. */
export async function verifyWindowsLegacySetup(path: string): Promise<void> {
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink() || info.size !== 146631832) throw new Error('Windows 0.5.5 Setup bytes do not match.')
  if (await hashFile(path) !== SETUP_SHA256) throw new Error('Windows 0.5.5 Setup SHA-256 does not match.')
}

async function verifyX64Executable(path: string): Promise<void> {
  const file = await open(path, 'r')
  try {
    const dos = Buffer.alloc(64)
    if ((await file.read(dos, 0, dos.length, 0)).bytesRead !== dos.length || dos.toString('ascii', 0, 2) !== 'MZ') {
      throw new Error('The historical executable is not a Windows PE image.')
    }
    const pe = Buffer.alloc(6)
    if ((await file.read(pe, 0, pe.length, dos.readUInt32LE(60))).bytesRead !== pe.length
      || pe.readUInt32LE(0) !== 0x0000_4550 || pe.readUInt16LE(4) !== 0x8664) {
      throw new Error('The historical executable is not Windows x64.')
    }
  } finally { await file.close() }
}

/** @param root Extracted x64 application. @returns Actual old runtime entry paths and hashes, never synthetic defaults. */
export async function collectWindowsLegacyRuntime(root: string): Promise<Pick<BaseLegacyRuntimeInput,
  'extractedRoot' | 'modulesRoot' | 'executablePath' | 'executableKind' | 'cliPath' | 'applicationAsarPath' | 'files'>> {
  const extractedRoot = await realpath(root)
  if (!(await lstat(extractedRoot)).isDirectory()) throw new Error('Missing extracted application directory.')
  const executablePath = await physicalFile(extractedRoot, join(extractedRoot, 'DeepSeek Harness.exe'))
  await verifyX64Executable(executablePath)
  const applicationAsarPath = await physicalFile(extractedRoot, join(extractedRoot, 'resources/app.asar'))
  const requireDesktop = createRequire(new URL('../apps/desktop/package.json', import.meta.url))
  const requireBuilder = createRequire(requireDesktop.resolve('electron-builder'))
  const requireAppBuilder = createRequire(requireBuilder.resolve('app-builder-lib'))
  const asar = requireAppBuilder('@electron/asar') as { extractFile(archive: string, filename: string): Buffer }
  const desktop = JSON.parse(asar.extractFile(applicationAsarPath, 'package.json').toString('utf8')) as Record<string, unknown>
  if (desktop.name !== '@deepseek-ai/dsh-desktop' || desktop.version !== '0.5.5') throw new Error('Wrong historical Desktop package.')
  const modulesRoot = join(extractedRoot, 'resources/app.asar.unpacked/node_modules')
  if (await realpath(modulesRoot) !== modulesRoot || !(await lstat(modulesRoot)).isDirectory()) throw new Error('Missing physical old module root.')
  const cliPath = await physicalFile(extractedRoot, join(modulesRoot, '@deepseek-ai/dsh/lib/bin.js'))
  const resolver = createRequire(cliPath)
  const required = new Set([executablePath, cliPath, applicationAsarPath])
  for (const name of ['cordis', 'dsh-session', 'dsh-session-persistence-jsonl', 'dsh-storage', 'dsh-storage-json',
    'dsh-storage-domain', 'dsh-workspace', 'dsh-app-boot', 'dsh-llm']) {
    required.add(await physicalFile(extractedRoot, resolver.resolve(`@deepseek-ai/${name}`)))
  }
  for (const name of ['dsh', 'dsh-session', 'dsh-session-persistence-jsonl']) {
    const path = await physicalFile(extractedRoot, resolver.resolve(`@deepseek-ai/${name}/package.json`))
    const manifest = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
    if (manifest.name !== `@deepseek-ai/${name}` || manifest.version !== '0.1.3-alpha.1') throw new Error('Wrong historical Harness package.')
    required.add(path)
  }
  const files = await Promise.all([...required].sort().map(async path => ({ path, sha256: await hashFile(path) })))
  return { extractedRoot, modulesRoot, executablePath, executableKind: 'electron', cliPath, applicationAsarPath, files }
}

/**
 * Unpack the pinned NSIS payload with an existing Windows 7-Zip; never run old application code here.
 * @param artifactPath Fixed published Setup downloaded by the job.
 * @param workRoot Absent private preparation directory.
 * @param sevenZip Existing Windows extractor executable.
 * @returns The physical descriptor path consumed by the shared historical fixture producer.
 */
export async function prepareWindowsLegacyRuntime(artifactPath: string, workRoot: string, sevenZip: string): Promise<string> {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Historical extraction requires a Windows x64 job.')
  await verifyWindowsLegacySetup(artifactPath)
  await mkdir(workRoot, { mode: 0o700 })
  const owner = await realpath(workRoot)
  const outer = join(owner, 'nsis')
  const runtime = join(owner, 'runtime')
  await mkdir(outer)
  await mkdir(runtime)
  // The pinned electron-builder 26.15.3 x64 NSIS template embeds this exact member.
  await execFileAsync(sevenZip, ['e', '-y', '-bd', '-bso0', '-bsp0', resolve(artifactPath), '$PLUGINSDIR/app-64.7z', `-o${outer}`], {
    timeout: 120_000, maxBuffer: 1024 * 1024,
  })
  const payload = await physicalFile(owner, join(outer, 'app-64.7z'))
  await execFileAsync(sevenZip, ['x', '-y', '-bd', '-bso0', '-bsp0', payload, `-o${runtime}`], {
    timeout: 120_000, maxBuffer: 1024 * 1024,
  })
  const entries = await collectWindowsLegacyRuntime(runtime)
  await verifyWindowsLegacySetup(artifactPath)
  const descriptor: BaseLegacyRuntimeInput = { ...entries, artifactPath: await realpath(artifactPath), artifactSha256: SETUP_SHA256,
    releaseUrl: RELEASE_URL, sourceSha: 'c0b92b1fcc5a6481eb219a8b5e5510980e99bf78', desktopVersion: '0.5.5',
    harnessVersion: '0.1.3-alpha.1', platform: 'win32', arch: 'x64' }
  const output = join(owner, 'legacy-runtime.json')
  await writeFile(output, `${JSON.stringify(descriptor, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
  return output
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [artifact, workRoot, sevenZip, extra] = process.argv.slice(2)
  if (artifact === undefined || workRoot === undefined || sevenZip === undefined || extra !== undefined) {
    throw new Error('Expected the fixed Setup, absent preparation directory and existing 7-Zip executable.')
  }
  await prepareWindowsLegacyRuntime(resolve(artifact), resolve(workRoot), resolve(sevenZip))
  process.stdout.write('Windows 0.5.5 runtime input prepared from verified release bytes.\n')
}
