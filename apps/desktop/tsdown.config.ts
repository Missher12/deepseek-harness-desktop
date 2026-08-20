import { defineConfig } from 'tsdown'

/** Bundle the ESM main process and sandbox-compatible CommonJS preload separately. */
export default defineConfig([
  {
    entry: ['lib/types/main.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    deps: {
      neverBundle: [
        'electron',
        '@deepseek-ai/dsh-atomic-write',
        '@deepseek-ai/dsh-home-paths',
      ],
    },
  },
  {
    // Sandboxed Electron preload scripts are loaded through CommonJS. Bundle
    // the narrow bridge and its validators into the one physical .cjs file.
    entry: { preload: 'lib/types/preload.js' },
    outDir: 'lib',
    format: ['cjs'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    deps: { neverBundle: ['electron'] },
  },
  {
    // Detached, shell-free updater copied beside the verified DMG before quit.
    entry: { 'update-helper': 'lib/types/update/update-helper.js' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
])
