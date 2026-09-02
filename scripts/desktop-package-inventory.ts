import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Stable categories used to compare Desktop package trees. */
export const DESKTOP_PACKAGE_CATEGORIES = [
  'electron-runtime',
  'app.asar',
  'app.asar.unpacked',
  'locales',
  'native-prebuilds',
  'licenses',
  'other',
] as const

export type DesktopPackageCategory = typeof DESKTOP_PACKAGE_CATEGORIES[number]

/** One portable file record with no installation-root or user path. */
export interface DesktopPackageInventoryFile {
  path: string
  bytes: number
  category: DesktopPackageCategory
  sha256: string
}

interface CategorySummary {
  bytes: number
  files: number
}

/** Reproducible inventory for one staged or installed Desktop tree. */
export interface DesktopPackageInventory {
  schemaVersion: 1
  totalBytes: number
  files: readonly DesktopPackageInventoryFile[]
  largestFiles: readonly DesktopPackageInventoryFile[]
  categories: Record<DesktopPackageCategory, CategorySummary>
}

export type DesktopPackagePolicy = 'windows-x64'

export interface DesktopPackagePathInventory {
  files: readonly { path: string }[]
}

const WINDOWS_ELECTRON_LOCALES = new Set(['en-US.pak', 'zh-CN.pak'])
const WINDOWS_X64_NATIVE_PACKAGES = [
  { pattern: /(?:^|\/)node_modules\/@napi-rs\/canvas-([^/]+)(?:\/|$)/u, target: 'win32-x64-msvc' },
  { pattern: /(?:^|\/)node_modules\/@koromix\/koffi-([^/]+)(?:\/|$)/u, target: 'win32-x64' },
  { pattern: /(?:^|\/)node_modules\/node-addon-require-builtin-([^/]+)(?:\/|$)/u, target: 'win32-x64-msvc' },
] as const

function windowsX64PolicyViolation(path: string): string | undefined {
  const normalized = path.replaceAll('\\', '/')
  const lower = normalized.toLowerCase()
  if (/\.(?:pdb|map|d\.ts|d\.cts|d\.mts|tsbuildinfo)$/u.test(lower)) {
    return 'debug, source-map, declaration, or incremental-build artifact'
  }
  const locale = /^(?:resources\/)?locales\/([^/]+\.pak)$/u.exec(normalized)
  if (locale !== null && !WINDOWS_ELECTRON_LOCALES.has(locale[1] ?? '')) {
    return 'unapproved Electron locale'
  }
  const prebuild = /(?:^|\/)prebuilds\/([^/]+)(?:\/|$)/u.exec(lower)
  if (prebuild !== null && !(prebuild[1] ?? '').startsWith('win32-x64')) {
    return 'non-Windows-x64 native prebuild'
  }
  const sharp = /(?:^|\/)node_modules\/@img\/(?:sharp|sharp-libvips)-([^/]+)(?:\/|$)/u.exec(lower)
  const sharpTarget = sharp?.[1]
  if (sharpTarget !== undefined
    && /^(?:darwin|freebsd|linux|linuxmusl|win32)-/u.test(sharpTarget)
    && sharpTarget !== 'win32-x64') {
    return 'non-Windows-x64 sharp package'
  }
  for (const nativePackage of WINDOWS_X64_NATIVE_PACKAGES) {
    const match = nativePackage.pattern.exec(lower)
    if (match !== null && match[1] !== nativePackage.target) {
      return 'non-Windows-x64 native package'
    }
  }
  return undefined
}

