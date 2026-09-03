import { clientBundle } from '../../client/tsdown.client.ts'
import { fileURLToPath } from 'node:url'

const spritePath = fileURLToPath(new URL('./assets/chibi-runner-strip.png', import.meta.url))

const bundle = clientBundle(
  '@deepseek-ai/dsh-reasoning-effort',
  ['lib/types/index.js'],
  { lib: { copy: [{ from: 'assets/*', to: 'lib/assets' }] } },
)

/** Keep the optional attributed sprite self-contained in the dynamic Client bundle. */
export default (inlineConfig: Parameters<typeof bundle>[0]) => bundle(inlineConfig).map((config) => ({
  ...config,
  loader: { ...config.loader, '.png': 'dataurl' },
  plugins: [
    ...(config.plugins ?? []),
    {
      name: 'dsh-reasoning-effort-sprite-source',
      resolveId(source: string) {
        return source === '../../assets/chibi-runner-strip.png' ? spritePath : null
      },
    },
  ],
}))
