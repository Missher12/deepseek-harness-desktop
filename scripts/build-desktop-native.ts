/** Build the native shell against a separately verified official declaration tree. */
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

interface PackageManifest {
  name: string
  types?: string
  exports?: Record<string, unknown>
}

function typeTarget(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const conditions = value as Record<string, unknown>
  if (typeof conditions.types === 'string') return conditions.types
  for (const nested of Object.values(conditions)) {
    const target = typeTarget(nested)
    if (target !== undefined) return target
  }
  return undefined
}

/**
 * Resolve public declaration exports without redirecting any import into fork source.
 * @param directory - one package directory in the verified official build.
 * @param manifest - parsed package identity and exports.
 * @returns TypeScript aliases for its public declaration exports.
 */
export function packageDeclarationAliases(directory: string, manifest: PackageManifest): Record<string, string[]> {
  const aliases: Record<string, string[]> = {}
  const exports = manifest.exports ?? (manifest.types === undefined ? {} : { '.': { types: manifest.types } })
  for (const [key, value] of Object.entries(exports)) {
    const target = typeTarget(value)
    if (target === undefined) continue
    const path = resolve(directory, target)
    const local = relative(directory, path)
    if (isAbsolute(local) || local === '..' || local.startsWith(`..${sep}`)) throw new Error('Official type export escapes its package.')
    if (!target.includes('*') && !existsSync(path)) throw new Error(`Official declaration was not built: ${path}`)
    aliases[key === '.' ? manifest.name : `${manifest.name}/${key.slice(2)}`] = [path]
  }
  return aliases
}

/**
 * Collect declaration exports from the clean official build, including development-only Client types.
 * @param officialSource - source directory already validated against the pinned input receipt.
 * @returns declaration-only aliases; no source-plane import redirects are generated.
 */
export async function officialDeclarationAliases(officialSource: string): Promise<Record<string, string[]>> {
  const directories = [join(officialSource, 'apps/cli'), join(officialSource, 'apps/web'), join(officialSource, 'native/system/packages/entry')]
  for (const group of await readdir(join(officialSource, 'packages'), { withFileTypes: true })) {
    if (!group.isDirectory()) continue
    const parent = join(officialSource, 'packages', group.name)
    for (const entry of await readdir(parent, { withFileTypes: true })) {
      if (entry.isDirectory()) directories.push(join(parent, entry.name))
    }
  }
  for (const entry of await readdir(join(officialSource, 'vendor'), { withFileTypes: true })) {
    if (entry.isDirectory()) directories.push(join(officialSource, 'vendor', entry.name))
  }
  const aliases: Record<string, string[]> = {}
  for (const directory of directories) {
    const path = join(directory, 'package.json')
    if (!existsSync(path)) continue
    const manifest = JSON.parse(await readFile(path, 'utf8')) as PackageManifest
    if (!manifest.name.startsWith('@deepseek-ai/')) continue
    Object.assign(aliases, packageDeclarationAliases(directory, manifest))
  }
  return aliases
}

/** An owned Node process invocation; callers preserve command failure and output. */
export interface NativeBuildCommand {
  cwd: string
  args: string[]
}

/**
 * Emit and build only native shell programs; the official runtime is never rebuilt here.
 * @param repositoryRoot - Desktop source checkout.
 * @param officialSource - separately verified and built official checkout.
 * @param outputDirectory - caller-owned directory for generated compiler configuration and receipts.
 * @param run - executes process.execPath with the supplied arguments, without a shell.
 */
export async function buildDesktopNative(
  repositoryRoot: string, officialSource: string, outputDirectory: string,
  run: (command: NativeBuildCommand) => Promise<void>,
): Promise<void> {
  const root = resolve(repositoryRoot)
  const source = resolve(officialSource)
  const output = resolve(outputDirectory)
  const paths = await officialDeclarationAliases(source)
  const require = createRequire(join(root, 'package.json'))
  const tsc = join(dirname(require.resolve('typescript/package.json')), 'bin/tsc')
  const tsdown = join(dirname(require.resolve('tsdown/package.json')), 'dist/run.mjs')
  await mkdir(output, { recursive: true })
  for (const name of ['ui-desktop-shell', 'ui-settings-system-update', 'main']) {
    const client = name !== 'main'
    const directory = client ? join(root, 'packages/client', name) : join(root, 'apps/desktop')
    const config = join(output, `${name}.official.json`)
    await writeFile(config, `${JSON.stringify({
      compilerOptions: {
        target: 'ES2024', module: client ? 'ESNext' : 'NodeNext', moduleResolution: client ? 'Bundler' : 'NodeNext',
        strict: true, skipLibCheck: true, jsx: 'react-jsx', lib: ['ESNext', 'DOM', 'DOM.Iterable'],
        types: client ? ['client-build-environment'] : ['node'],
        typeRoots: client ? [join(source, 'scripts/types'), join(source, 'node_modules/@types')] : [join(root, 'node_modules/@types')],
        declaration: true, sourceMap: true, rewriteRelativeImportExtensions: true,
        rootDir: join(directory, 'src'), outDir: join(directory, 'lib/types'), paths,
      }, include: [join(directory, 'src')],
    }, null, 2)}\n`)
    await run({ cwd: root, args: [tsc, '-p', config] })
    if (client) {
      const bundleConfig = join(output, `${name}.bundle.ts`)
      await writeFile(bundleConfig, `import { clientBundle } from ${JSON.stringify(pathToFileURL(join(root, 'packages/client/tsdown.client.ts')).href)}\nexport default options => clientBundle(${JSON.stringify(`@deepseek-ai/dsh-client-${name}`)}, ['lib/types/index.js'])(options).map(config => ({ ...config, cwd: ${JSON.stringify(directory)} }))\n`)
      await run({ cwd: directory, args: [tsdown, '--config', bundleConfig] })
    } else {
      await run({ cwd: directory, args: [tsdown, '--config', 'tsdown.config.ts'] })
    }
  }
}
