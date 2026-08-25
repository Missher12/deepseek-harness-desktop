import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const builtBundle = fileURLToPath(new URL('../lib/index.js', import.meta.url))

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
})