/** Reject target-incompatible files from one portable package inventory. */
export function assertDesktopPackageInventoryPolicy(
  inventory: DesktopPackagePathInventory,
  policy: DesktopPackagePolicy,
): void {
  const policyLabel: Record<DesktopPackagePolicy, string> = { 'windows-x64': 'Windows x64' }
  const violations = inventory.files.flatMap((file) => {
    const reason = windowsX64PolicyViolation(file.path)
    return reason === undefined ? [] : [`${file.path} (${reason})`]
  })
  if (violations.length > 0) {
    throw new Error(`${policyLabel[policy]} package policy rejected ${String(violations.length)} file(s): ${violations.join(', ')}`)
  }
  const paths = inventory.files.map(file => file.path.replaceAll('\\', '/'))
  const preservedRuntimeAssets = [
    {
      label: 'offline app.asar renderer',
      present: paths.includes('resources/app.asar'),
    },
    {
      label: 'PDF worker',
      present: paths.includes('resources/app.asar.unpacked/node_modules/@deepseek-ai/dsh-attachment-local/lib/pdf-worker.cjs'),
    },
    {
      label: 'runtime license or notice',
      present: paths.some(path => /(?:^|\/)(?:licen[cs]e|third_party_notices|notices?)(?:\.|$)/iu.test(path)),
    },
    {
      label: 'PDF standard font',
      present: paths.some(path => path.includes('/pdfjs-dist/standard_fonts/')),
    },
    {
      label: 'runtime WASM',
      present: paths.some(path => path.endsWith('.wasm')),
    },
  ]
  const missing = preservedRuntimeAssets.filter(asset => !asset.present).map(asset => asset.label)
  if (missing.length > 0) {
    throw new Error(`${policyLabel[policy]} package policy is missing preserved runtime assets: ${missing.join(', ')}`)
  }
}

/** Ensure managed packages are linkable physical directories outside app.asar. */
export function assertManagedPackageRootsArePhysical(
  inventory: DesktopPackagePathInventory,
  packageNames: readonly string[],
): void {
  const paths = new Set(inventory.files.map(file => file.path.replaceAll('\\', '/')))
  for (const packageName of packageNames) {
    if (!/^(?:@[^/]+\/)?[^/]+$/u.test(packageName)) {
      throw new Error('Desktop managed package name must be a package name without path traversal.')
    }
    const manifest = `resources/app.asar.unpacked/node_modules/${packageName}/package.json`
    if (!paths.has(manifest)) {
      throw new Error(`Desktop managed package ${packageName} is missing from physical app.asar.unpacked node_modules.`)
    }
  }
}

function portable(path: string): string {
  return path.split(sep).join('/')
}

function isWithin(root: string, target: string): boolean {
  const offset = relative(root, target)
  return offset === '' || (!isAbsolute(offset) && offset !== '..' && !offset.startsWith(`..${sep}`))
}

