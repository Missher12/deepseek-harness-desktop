import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, copyFile, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createDesktopBaseSmokeDescriptor } from './desktop-base-contract.ts'

const repository = resolve(import.meta.dirname, '..')
const roots: string[] = []
const receipt = '{"fixture":"official input receipt"}\n'
const digest = createHash('sha256').update(receipt).digest('hex')
interface Command { name: string; args: string[]; cwd: string; config?: string; parentConfig?: string }

interface Fixture {
  root: string
  args: string[]
  run: (args: string[], env?: NodeJS.ProcessEnv) => ReturnType<typeof spawnSync>
  commands: () => Promise<Command[]>
}

async function fixture(): Promise<Fixture> {
  const allocated = await mkdtemp(join(tmpdir(), 'dsh Linux base '))
  roots.push(allocated)
  const root = await realpath(allocated)
  for (const directory of ['scripts', 'bin', 'apps/desktop/node_modules/electron-builder', 'official source', 'accepted packages', 'accepted runtime']) {
    await mkdir(join(root, directory), { recursive: true })
  }
  for (const file of ['linux-desktop-package.sh', 'desktop-base-contract.ts']) {
    await copyFile(join(repository, 'scripts', file), join(root, 'scripts', file))
  }
  await symlink(join(repository, 'node_modules'), join(root, 'node_modules'), 'dir')
  await writeFile(join(root, 'package.json'), '{"type":"module"}\n')
  await writeFile(join(root, 'bin/package.json'), '{"type":"commonjs"}\n')
  await writeFile(join(root, 'apps/desktop/package.json'), '{"version":"0.6.0"}\n')
  await writeFile(join(root, 'receipt.json'), receipt)
  await writeFile(join(root, 'audit.json'), receipt)
  await writeFile(join(root, 'commands.jsonl'), '')
  await writeFile(join(root, 'smoke.json'), JSON.stringify(createDesktopBaseSmokeDescriptor('0.6.0', 'linux', [])))
  const prefix = `#!${process.execPath}\nconst fs = require('node:fs'); const path = require('node:path');\nconst args = process.argv.slice(2);\n`
  const record = (name: string): string => `fs.appendFileSync(process.env.COMMAND_LOG, JSON.stringify({name:${JSON.stringify(name)},args,cwd:process.cwd()})+'\\n');\n`
  const doubles = {
    uname: `${prefix}console.log(args[0] === '-s' ? (process.env.FIXTURE_HOST || 'Linux') : 'x86_64');\n`,
    'clang++-15': `${prefix}${record('compiler')}
if (process.env.COMPILER_FAILURE) process.exit(18);
if (args[0] !== '--version') {
  const output = args[args.indexOf('-o') + 1];
  fs.writeFileSync(output, '#!/bin/sh\\nexit 0\\n', {mode:0o755});
}
`,
    pnpm: `${prefix}${record('pnpm')}
if (args[0] === 'run' && args[1] === 'desktop:stage') {
  if (process.env.STAGE_FAILURE) process.exit(19);
  let selected = 'apps/desktop/.stage';
  const index = args.indexOf('--stage');
  if (index >= 0) selected = args[index + 1];
  for (const arg of args) if (arg.startsWith('--stage=')) selected = arg.slice(8);
  fs.mkdirSync(selected, {recursive:true});
  if (!process.env.MISSING_SMOKE) fs.copyFileSync(process.env.SMOKE_INPUT, path.join(selected, 'base-smoke.json'));
  fs.writeFileSync(path.join(selected, 'package.json'), JSON.stringify({version:process.env.STAGED_VERSION || '0.6.0'}));
  fs.writeFileSync(path.join(selected, 'electron-builder.linux.yml'), 'fixture selected config\\n');
  fs.writeFileSync(path.join(selected, 'electron-builder.yml'), 'fixture staged helper-runtime resources\\n');
} else { process.exit(77); }
`,
  }
  for (const [name, body] of Object.entries(doubles)) {
    await writeFile(join(root, 'bin', name), body)
    await chmod(join(root, 'bin', name), 0o755)
  }
  await writeFile(join(root, 'apps/desktop/electron-builder.linux.yml'), 'wrong source config\n')
  await writeFile(join(root, 'apps/desktop/node_modules/electron-builder/package.json'), JSON.stringify({
    name: 'electron-builder', version: '26.15.3', bin: { 'electron-builder': './cli.js' },
  }))
  await writeFile(join(root, 'apps/desktop/node_modules/electron-builder/cli.js'), `${prefix}
const config = fs.readFileSync(args[args.indexOf('--config') + 1], 'utf8');
const parentConfig = fs.readFileSync(path.join(process.cwd(), 'electron-builder.yml'), 'utf8');
fs.appendFileSync(process.env.COMMAND_LOG, JSON.stringify({name:'builder',args,cwd:process.cwd(),config,parentConfig})+'\\n');
if (process.env.PACKAGE_FAILURE) process.exit(20);
`)
  const args = ['--official-source', 'official source', '--packages', 'accepted packages',
    '--descriptor', 'receipt.json', '--runtime', 'accepted runtime', '--descriptor-sha256', digest]
  return {
    root, args,
    run: (argv, env = {}) => spawnSync('bash', [join(root, 'scripts/linux-desktop-package.sh'), ...argv], {
      cwd: root, encoding: 'utf8', timeout: 20_000,
      env: { ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH ?? ''}`, CC: 'clang-15', CXX: 'clang++-15',
        COMMAND_LOG: join(root, 'commands.jsonl'), SMOKE_INPUT: join(root, 'smoke.json'), ...env },
    }),
    commands: async () => (await readFile(join(root, 'commands.jsonl'), 'utf8')).trim().split('\n').filter(Boolean)
      .map(line => JSON.parse(line) as Command),
  }
}

function exited(result: ReturnType<typeof spawnSync>, status: number): void {
  expect(result.error).toBeUndefined()
  expect(result.signal).toBeNull()
  expect(result.status, String(result.stderr)).toBe(status)
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

// These fixtures execute Bash and POSIX executable doubles; Windows has no matching shell semantics.
describe.skipIf(process.platform === 'win32')('Linux base package shell', () => {
  it('forwards literal accepted inputs, validates the selected stage, and retains its release descriptor', async () => {
    const f = await fixture()
    const stage = join(f.root, 'literal $(touch SHOULD_NOT_EXIST); space', 'dsh-desktop-stage')
    const args = [...f.args, '--stage', stage, '--runtime-audit', 'audit.json', '--runtime-audit-sha256', digest,
      '--helper-runtime', 'helper runtime', '--helper-cache', 'helper cache', '--work-dir', 'build work']
    exited(f.run(args), 0)
    const commands = await f.commands()
    expect(commands.filter(command => command.name === 'compiler').map(command => command.args[0])).toEqual(['--version', '-std=c++20'])
    expect(commands.filter(command => command.name === 'pnpm').map(command => command.args)).toEqual([
      ['run', 'desktop:stage', ...args],
    ])
    expect(commands.filter(command => command.name === 'builder')).toEqual([{
      name: 'builder', cwd: stage, config: 'fixture selected config\n', parentConfig: 'fixture staged helper-runtime resources\n',
      args: ['--projectDir', stage, '--config', join(stage, 'electron-builder.linux.yml'),
        `--config.directories.output=${join(f.root, 'apps/desktop/release')}`, '--linux', 'deb', 'AppImage', '--x64', '--publish', 'never'],
    }])
    expect(await readFile(join(f.root, 'apps/desktop/release/base-smoke.json'), 'utf8')).toBe(await readFile(join(stage, 'base-smoke.json'), 'utf8'))
    expect(await readFile(join(stage, 'electron-builder.linux.yml'), 'utf8')).toBe('fixture selected config\n')
    await expect(readFile(join(f.root, 'SHOULD_NOT_EXIST'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(f.root, 'receipt.json'), 'utf8')).toBe(receipt)
  })

  it('forwards one explicit official build and packages the default stage', async () => {
    const f = await fixture()
    const args = ['--official-source', 'official source', '--packages', 'new packages', '--descriptor', 'new receipt.json',
      '--runtime', 'new runtime', '--build-official']
    exited(f.run(args), 0)
    const commands = (await f.commands()).filter(command => command.name === 'pnpm' || command.name === 'builder')
    expect(commands[0]?.args).toEqual(['run', 'desktop:stage', ...args])
    expect(commands[1]?.args).toContain(join(f.root, 'apps/desktop/.stage'))
    expect(commands).toHaveLength(2)
  })

  it('loads the original hook with the real 26.15.3 loader only from its physical stage', async () => {
    const f = await fixture()
    const stage = join(f.root, 'real loader with spaces', 'dsh-desktop-stage')
    const source = join(f.root, 'apps/desktop')
    for (const directory of [source, stage]) {
      await mkdir(join(directory, 'build/linux'), { recursive: true })
      for (const name of ['after-pack.cjs', 'launcher.sh']) {
        await copyFile(join(repository, 'apps/desktop/build/linux', name), join(directory, 'build/linux', name))
      }
    }
    const require = createRequire(join(repository, 'apps/desktop/package.json'))
    const builderManifest = require.resolve('electron-builder/package.json')
    const builder = JSON.parse(await readFile(builderManifest, 'utf8')) as { version: string }
    expect(builder.version).toBe('26.15.3')
    const loader = createRequire(builderManifest).resolve('app-builder-lib/out/util/resolve.js')
    const probe = `
const { resolveFunction } = require(process.argv[1]);
resolveFunction('commonjs', './build/linux/after-pack.cjs', 'afterPack', process.argv[2]).then(hook => {
  if (typeof hook !== 'function' || hook.name !== 'installLinuxLauncher') throw new Error('Original launcher hook was not loaded');
  console.log('original-hook-loaded-without-invocation');
}).catch(error => { console.error(error.message); process.exitCode = 1; });
`
    const run = (cwd: string) => spawnSync(process.execPath, ['--input-type=commonjs', '-e', probe, loader, stage], {
      cwd, encoding: 'utf8', timeout: 10_000, env: { PATH: process.env.PATH },
    })
    const before = await readFile(join(stage, 'build/linux/launcher.sh'))
    const wrong = run(source)
    exited(wrong, 1)
    expect(wrong.stderr).toContain('resolves outside the workspace root')
    const correct = run(stage)
    exited(correct, 0)
    expect(correct.stdout.trim()).toBe('original-hook-loaded-without-invocation')
    expect(await readFile(join(stage, 'build/linux/launcher.sh'))).toEqual(before)
    await rm(join(stage, 'build/linux/after-pack.cjs'))
    await symlink(join(source, 'build/linux/after-pack.cjs'), join(stage, 'build/linux/after-pack.cjs'))
    const escaped = run(stage)
    exited(escaped, 1)
    expect(escaped.stderr).toContain('resolves outside the workspace root')
  })

  it.each([
    { name: 'missing source', args: [] },
    { name: 'missing packages', args: ['--official-source', 'official source'] },
    { name: 'missing explicit mode', extra: [], dropMode: true },
    { name: 'both modes', extra: ['--build-official'] },
    { name: 'bad digest', extra: ['--descriptor-sha256', 'bad'], dropMode: true },
    { name: 'different digest', extra: ['--descriptor-sha256', '0'.repeat(64)], dropMode: true },
    { name: 'unknown option', extra: ['--full'] },
    { name: 'duplicate option', extra: ['--runtime', 'another'] },
    { name: 'empty path', extra: ['--stage', ''] },
    { name: 'wrong stage name', extra: ['--stage', 'unrelated-output'] },
    { name: 'incomplete audit', extra: ['--runtime-audit', 'audit.json'] },
    { name: 'orphan audit digest', extra: ['--runtime-audit-sha256', digest] },
    { name: 'existing build output', extra: ['--build-official'], dropMode: true },
  ])('rejects $name before any compiler or build command', async (scenario) => {
    const f = await fixture()
    const args = scenario.args ?? [...(scenario.dropMode ? f.args.slice(0, -2) : f.args), ...(scenario.extra ?? [])]
    const result = f.run(args)
    expect(result.error).toBeUndefined()
    expect(result.signal).toBeNull()
    expect(result.status).not.toBe(0)
    expect(await f.commands()).toEqual([])
  })

  it('preserves an existing stage without starting preparation', async () => {
    const f = await fixture()
    const stage = join(f.root, 'apps/desktop/.stage')
    await mkdir(stage)
    await writeFile(join(stage, 'keep'), 'accepted stage')
    exited(f.run(f.args), 1)
    expect(await f.commands()).toEqual([])
    expect(await readFile(join(stage, 'keep'), 'utf8')).toBe('accepted stage')
  })

  it.each(['missing', 'malformed', 'reduced', 'other-platform', 'other-version', 'staged-version'])('refuses %s stage evidence before packaging', async (kind) => {
    const f = await fixture()
    const smoke = createDesktopBaseSmokeDescriptor(kind === 'other-version' ? '0.5.9' : '0.6.0', kind === 'other-platform' ? 'darwin' : 'linux', [])
    if (kind === 'reduced') smoke.requiredPaths = []
    await writeFile(join(f.root, 'smoke.json'), kind === 'malformed' ? '{' : JSON.stringify(smoke))
    const result = f.run(f.args, { ...(kind === 'missing' ? { MISSING_SMOKE: '1' } : {}),
      ...(kind === 'staged-version' ? { STAGED_VERSION: '0.5.9' } : {}) })
    exited(result, 1)
    expect((await f.commands()).filter(command => command.name === 'pnpm').map(command => command.args)).toEqual([
      ['run', 'desktop:stage', ...f.args],
    ])
    await expect(readFile(join(f.root, 'apps/desktop/release/base-smoke.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each([
    { env: { FIXTURE_HOST: 'Darwin' }, status: 1, pnpmCalls: 0 },
    { env: { COMPILER_FAILURE: '1' }, status: 18, pnpmCalls: 0 },
    { env: { STAGE_FAILURE: '1' }, status: 19, pnpmCalls: 1 },
    { env: { PACKAGE_FAILURE: '1' }, status: 20, pnpmCalls: 2 },
  ])('propagates failure without another build ($status / $pnpmCalls)', async ({ env, status, pnpmCalls }) => {
    const f = await fixture()
    exited(f.run(f.args, env), status)
    expect((await f.commands()).filter(command => command.name === 'pnpm' || command.name === 'builder')).toHaveLength(pnpmCalls)
    await expect(readFile(join(f.root, 'apps/desktop/release/base-smoke.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

// Execute the production Bash function with bounded command doubles; no installer or native app runs here.
describe.skipIf(process.platform === 'win32')('Linux base native driver gates', () => {
  it.each(['missing', 'malformed', 'wrong-platform', 'old-linux-055', 'development-stage'] as const)(
    'rejects %s descriptor before invoking a system mutation', async (kind) => {
      const f = await fixture()
      await copyFile(join(repository, 'scripts/linux-desktop-native-smoke.sh'), join(f.root, 'scripts/linux-desktop-native-smoke.sh'))
      await mkdir(join(f.root, 'apps/desktop/release'), { recursive: true })
      const descriptorPath = join(f.root, 'apps/desktop/release/base-smoke.json')
      const descriptor = createDesktopBaseSmokeDescriptor('0.6.0', kind === 'wrong-platform' ? 'darwin' : 'linux', [])
      if (kind === 'old-linux-055') Object.assign(descriptor.baseline, { desktopVersion: '0.5.5', sourceSha: 'c0b92b1fcc5a6481eb219a8b5e5510980e99bf78' })
      await writeFile(descriptorPath, kind === 'malformed' ? '{' : JSON.stringify(descriptor))
      const prefix = `#!${process.execPath}\nconst fs = require('node:fs');\n`
      await writeFile(join(f.root, 'bin/git'), `${prefix}console.log('1'.repeat(40));\n`, { mode: 0o755 })
      for (const command of ['sudo', 'dpkg-deb', 'curl']) {
        await writeFile(join(f.root, 'bin', command), `${prefix}fs.appendFileSync(process.env.COMMAND_LOG, JSON.stringify({name:'system-mutation',args:process.argv.slice(2)})+'\\n'); process.exit(99);\n`, { mode: 0o755 })
      }
      const result = spawnSync('bash', [join(f.root, 'scripts/linux-desktop-native-smoke.sh')], {
        cwd: f.root, encoding: 'utf8', timeout: 20_000,
        env: { ...process.env, PATH: `${join(f.root, 'bin')}:${process.env.PATH ?? ''}`, GITHUB_ACTIONS: 'true',
          CANDIDATE_SHA: '1'.repeat(40), RUNNER_TEMP: join(f.root, 'runner'), COMMAND_LOG: join(f.root, 'commands.jsonl'),
          DSH_DESKTOP_SMOKE_DESCRIPTOR: kind === 'missing' ? '' : descriptorPath,
          ...(kind === 'development-stage' ? { DSH_DESKTOP_SMOKE_STAGE: join(f.root, 'development') } : {}),
        },
      })
      expect(result.error).toBeUndefined(); expect(result.signal).toBeNull(); expect(result.status).not.toBe(0)
      expect(result.stderr).toMatch(/base|Linux|JSON/u)
      if (kind === 'development-stage') expect(result.stderr).toContain('Formal Linux base acceptance forbids a development stage')
      expect(await f.commands()).toEqual([])
    },
  )

  it.each(['partial', 'missing', 'passed'] as const)('propagates the shared verifier for a %s receipt before any uninstall step', async (outcome) => {
    const f = await fixture()
    const driver = await readFile(join(repository, 'scripts/linux-desktop-native-smoke.sh'), 'utf8')
    const runChecks = /^run_linux_native_checks\(\) \{\n[\s\S]*?^\}/mu.exec(driver)?.[0]
    if (runChecks === undefined) throw new Error('Native driver check function is absent')
    const root = join(f.root, 'native-smoke'), evidence = join(f.root, 'evidence')
    await mkdir(root); await mkdir(evidence)
    if (outcome !== 'missing') await writeFile(join(root, 'base-smoke-receipt.json'), JSON.stringify({ outcome }))
    await writeFile(join(f.root, 'bin/node'), `#!${process.execPath}
const fs = require('node:fs'), path = require('node:path');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.COMMAND_LOG, JSON.stringify({name:'node',args})+'\\n');
if (args.includes('scripts/verify-desktop-base-smoke.ts')) {
  const receipt = args[args.indexOf('--receipt') + 1];
  if (!fs.existsSync(receipt) || JSON.parse(fs.readFileSync(receipt)).outcome !== 'passed') process.exit(23);
}
`, { mode: 0o755 })
    const script = join(f.root, 'check-native-receipt.sh')
    await writeFile(script, `set -euo pipefail\n${runChecks}\nrun_linux_native_checks\nprintf 'uninstall-reached' > after-verification\n`)
    const result = spawnSync('bash', [script], {
      cwd: f.root, encoding: 'utf8', timeout: 20_000,
      env: { ...process.env, PATH: `${join(f.root, 'bin')}:${process.env.PATH ?? ''}`, COMMAND_LOG: join(f.root, 'commands.jsonl'),
        DSH_DESKTOP_SMOKE_ROOT: root, DSH_DESKTOP_SMOKE_DESCRIPTOR: join(f.root, 'smoke.json'), DSH_LINUX_EVIDENCE_ROOT: evidence },
    })
    exited(result, outcome === 'passed' ? 0 : 23)
    expect((await f.commands()).filter(command => command.args.includes('scripts/verify-desktop-base-smoke.ts'))).toHaveLength(1)
    if (outcome === 'passed') {
      expect(await readFile(join(f.root, 'after-verification'), 'utf8')).toBe('uninstall-reached')
      expect(JSON.parse(await readFile(join(evidence, 'base-smoke-receipt.json'), 'utf8'))).toEqual({ outcome: 'passed' })
    } else {
      await expect(readFile(join(f.root, 'after-verification'))).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(readFile(join(evidence, 'base-smoke-receipt.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    }
  })
})
