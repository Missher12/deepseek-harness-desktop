import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(new URL('../apps/desktop/package.json', import.meta.url))

const providers = [
  {
    source: 'dsh-missher-memory',
    managed: '@deepseek-ai/dsh-desktop-managed-memory',
    destination: 'apps/desktop-managed-memory/lib/client.js',
  },
  {
    source: 'dsh-missher-evolution',
    managed: '@deepseek-ai/dsh-desktop-managed-evolution',
    destination: 'apps/desktop-managed-evolution/lib/client.js',
  },
] as const

function clientExport(value: unknown): string {
  if (typeof value === 'string') return value
  if (value !== null && typeof value === 'object' && 'default' in value) {
    const candidate = (value as { default?: unknown }).default
    if (typeof candidate === 'string') return candidate
  }
  throw new Error('Managed provider source has no default ./client export.')
}

export function managedClientSource(source: string, sourceName: string, managedName: string): string {
  const marker = `id: ${JSON.stringify(sourceName)}`
  const occurrences = source.split(marker).length - 1
  if (!source.startsWith('window.__ModuleLoader__.load({') || occurrences !== 1) {
    throw new Error(`Managed provider ${sourceName} has an unexpected client bundle shape.`)
  }
  const rewritten = source
    .replace(marker, `id: ${JSON.stringify(managedName)}`)
    .replace(/\n\/\/# sourceMappingURL=client\.js\.map\s*$/u, '\n')
  return `${rewritten.replace(/^[\t ]+$/gmu, '').trimEnd()}\n`
}

export async function syncDesktopManagedProviders(): Promise<void> {
  for (const provider of providers) {
    const manifestPath = require.resolve(`${provider.source}/package.json`)
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      exports?: Record<string, unknown>
    }
    const relativeClient = clientExport(manifest.exports?.['./client'])
    const source = await readFile(resolve(dirname(manifestPath), relativeClient), 'utf8')
    const destination = resolve(repositoryRoot, provider.destination)
    await writeFile(destination, managedClientSource(source, provider.source, provider.managed), 'utf8')
    console.log(`managed provider client synced: ${provider.managed}`)
  }
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && import.meta.url === pathToFileURL(resolve(invokedPath)).href) {
  await syncDesktopManagedProviders()
}
