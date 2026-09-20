/** Build Ubuntu x64 packages through the official preparation stages, without publishing. */
import { spawnSync } from 'node:child_process'
import { createReadStream, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { desktopTargetBuildPaths } from '../apps/desktop/scripts/desktop-build-paths.mjs'

const root = resolve(import.meta.dirname, '..')
const app = join(root, 'apps/desktop')
const paths = desktopTargetBuildPaths('linux-x64')

function run(args, env, cwd = root) {
  const require = createRequire(join(app, 'package.json'))
  const manifestPath = require.resolve('pnpm')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const pnpm = join(dirname(manifestPath), manifest.bin.pnpm)
  const result = spawnSync(process.execPath, [pnpm, ...args], { cwd, env, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Linux packaging stage failed: ${args.join(' ')} (${result.status ?? result.signal})`)
}

async function main() {
  if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('Ubuntu packaging requires a Linux x64 host.')
  if (process.argv.length !== 2) throw new Error('Usage: pnpm exec node desktop-packaging/linux.mjs')
  const env = { ...process.env, DSH_DESKTOP_TARGET_PLATFORM: 'linux', DSH_DESKTOP_TARGET_ARCH: 'x64', CSC_IDENTITY_AUTO_DISCOVERY: 'false' }
  for (const key of Object.keys(env)) {
    if (/^(?:WIN_)?CSC_/u.test(key) && key !== 'CSC_IDENTITY_AUTO_DISCOVERY'
      || key.startsWith('DSH_DESKTOP_WINDOWS_') || /^DOWNLOAD_(?:TEST|PROD)_COS_SECRET_/u.test(key)) delete env[key]
  }
  const version = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8')).version
  if (version !== JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version) throw new Error('Desktop and dsh versions differ.')
  run(['run', 'build:official'], env)
  run(['run', 'release:pack', '--family', 'dsh', '--out', paths.packedDsh], env)
  run(['--dir', 'apps/desktop-host', 'pack', '--pack-destination', paths.packedDsh], env)
  run(['run', 'release:pack', '--family', 'vendor', '--out', paths.packedVendor], env)
  rmSync(paths.packedLandlock, { recursive: true, force: true })
  mkdirSync(paths.packedLandlock, { recursive: true })
  run(['--dir', 'native/system', 'run', 'build:ts'], env)
  run(['--dir', 'native/system/packages/entry', 'pack', '--pack-destination', paths.packedLandlock], env)
  for (const stage of ['prepare:runtime', 'prepare:packages', 'prepare:dsh']) run(['run', stage], env, app)
  run(['exec', 'electron-builder', '--config', join(import.meta.dirname, 'linux-electron-builder.config.mjs'),
    '--linux', 'deb', 'AppImage', '--x64', '--publish', 'never'], env, app)
  const files = readdirSync(paths.artifacts).filter(name => name.endsWith('.deb') || name.endsWith('.AppImage')).sort()
  if (files.length !== 2 || !files.some(name => name.endsWith('.deb')) || !files.some(name => name.endsWith('.AppImage'))) {
    throw new Error('Expected exactly one deb and one AppImage in the target output.')
  }
  const sums = []
  for (const name of files) {
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(join(paths.artifacts, name))) hash.update(chunk)
    sums.push(`${hash.digest('hex')}  ${name}`)
  }
  writeFileSync(join(paths.artifacts, 'SHA256SUMS-linux'), `${sums.join('\n')}\n`)
  console.log(`LINUX_ARTIFACTS ${paths.artifacts}`)
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) await main()
