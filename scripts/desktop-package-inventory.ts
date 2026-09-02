import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, mkdir, readdir, realpath, stat, writeFile } from 'node:fs/promises'
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
  const outputIndex = args.indexOf('--output')
  if (outputIndex < 0 || outputIndex === args.length - 1) {
    throw new Error('Desktop package inventory usage: --output <inventory.json> <package root>')
  }
  const output = args[outputIndex + 1]
  const roots = args.filter((_value, index) => index !== outputIndex && index !== outputIndex + 1)
  const packageRoot = roots[0]
  if (output === undefined || packageRoot === undefined || roots.length !== 1) {
    throw new Error('Desktop package inventory usage: --output <inventory.json> <package root>')
  }
  const inventory = await createDesktopPackageInventory(packageRoot)
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, `${JSON.stringify(inventory, null, 2)}\n`, 'utf8')
  process.stdout.write(`desktop package inventory: recorded ${String(inventory.files.length)} files\n`)
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2))
}
