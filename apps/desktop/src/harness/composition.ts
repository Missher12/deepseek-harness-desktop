/** Locate the packaged Harness and validate the pinned base composition. */
import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

const OFFICIAL_SHA = 'fb2c4b9e698e30edb738bca4cf0618587db7d203'
const BASE_HARNESS_VERSION = '0.1.5-rc.2'
const DESCRIPTOR_FIELDS = ['schema', 'kind', 'officialSha', 'harnessVersion']

/** The selected installed composition and the arguments needed to launch it. */
export interface DesktopRuntimePaths {
  kind: 'full' | 'base'
  profile: 'web' | 'desktop-base'
  cli: string
  patch: string
  harnessVersion: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readJson(path: string): unknown {
  const source = readFileSync(path, 'utf8')
  try {
    return JSON.parse(source) as unknown
  } catch (cause) {
    throw new Error(`Invalid JSON in ${path}.`, { cause })
  }
}

function requireInstalledPath(path: string, installation: string, kind: 'file' | 'directory'): void {
  const target = realpathSync(path)
  const local = relative(installation, target)
  if (local === '..' || local.startsWith(`..${sep}`) || isAbsolute(local)) {
    throw new Error(`Desktop runtime path is outside the installation: ${path}.`)
  }
  const stats = statSync(target)
  if (kind === 'file' ? !stats.isFile() : !stats.isDirectory()) {
    throw new Error(`Desktop runtime requires a ${kind}: ${path}.`)
  }
}

function readHarnessVersion(manifestPath: string): string {
  const manifest = readJson(manifestPath)
  if (!isRecord(manifest) || typeof manifest.version !== 'string' || manifest.version.length === 0) {
    throw new Error(`Harness manifest requires a version: ${manifestPath}.`)
  }
  return manifest.version
}

/**
 * Resolve full installations without a descriptor or validate the pinned base installation.
 * Base files and symlink targets must remain inside the installation; artifact hashes are verified during staging.
 * @param installAnchorPath Absolute filename whose directory owns the Desktop composition and patches.
 * @returns CLI, profile, patch, and actual Harness version for the selected composition.
 * @throws When an existing descriptor is unsupported or a required base file is missing or incompatible.
 */
export function resolveDesktopRuntime(installAnchorPath: string): DesktopRuntimePaths {
  const anchor = resolve(installAnchorPath)
  const directory = dirname(anchor)
  const baseDirectory = directory.endsWith('.asar') ? `${directory}.unpacked` : directory
  const descriptorPath = join(baseDirectory, 'desktop-composition.json')
  if (lstatSync(descriptorPath, { throwIfNoEntry: false }) === undefined) {
    const manifestPath = createRequire(anchor).resolve('@deepseek-ai/dsh/package.json')
    return {
      kind: 'full',
      profile: 'web',
      cli: join(dirname(manifestPath), 'lib/bin.js'),
      patch: join(directory, 'desktop.cordis.patch.yml'),
      harnessVersion: readHarnessVersion(manifestPath),
    }
  }

  const installation = realpathSync(baseDirectory)
  requireInstalledPath(descriptorPath, installation, 'file')
  const descriptor = readJson(descriptorPath)
  if (!isRecord(descriptor)
    || Object.keys(descriptor).length !== DESCRIPTOR_FIELDS.length
    || Object.keys(descriptor).some(key => !DESCRIPTOR_FIELDS.includes(key))
    || descriptor.schema !== 1
    || descriptor.kind !== 'base'
    || descriptor.officialSha !== OFFICIAL_SHA
    || descriptor.harnessVersion !== BASE_HARNESS_VERSION) {
    throw new Error(`Unsupported Desktop composition: ${descriptorPath}.`)
  }

  const runtime = join(baseDirectory, 'official-runtime')
  requireInstalledPath(runtime, installation, 'directory')
  const provenancePath = join(runtime, 'provenance.json')
  requireInstalledPath(provenancePath, installation, 'file')
  const provenance = readJson(provenancePath)
  if (!isRecord(provenance)
    || provenance.sourceSha !== OFFICIAL_SHA
    || provenance.harnessVersion !== BASE_HARNESS_VERSION) {
    throw new Error(`Incompatible Harness provenance: ${provenancePath}.`)
  }

  const manifestPath = join(runtime, 'node_modules/@deepseek-ai/dsh/package.json')
  requireInstalledPath(manifestPath, installation, 'file')
  const harnessVersion = readHarnessVersion(manifestPath)
  if (harnessVersion !== BASE_HARNESS_VERSION) {
    throw new Error(`Incompatible Harness version: ${harnessVersion}.`)
  }
  const cli = join(runtime, 'node_modules/@deepseek-ai/dsh/lib/bin.js')
  const patch = join(baseDirectory, 'base.cordis.patch.yml')
  requireInstalledPath(cli, installation, 'file')
  requireInstalledPath(patch, installation, 'file')
  return { kind: 'base', profile: 'desktop-base', cli, patch, harnessVersion }
}
