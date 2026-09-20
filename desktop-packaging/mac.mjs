/** Local Intel Mac packaging; does not use release credentials or publish artifacts. */
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { closeSync, createReadStream, openSync, readFileSync, readSync } from 'node:fs'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { desktopTargetBuildPaths } from '../apps/desktop/scripts/desktop-build-paths.mjs'

const repository = resolve(import.meta.dirname, '..')
const appRoot = join(repository, 'apps/desktop')
const localIcon = join(repository, 'desktop-packaging/icon.png')
const paths = desktopTargetBuildPaths('mac-x64')
const execute = promisify(execFile)
const magics = new Set(['cafebabe', 'cafebabf', 'cefaedfe', 'cffaedfe', 'feedface', 'feedfacf', 'bebafeca', 'bfbafeca'])

/**
 * Apply and verify local ad-hoc signatures before official runtime inventory sealing.
 * @param {string} root Absolute prepared runtime directory.
 * @returns {Promise<void>} Completion after every Mach-O signature is verified.
 */
export async function signAdHocRuntime(root) {
  if (process.platform !== 'darwin' || !isAbsolute(root)) throw new Error('Ad-hoc signing requires an absolute macOS runtime path')
  const { inventoryDesktopRuntime } = await import('../apps/desktop/lib/types/runtime-tree.js')
  let count = 0
  for (const file of inventoryDesktopRuntime(root)) {
    const path = join(root, file.path)
    const fd = openSync(path, 'r')
    const header = Buffer.alloc(4)
    let macho
    try { macho = readSync(fd, header, 0, 4, 0) === 4 && magics.has(header.toString('hex')) }
    finally { closeSync(fd) }
    if (!macho) continue
    const entitlements = file.path === 'dependencies/node/bin/node'
      ? ['--entitlements', join(appRoot, 'scripts/node-entitlements.plist')] : []
    // Ad-hoc code has no Team ID for hardened library validation of its native dependencies.
    await execute('/usr/bin/codesign', ['--force', '--sign', '-', '--timestamp=none', '--options', '0',
      '--identifier', `com.deepseek.harness.local.runtime.${createHash('sha256').update(file.path).digest('hex')}`,
      ...entitlements, path])
    await execute('/usr/bin/codesign', ['--verify', '--strict', path])
    count++
  }
  console.log(`Local ad-hoc runtime: ${count} Mach-O files verified`)
}

/** Build configuration retaining the official payload layout with local-only signing. */
export default function localMacConfig() {
  return {
    appId: 'com.deepseek.harness', productName: 'DeepSeek Harness',
    extraMetadata: { dshDesktopAppId: 'com.deepseek.harness' },
    artifactName: 'deepseek-harness-${version}-mac-x64-local.${ext}',
    directories: { output: join(paths.root, 'local-artifacts') },
    asar: true, electronDist: paths.electron, electronFuses: { runAsNode: true },
    files: ['lib/main.js', 'lib/preload-app.cjs', 'lib/preload-mandatory.cjs', 'lib/preload-update-dialog.cjs',
      'renderer/**/*', 'package.json', { from: paths.dsh, to: 'dsh', filter: ['**/*'] },
      { from: join(paths.dsh, 'node_modules'), to: 'dsh/node_modules', filter: ['**/*'] }],
    asarUnpack: ['**/*.{node,dylib,dll,so,exe}', '**/*.so.*', '**/spawn-helper', '**/@vscode/ripgrep/bin/rg'],
    extraResources: [{ from: paths.runtime, to: 'runtime' }, { from: localIcon, to: 'icon.png' }],
    mac: { icon: localIcon, category: 'public.app-category.developer-tools',
      identity: '-', forceCodeSigning: false, hardenedRuntime: true, notarize: false,
      signIgnore: ['/Contents/Resources/app\\.asar\\.unpacked/dsh(?:/|$)', '/Contents/Resources/runtime/primary-runtime(?:/|$)', '\\.pak$'],
      target: ['dmg'] },
    dmg: { sign: false, writeUpdateInfo: false },
    afterPack: async () => {
      const { verifyDesktopRuntime } = await import('../apps/desktop/lib/types/runtime-tree.js')
      const version = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8')).version
      await verifyDesktopRuntime(paths.dsh, version, { platform: 'darwin', arch: 'x64' })
    },
    publish: null,
  }
}

