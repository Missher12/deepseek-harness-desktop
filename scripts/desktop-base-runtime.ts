/** Fingerprint separately built official Harness files before base staging. */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, readdir, readFile, readlink, realpath, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

const OFFICIAL_SHA = 'fb2c4b9e698e30edb738bca4cf0618587db7d203'
const HARNESS_VERSION = '0.1.5-rc.2'
const PROVENANCE_FILE = 'provenance.json'

/** Source identity established by the isolated build owner. */
export interface OfficialRuntimeOrigin {
  sourceSha: string
  harnessVersion: string
}

type RuntimeFile =
  | { path: string; kind: 'file'; bytes: number; sha256: string }
  | { path: string; kind: 'symlink'; target: string }

/** Physical file inventory bound to a separately established official source. */
export interface OfficialRuntimeProvenance extends OfficialRuntimeOrigin {
  schema: 1
  files: RuntimeFile[]
  inventorySha256: string
}

function assertOrigin(origin: OfficialRuntimeOrigin): void {
  if (origin.sourceSha !== OFFICIAL_SHA || origin.harnessVersion !== HARNESS_VERSION) {
    throw new Error('Base runtime requires the pinned official source and Harness version.')
  }
}

function digestInventory(files: RuntimeFile[]): string {
  return createHash('sha256').update(JSON.stringify(files)).digest('hex')
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const bytes of createReadStream(path)) hash.update(bytes as Buffer)
  return hash.digest('hex')
}

async function inventory(root: string): Promise<RuntimeFile[]> {
  const physicalRoot = await realpath(root)
  const files: RuntimeFile[] = []
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'))
    for (const entry of entries) {
      const path = join(directory, entry.name)
      const local = relative(root, path).split(sep).join('/')
      if (local === PROVENANCE_FILE) continue
      const stat = await lstat(path)
      if (stat.isSymbolicLink()) {
        const target = await readlink(path)
        const targetLocation = relative(physicalRoot, await realpath(path))
        if (isAbsolute(target) || isAbsolute(targetLocation)
          || targetLocation === '..' || targetLocation.startsWith(`..${sep}`)) {
          throw new Error(`Runtime link points outside its physical directory: ${local}`)
        }
        files.push({ path: local, kind: 'symlink', target })
      } else if (stat.isDirectory()) {
        await visit(path)
      } else if (stat.isFile()) {
        files.push({ path: local, kind: 'file', bytes: stat.size, sha256: await hashFile(path) })
      } else {
        throw new Error(`Unsupported runtime file: ${local}`)
      }
    }
  }
  await visit(root)
  return files.sort((left, right) => left.path.localeCompare(right.path, 'en'))
}

/**
 * Record actual installed bytes after the owner independently verifies source and build inputs.
 * Existing provenance is never overwritten; all symlinks must stay within the runtime.
 * @param runtimeDirectory - completed, exclusively owned runtime directory.
 * @param origin - source identity from the isolated official build receipt.
 * @returns file inventory and its SHA-256 digest.
 */
export async function recordOfficialRuntime(
  runtimeDirectory: string,
  origin: OfficialRuntimeOrigin,
): Promise<OfficialRuntimeProvenance> {
  assertOrigin(origin)
  const root = resolve(runtimeDirectory)
  const files = await inventory(root)
  if (files.length === 0) throw new Error('Official runtime inventory is empty.')
  const receipt: OfficialRuntimeProvenance = {
    schema: 1, ...origin, files, inventorySha256: digestInventory(files),
  }
  await writeFile(join(root, PROVENANCE_FILE), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
  return receipt
}

/**
 * Verify the complete physical runtime against its recorded official origin and inventory.
 * @param runtimeDirectory - immutable runtime input to base staging.
 * @returns accepted source and byte inventory; throws on any missing, changed, added or escaped file.
 */
export async function verifyOfficialRuntime(runtimeDirectory: string): Promise<OfficialRuntimeProvenance> {
  const root = resolve(runtimeDirectory)
  const path = join(root, PROVENANCE_FILE)
  if (!(await lstat(path)).isFile()) throw new Error('Runtime provenance must be a regular file.')
  const value: unknown = JSON.parse(await readFile(path, 'utf8'))
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid runtime provenance.')
  }
  const candidate = value as Record<string, unknown>
  if (candidate.schema !== 1 || typeof candidate.sourceSha !== 'string'
    || typeof candidate.harnessVersion !== 'string' || !Array.isArray(candidate.files)
    || typeof candidate.inventorySha256 !== 'string') throw new Error('Invalid runtime provenance fields.')
  assertOrigin({ sourceSha: candidate.sourceSha, harnessVersion: candidate.harnessVersion })
  const actual = await inventory(root)
  if (candidate.inventorySha256 !== digestInventory(actual)
    || JSON.stringify(candidate.files) !== JSON.stringify(actual)) {
    throw new Error('Official runtime inventory bytes/hash differ from the recorded build.')
  }
  return { schema: 1, sourceSha: candidate.sourceSha, harnessVersion: candidate.harnessVersion,
    files: actual, inventorySha256: candidate.inventorySha256 }
}
