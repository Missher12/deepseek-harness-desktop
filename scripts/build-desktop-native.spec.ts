import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it } from 'vitest'
import { packageDeclarationAliases } from './build-desktop-native.ts'
const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-native-types-')); roots.push(root)
  mkdirSync(join(root, 'lib/types'), { recursive: true }); writeFileSync(join(root, 'lib/types/index.d.ts'), 'export {}\n')
  return root
}
it('uses public declarations and omits the source escape export', () => {
  const root = fixture()
  expect(packageDeclarationAliases(root, { name: '@deepseek-ai/example', exports: {
    '.': { types: './lib/types/index.d.ts', default: './lib/index.js' }, './src/*': './src/*',
  } })).toEqual({ '@deepseek-ai/example': [join(root, 'lib/types/index.d.ts')] })
})
it('rejects an unbuilt declaration and an escaping declaration', () => {
  const root = fixture()
  expect(() => packageDeclarationAliases(root, { name: 'x', types: './lib/missing.d.ts' })).toThrow('not built')
  expect(() => packageDeclarationAliases(root, { name: 'x', types: '../foreign.d.ts' })).toThrow('escapes')
})