function classify(path: string): DesktopPackageCategory {
  const normalized = path.toLowerCase()
  const name = basename(normalized)
  if (/^(licen[cs]e|third_party_notices|notices?)(\.|$)/u.test(name)) return 'licenses'
  if (normalized.endsWith('.node') || normalized.split('/').includes('prebuilds')) return 'native-prebuilds'
  if (normalized === 'resources/app.asar') return 'app.asar'
  if (normalized.startsWith('resources/app.asar.unpacked/')) return 'app.asar.unpacked'
  if (normalized.startsWith('locales/') || normalized.startsWith('resources/locales/')) return 'locales'
  if (!normalized.includes('/')) return 'electron-runtime'
  return 'other'
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

/**
 * Inventory one package tree without following symlinks outside that tree.
 * @param packageRoot - Exact staged or installed Desktop directory.
 * @returns Sorted relative file evidence and category totals.
 */
export async function createDesktopPackageInventory(packageRoot: string): Promise<DesktopPackageInventory> {
  const root = resolve(packageRoot)
  const rootReal = await realpath(root)
  const rootStats = await stat(rootReal)
  if (!rootStats.isDirectory()) throw new Error('Desktop package inventory root must be a directory.')
  const files: DesktopPackageInventoryFile[] = []

  const collectFile = async (logicalPath: string, physicalPath: string): Promise<void> => {
    const details = await stat(physicalPath)
    if (!details.isFile()) return
    const path = portable(logicalPath)
    files.push({
      path,
      bytes: details.size,
      category: classify(path),
      sha256: await hashFile(physicalPath),
    })
  }

  const walk = async (logicalDirectory: string, physicalDirectory: string, ancestors: ReadonlySet<string>): Promise<void> => {
    const entries = await readdir(physicalDirectory, { withFileTypes: true })
    for (const entry of entries) {
      const logicalPath = logicalDirectory === '' ? entry.name : `${logicalDirectory}/${entry.name}`
      const physicalPath = resolve(physicalDirectory, entry.name)
      const metadata = await lstat(physicalPath)
      if (metadata.isSymbolicLink()) {
        const target = await realpath(physicalPath)
        if (!isWithin(rootReal, target)) continue
        const targetStats = await stat(target)
        if (targetStats.isDirectory()) {
          if (ancestors.has(target)) continue
          await walk(logicalPath, target, new Set([...ancestors, target]))
        } else if (targetStats.isFile()) {
          await collectFile(logicalPath, target)
        }
        continue
      }
      if (metadata.isDirectory()) {
        const directoryReal = await realpath(physicalPath)
        if (ancestors.has(directoryReal)) continue
        await walk(logicalPath, physicalPath, new Set([...ancestors, directoryReal]))
      } else if (metadata.isFile()) {
        await collectFile(logicalPath, physicalPath)
      }
    }
  }

  await walk('', rootReal, new Set([rootReal]))
  files.sort((left, right) => left.path.localeCompare(right.path, 'en'))
  const categories = Object.fromEntries(DESKTOP_PACKAGE_CATEGORIES.map(category => [
    category,
    { bytes: 0, files: 0 },
  ])) as DesktopPackageInventory['categories']
  for (const file of files) {
    categories[file.category].bytes += file.bytes
    categories[file.category].files += 1
  }
  return {
    schemaVersion: 1,
    totalBytes: files.reduce((total, file) => total + file.bytes, 0),
    files,
    largestFiles: [...files].sort((left, right) => right.bytes - left.bytes || left.path.localeCompare(right.path, 'en')).slice(0, 30),
    categories,
  }
}

async function main(args: readonly string[]): Promise<void> {
  const usage = 'Desktop package inventory usage: --output <inventory.json> [--policy windows-x64 --manifest <package.json>] <package root>'
  let output: string | undefined
  let policy: DesktopPackagePolicy | undefined
  let manifestPath: string | undefined
  const roots: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--output' || argument === '--policy' || argument === '--manifest') {
      const value = args[index + 1]
      if (value === undefined) throw new Error(usage)
      if (argument === '--output') output = value
      if (argument === '--policy') {
        if (value !== 'windows-x64') throw new Error(`Unknown Desktop package policy: ${value}`)
        policy = value
      }
      if (argument === '--manifest') manifestPath = value
      index += 1
    } else {
      roots.push(argument ?? '')
    }
  }
  const packageRoot = roots[0]
  if (output === undefined || packageRoot === undefined || roots.length !== 1) throw new Error(usage)
  if ((policy === undefined) !== (manifestPath === undefined)) throw new Error(usage)
  const inventory = await createDesktopPackageInventory(packageRoot)
  if (policy !== undefined && manifestPath !== undefined) {
    assertDesktopPackageInventoryPolicy(inventory, policy)
    const manifest = JSON.parse(await readFile(resolve(manifestPath), 'utf8')) as {
      dependencies?: Record<string, unknown>
      optionalDependencies?: Record<string, unknown>
    }
    const managedPackages = Object.keys({
      ...manifest.dependencies,
      ...manifest.optionalDependencies,
    }).sort((left, right) => left.localeCompare(right, 'en'))
    assertManagedPackageRootsArePhysical(inventory, managedPackages)
  }
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, `${JSON.stringify(inventory, null, 2)}\n`, 'utf8')
  process.stdout.write(`desktop package inventory: recorded ${String(inventory.files.length)} files\n`)
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2))
}
