import { clientBundle } from '../../client/tsdown.client.ts'

const bundle = clientBundle(
  '@deepseek-ai/dsh-reasoning-effort',
  ['lib/types/index.js', 'lib/types/invariant.js'],
  { lib: { copy: [{ from: 'assets/*', to: 'lib/assets' }] } },
)

/** Keep the optional attributed sprite self-contained in the dynamic Client bundle. */
export default (inlineConfig: Parameters<typeof bundle>[0]) => bundle(inlineConfig).map((config) => ({
  ...config,
  loader: { ...config.loader, '.png': 'dataurl' },
}))
