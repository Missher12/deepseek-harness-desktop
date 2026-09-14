/** Fixed installed-layout and native-smoke requirements for the base Desktop composition. */
const CORE_ROOT = 'resources/app.asar.unpacked/official-runtime/node_modules'
const OFFICIAL_SHA = 'fb2c4b9e698e30edb738bca4cf0618587db7d203'
/** Only released commit identities are valid migration baselines; annotated tag objects are not source commits. */
export interface DesktopBaseLegacyBaseline {
  desktopVersion: '0.5.5' | '0.5.7'
  harnessVersion: '0.1.3-alpha.1'
  sourceSha: string
}

/** Published Linux 0.5.7 bytes used by the native old-fixture producer. */
export const DESKTOP_BASE_LINUX_LEGACY_ASSETS = [
  { bytes: 190958299, sha256: '397008b717181c1f5231d3ba69158f1a5e8fcaf47be7f34e9494ce036e0bb01a' },
  { bytes: 146340244, sha256: 'e9b432dd29dad775bae4a7b3ba7b056732a2637c64818d119211941d9a535cb7' },
] as const

/**
 * Select the only released old baseline for a native platform.
 * @param platform Native Desktop platform.
 * @returns Fixed Desktop/Harness versions and the source commit, never an annotated tag object.
 */
export function desktopBaseLegacyBaseline(platform: string): DesktopBaseLegacyBaseline {
  if (platform === 'linux') return { desktopVersion: '0.5.7', harnessVersion: '0.1.3-alpha.1',
    sourceSha: '7f544cd31c43f239c09c3a209ae0d05fe677c710' }
  if (platform === 'darwin' || platform === 'win32') return { desktopVersion: '0.5.5', harnessVersion: '0.1.3-alpha.1',
    sourceSha: 'c0b92b1fcc5a6481eb219a8b5e5510980e99bf78' }
  throw new Error('Unsupported historical Desktop platform.')
}
const REQUIRED_PACKAGES = [
  '@deepseek-ai/dsh', '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-web-frontend',
  '@deepseek-ai/dsh-session-persistence-jsonl', '@deepseek-ai/dsh-subprocess-local', '@deepseek-ai/dsh-win32-process',
  '@deepseek-ai/dsh-client-ui-desktop-shell', '@deepseek-ai/dsh-client-ui-settings-system-update', 'node-pty', 'koffi',
] as const

/** Descriptor shared by staging, inventory and native platform drivers. */
export interface DesktopBaseSmokeDescriptor {
  schema: 1
  composition: 'base'
  desktopVersion: string
  harnessVersion: '0.1.5-rc.2'
  officialSourceSha: string
  platform: 'darwin' | 'win32' | 'linux'
  arch: 'x64'
  coreRoot: string
  canonicalProfile: 'web'
  effectiveProfile: 'desktop-base'
  baseline: DesktopBaseLegacyBaseline
  requiredPackages: string[]
  requiredPaths: string[]
}

/**
 * State actual required runtime paths without requiring retired enhancement assets.
 * @param desktopVersion - source Desktop manifest version.
 * @param platform - native packaging target.
 * @param dependencyNames - official CLI's dependency closure roots, not the old full Desktop manifest.
 * @returns nonempty requirements for installed app and smoke validation.
 */
export function createDesktopBaseSmokeDescriptor(
  desktopVersion: string, platform: DesktopBaseSmokeDescriptor['platform'], dependencyNames: readonly string[],
): DesktopBaseSmokeDescriptor {
  return {
    schema: 1, composition: 'base', desktopVersion, harnessVersion: '0.1.5-rc.2', officialSourceSha: OFFICIAL_SHA,
    platform, arch: 'x64', coreRoot: CORE_ROOT, canonicalProfile: 'web', effectiveProfile: 'desktop-base',
    baseline: desktopBaseLegacyBaseline(platform),
    requiredPackages: [...new Set([...REQUIRED_PACKAGES, ...dependencyNames])].sort(),
    requiredPaths: [
      'resources/app.asar', 'resources/app.asar.unpacked/desktop-composition.json',
      'resources/app.asar.unpacked/base.cordis.patch.yml', 'resources/app.asar.unpacked/official-runtime/provenance.json',
      `${CORE_ROOT}/@deepseek-ai/dsh/lib/bin.js`, `${CORE_ROOT}/@deepseek-ai/dsh-web-frontend/dist/index.html`,
      `${CORE_ROOT}/@deepseek-ai/dsh-session-persistence-jsonl/lib/worker.cjs`,
      `${CORE_ROOT}/@deepseek-ai/dsh-subprocess-local/lib/runner.js`,
      `${CORE_ROOT}/@deepseek-ai/dsh-subprocess-local/scripts/ensure-spawn-helper.mjs`,
      `${CORE_ROOT}/@deepseek-ai/dsh-client-ui-desktop-shell/lib/client.js`,
      `${CORE_ROOT}/@deepseek-ai/dsh-client-ui-settings-system-update/lib/client.js`,
      'resources/desktop-helper/source.json', 'resources/desktop-helper/LICENSE',
      `resources/desktop-helper/${platform === 'win32' ? 'node.exe' : 'node'}`,
    ],
  }
}

/**
 * Reject malformed or reduced descriptors at the inventory/native-test file boundary.
 * @param value - parsed JSON descriptor.
 * @returns validated fixed-layout descriptor.
 */
export function validateDesktopBaseSmokeDescriptor(value: unknown): DesktopBaseSmokeDescriptor {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid base smoke descriptor.')
  const source = value as Record<string, unknown>
  if (typeof source.desktopVersion !== 'string' || !/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/iu.test(source.desktopVersion)
    || (source.platform !== 'darwin' && source.platform !== 'win32' && source.platform !== 'linux')
    || !Array.isArray(source.requiredPackages) || source.requiredPackages.length === 0
    || source.requiredPackages.some(name => typeof name !== 'string' || !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/iu.test(name))) {
    throw new Error('Invalid base smoke identity or required packages.')
  }
  const expected = createDesktopBaseSmokeDescriptor(source.desktopVersion, source.platform, source.requiredPackages as string[])
  if (JSON.stringify(Object.keys(source).sort()) !== JSON.stringify(Object.keys(expected).sort())
    || Object.entries(expected).some(([key, expectedValue]) => JSON.stringify(source[key]) !== JSON.stringify(expectedValue))) {
    throw new Error('Base smoke descriptor differs from the required runtime or historical baseline.')
  }
  return value as DesktopBaseSmokeDescriptor
}
