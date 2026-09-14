/** Synthetic legacy Web profile and protected data for Mac side-copy acceptance. */
import { createHash } from 'node:crypto'
import { cp, lstat, mkdir, readFile, readdir, realpath, symlink, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'

/** Explicit synthetic Session bytes; their format is owned by the supplying test. */
export interface MacosSessionSeed {
  readonly relativePath: string
  readonly content: Uint8Array
}

/** Paths owned by one private side-copy run; none refer to the user's runtime. */
export interface MacosLegacyProfileFixture {
  readonly home: string
  readonly dshHome: string
  readonly userData: string
  readonly outputs: string
  readonly evolutionArchive: string
  readonly protectedRoots: readonly string[]
}

/** Reject paths that could overwrite configuration or escape synthetic Session storage. */
export function validateMacosSessionSeeds(seeds: readonly MacosSessionSeed[]): void {
  const seen = new Set<string>()
  for (const seed of seeds) {
    const parts = seed.relativePath.split('/')
    if (parts[0] !== 'sessions' || parts.length < 3
      || parts.some(part => part === '' || part === '.' || part === '..')
      || seed.relativePath.includes('\\') || seed.relativePath.includes('\0') || seen.has(seed.relativePath)) {
      throw new Error('Session seed path must be unique and confined below sessions/.')
    }
    seen.add(seed.relativePath)
  }
}

/**
 * Populate a newly allocated test root with an ordered Web profile and synthetic data.
 * @param root - Physical private directory allocated by the driver.
 * @param currentApp - Already copied old app within root.
 * @param evolutionPackage - Already copied package within root.
 * @param seeds - Caller-supplied synthetic Session generations, never user logs.
 * @returns Paths and data roots protected across the update.
 */
export async function createMacosLegacyProfileFixture(
  root: string, currentApp: string, evolutionPackage: string, seeds: readonly MacosSessionSeed[],
): Promise<MacosLegacyProfileFixture> {
  validateMacosSessionSeeds(seeds)
  const physicalRoot = await realpath(root)
  if (physicalRoot !== root || !(await lstat(root)).isDirectory()) throw new Error('Fixture root must be physical.')
  for (const path of [currentApp, evolutionPackage]) {
    const child = relative(root, await realpath(path))
    if (child === '' || child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)) {
      throw new Error('Fixture inputs must belong to the private run.')
    }
  }
  const home = join(root, 'home')
  const dshHome = join(home, '.dsh')
  const userData = join(home, 'Library/Application Support/DeepSeek Harness')
  const outputs = join(home, 'deepseek-temp/synthetic-session')
  const web = join(dshHome, 'profiles/web')
  const evolutionArchive = join(root, 'evolution.tgz')
  for (const directory of [web, userData, outputs, join(dshHome, 'profiles/node_modules'),
    join(web, 'node_modules'), join(dshHome, 'sessions'), join(dshHome, 'missher-evolution')]) {
    await mkdir(directory, { recursive: true, mode: 0o700 })
  }
  await writeFile(join(web, 'package.json'), JSON.stringify({
    name: 'dsh-profile-web', private: true,
    dsh: { profile: { patchReload: 'live', bundles: [
      '@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-missher-evolution',
    ] } },
    dependencies: { 'dsh-missher-evolution': `file:${evolutionArchive}` },
  }, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  await writeFile(join(web, 'cordis.patch.yml'), '[]\n', { flag: 'wx', mode: 0o600 })
  await cp(evolutionPackage, join(web, 'node_modules/dsh-missher-evolution'), { recursive: true, dereference: false, verbatimSymlinks: true, errorOnExist: true, force: false })
  await symlink(join(currentApp, 'Contents/Resources/app.asar.unpacked/node_modules/@deepseek-ai'),
    join(dshHome, 'profiles/node_modules/@deepseek-ai'), 'dir')
  // These sentinels exercise byte preservation; they are not Evolution's mutable schema.
  await writeFile(join(dshHome, 'missher-evolution/side-copy-preservation.txt'),
    'synthetic evolution preservation sentinel\n', { flag: 'wx', mode: 0o600 })
  await writeFile(join(outputs, 'retained.txt'), 'synthetic generated output\n', { flag: 'wx', mode: 0o600 })
  for (const seed of seeds) {
    const path = join(dshHome, seed.relativePath)
    await mkdir(join(path, '..'), { recursive: true, mode: 0o700 })
    await writeFile(path, seed.content, { flag: 'wx', mode: 0o600 })
  }
  return { home, dshHome, userData, outputs, evolutionArchive,
    protectedRoots: [join(dshHome, 'sessions'), join(dshHome, 'missher-evolution'), outputs] }
}

/** Content identity for a protected tree; includes empty directories and rejects links. */
export interface MacosProtectedEntry {
  readonly path: string
  readonly kind: 'directory' | 'file'
  readonly sha256?: string
}

/**
 * Inventory protected synthetic data without following symlinks or accepting hard-linked files.
 * @param root - Private run root used for relative evidence paths.
 * @param paths - Protected roots within that run.
 * @returns Sorted path and content identities, including empty directories.
 */
export async function snapshotMacosProtectedData(root: string, paths: readonly string[]): Promise<MacosProtectedEntry[]> {
  const result: MacosProtectedEntry[] = []
  async function visit(path: string): Promise<void> {
    const local = relative(root, path)
    if (local === '' || local === '..' || local.startsWith(`..${sep}`) || isAbsolute(local)) {
      throw new Error('Protected data escapes the private run.')
    }
    const stat = await lstat(path)
    if (stat.isSymbolicLink()) throw new Error('Protected data contains a symbolic link.')
    // Resolving the parent also catches a replaced intermediate directory.
    if (await realpath(path) !== path) throw new Error('Protected data has a redirected ancestor.')
    if (stat.isDirectory()) {
      result.push({ path: local, kind: 'directory' })
      for (const name of (await readdir(path)).sort()) await visit(join(path, name))
    } else if (stat.isFile() && stat.nlink === 1) {
      result.push({ path: local, kind: 'file', sha256: createHash('sha256').update(await readFile(path)).digest('hex') })
    } else throw new Error('Protected data must contain private regular files and directories.')
  }
  for (const path of paths) await visit(path)
  return result.sort((a, b) => a.path.localeCompare(b.path, 'en'))
}
