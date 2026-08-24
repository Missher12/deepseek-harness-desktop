import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

async function loadProvider() {
  try {
    return await import('dsh-missher-memory')
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ERR_MODULE_NOT_FOUND') throw error
    const require = createRequire(new URL('../../desktop/package.json', import.meta.url))
    const manifestPath = require.resolve('dsh-missher-memory/package.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    return await import(pathToFileURL(resolve(dirname(manifestPath), manifest.exports['.'].import)).href)
  }
}

const provider = await loadProvider()

export const Config = provider.Config
export const apply = provider.apply
export const inject = provider.inject
export const name = provider.name
export default provider.default
