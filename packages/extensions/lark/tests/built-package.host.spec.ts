import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const builtBundle = fileURLToPath(new URL('../lib/index.js', import.meta.url))
const packageRoot = fileURLToPath(new URL('..', import.meta.url))

describe.skipIf(!existsSync(builtBundle))('Lark built package', () => {
  it('shims CommonJS directory globals used by the bundled Lark SDK', async () => {
    const source = await readFile(builtBundle, 'utf8')
    const declaration = source.indexOf('var getFilename, getDirname, __dirname;')
    const initialization = source.indexOf('__dirname = /* @__PURE__ */ getDirname();')
    const firstSdkUse = source.indexOf('resolve(__dirname,')

    expect(source).toContain('getFilename = () => fileURLToPath(import.meta.url);')
    expect(source).toContain('import { resolveOrdinaryTargetForSource } from "@deepseek-ai/dsh-session-messenger";')
    expect(source).not.toContain('import { resolveOrdinarySession } from "@deepseek-ai/dsh-session-messenger";')
    expect(declaration).toBeGreaterThanOrEqual(0)
    expect(initialization).toBeGreaterThan(declaration)
    expect(firstSdkUse).toBeGreaterThan(initialization)
  })

  it('does not expose the local package path in the published client bundle', async () => {
    const source = await readFile(fileURLToPath(new URL('../lib/client.js', import.meta.url)), 'utf8')

    expect(source).not.toContain(packageRoot)
    expect(source).not.toContain(packageRoot.split(sep).join('/'))
  })
})
