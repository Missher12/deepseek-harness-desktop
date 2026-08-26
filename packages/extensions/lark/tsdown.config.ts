import { clientBundle } from '../../client/tsdown.client.ts'
import { sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { UserConfig } from 'tsdown'

const packageRoot = fileURLToPath(new URL('.', import.meta.url))
const buildPathMarkers = [...new Set([packageRoot, packageRoot.split(sep).join('/')])]
const stablePackagePath = 'packages/extensions/lark/'

const releasePathSanitizer = {
  name: 'dsh-lark-release-path-sanitizer',
  generateBundle(_options, bundle) {
    for (const output of Object.values(bundle)) {
      if (output.type !== 'chunk') continue
      for (const marker of buildPathMarkers) {
        output.code = output.code.replaceAll(marker, stablePackagePath)
      }
    }
  },
} satisfies NonNullable<UserConfig['plugins']>[number]

const packageBuild = clientBundle('@deepseek-ai/dsh-lark', [
  'lib/types/index.js',
  'lib/types/invariant.js',
], {
  lib: { shims: true },
})

export default (inlineConfig: Pick<UserConfig, 'env'>): UserConfig[] =>
  packageBuild(inlineConfig).map((config) => {
    if (config.name !== '@deepseek-ai/dsh-lark/client') return config
    return {
      ...config,
      plugins: [...(config.plugins ?? []), releasePathSanitizer],
    }
  })