async function main() {
  if (process.platform !== 'darwin' || process.arch !== 'x64') throw new Error('This entry is for the local Intel Mac only')
  const mode = process.argv[2]
  if (!['prepare', 'package', 'dmg'].includes(mode)) throw new Error('Use: node desktop-packaging/mac.mjs prepare|package|dmg')
  const require = createRequire(join(appRoot, 'package.json'))
  const pnpm = join(dirname(require.resolve('pnpm')), 'bin/pnpm.mjs')
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(?:CSC_|APPLE_|DSH_DESKTOP_MACOS_|DSH_DESKTOP_WINDOWS_)/u.test(key))),
    DSH_DESKTOP_TARGET_PLATFORM: 'darwin', DSH_DESKTOP_TARGET_ARCH: 'x64', DSH_DESKTOP_LOCAL_MAC_ADHOC: '1',
    CSC_IDENTITY_AUTO_DISCOVERY: 'false' }
  const run = async (args, cwd = repository) => {
    console.log(`RUN pnpm ${args.join(' ')}`)
    const { spawn } = await import('node:child_process')
    await new Promise((accept, reject) => {
      const child = spawn(process.execPath, [pnpm, ...args], { cwd, env, stdio: 'inherit' })
      child.once('error', reject)
      child.once('exit', (code, signal) => code === 0 ? accept() : reject(new Error(`pnpm exited ${code ?? signal}`)))
    })
  }
  if (mode === 'prepare') {
    // The caller runs the official build once; preparation consumes its recorded outputs.
    await run(['run', 'release:pack', '--family', 'dsh', '--out', paths.packedDsh])
    await run(['--dir', 'apps/desktop-host', 'pack', '--pack-destination', paths.packedDsh])
    await run(['run', 'release:pack', '--family', 'vendor', '--out', paths.packedVendor])
    await mkdir(paths.packedLandlock, { recursive: true })
    await run(['--dir', 'native/system', 'run', 'build:ts'])
    await run(['--dir', 'native/system/packages/entry', 'pack', '--pack-destination', paths.packedLandlock])
    for (const step of ['prepare:runtime', 'prepare:packages', 'prepare:dsh']) await run(['run', step], appRoot)
  } else {
    const sourceSha = (await execute('git', ['rev-parse', 'HEAD'], { cwd: repository })).stdout.trim()
    if (mode === 'dmg') {
      const status = await execute('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: repository })
      if (status.stdout.trim()) throw new Error('DMG packaging requires a clean final-source checkout')
    }
    const target = mode === 'dmg' ? ['--mac', 'dmg', '--x64'] : ['--mac', '--x64', '--dir']
    await run(['exec', 'electron-builder', '--config', join(repository, 'desktop-packaging/mac.mjs'), ...target, '--publish', 'never'], appRoot)
    const app = join(paths.root, 'local-artifacts/mac/DeepSeek Harness.app')
    await execute('/usr/bin/codesign', ['--verify', '--deep', '--strict', app])
    const signature = await execute('/usr/bin/codesign', ['--display', '--verbose=4', app])
    if (!signature.stderr.includes('Signature=adhoc')) throw new Error('Local app is not ad-hoc signed')
    await writeFile(join(paths.root, 'local-artifacts/local-signature.txt'), signature.stderr)
    console.log(`LOCAL_APP ${app}`)
    if (mode === 'dmg') {
      const version = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8')).version
      const dmg = join(paths.root, `local-artifacts/deepseek-harness-${version}-mac-x64-local.dmg`)
      const digest = createHash('sha256')
      for await (const chunk of createReadStream(dmg)) digest.update(chunk)
      const { stdout } = await execute('git', ['rev-parse', 'HEAD'], { cwd: repository })
      if (stdout.trim() !== sourceSha) throw new Error('Source revision changed during DMG packaging')
      const receipt = { file: dmg, version, sourceSha, bytes: (await stat(dmg)).size,
        sha256: digest.digest('hex'), applicationSignature: 'adhoc', notarized: false }
      await writeFile(join(paths.root, 'local-artifacts/mac-dmg.json'), `${JSON.stringify(receipt, null, 2)}\n`)
      console.log(JSON.stringify(receipt))
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main()
