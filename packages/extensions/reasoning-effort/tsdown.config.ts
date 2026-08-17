import { clientBundle } from '../../client/tsdown.client.ts'

export default clientBundle(
  '@deepseek-ai/dsh-reasoning-effort',
  ['lib/types/index.js', 'lib/types/invariant.js'],
  { lib: { copy: [{ from: 'assets/*', to: 'lib/assets' }] } },
)
