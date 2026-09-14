import { chmod, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { statSync, type Stats } from 'node:fs'
import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { JSON_SCHEMA, load } from 'js-yaml'
import { prepareWindowsBuilderContext, prepareWindowsBuilderInvocation, runWindowsBuilder } from './windows-desktop-builder.ts'

const execFileAsync = promisify(execFile)
const desktop = resolve(import.meta.dirname, '../apps/desktop')
const reqDesktop = createRequire(join(desktop, 'package.json'))
const reqBuilder = createRequire(reqDesktop.resolve('electron-builder'))
const reqApp = createRequire(reqBuilder.resolve('app-builder-lib'))
const testEnv: NodeJS.ProcessEnv = { PATH: process.env.PATH ?? process.env.Path ?? '',
  PATHEXT: process.env.PATHEXT, SystemRoot: process.env.SystemRoot }

interface FilePatterns { files?: Array<string | { from?: string; to?: string; filter?: string[] }> }
const { getConfig } = reqApp('./util/config/config.js') as {
  getConfig: (stage: string, config: string) => Promise<FilePatterns & { win: FilePatterns }>
}
const { getMainFileMatchers } = reqApp('./fileMatcher.js') as {
  getMainFileMatchers: (stage: string, destination: string, expand: (pattern: string) => string,
    windows: FilePatterns, packager: { info: Record<string, unknown> }, out: string, compile: boolean,
  ) => Array<{ createFilter(): (file: string, stat: Stats) => boolean }>
}

describe.each(['node_modules', 'official-runtime/node_modules', 'official-runtime/node_modules/.pnpm/fixture/node_modules'])('Windows packaged %s', (modules) => {
  async function retained(paths: string[]): Promise<string[]> {
    let result: string[] = []
    await fixture(async (_entry, stage) => {
      const configPath = join(stage, 'electron-builder.yml')
      await writeFile(configPath, await readFile(join(desktop, 'electron-builder.yml')))
      await writeFile(join(stage, 'package.json'), '{"name":"fixture","version":"1.0.0"}')
      const invocation = await prepareWindowsBuilderInvocation(['--projectDir', stage, '--config', configPath, '--win', 'nsis', '--x64'], desktop, testEnv)
      const config = await getConfig(stage, invocation.argv[3]!)
      const matchers = getMainFileMatchers(stage, join(stage, 'out'), pattern => pattern, config.win,
        { info: { projectDir: stage, buildResourcesDir: 'build', config, debugLogger: { isEnabled: false } } },
        join(stage, 'out'), false)
      expect(matchers).toHaveLength(1)
      const filter = matchers[0]!.createFilter()
      const fileStat = statSync(join(stage, 'package.json'))
      result = paths.filter(path => filter(join(stage, modules, 'node-pty', path), fileStat))
    })
    return result
  }

  it('excludes the 14 native and debug files rejected by the Windows inventory', async () => {
    expect(await retained([
      'prebuilds/darwin-arm64/pty.node',
      'prebuilds/darwin-arm64/spawn-helper',
      'prebuilds/darwin-x64/pty.node',
      'prebuilds/darwin-x64/spawn-helper',
      'prebuilds/linux-arm64/pty.node',
      'prebuilds/linux-x64/pty.node',
      'prebuilds/win32-arm64/conpty_console_list.node',
      'prebuilds/win32-arm64/conpty_console_list.pdb',
      'prebuilds/win32-arm64/conpty.node',
      'prebuilds/win32-arm64/conpty.pdb',
      'prebuilds/win32-arm64/conpty/conpty.dll',
      'prebuilds/win32-arm64/conpty/OpenConsole.exe',
      'prebuilds/win32-x64/conpty_console_list.pdb',
      'prebuilds/win32-x64/conpty.pdb',
    ])).toEqual([])
  })

  it('retains x64 native payloads, the console helper, JavaScript and license', async () => {
    const required = [
      'prebuilds/win32-x64/conpty_console_list.node',
      'prebuilds/win32-x64/conpty.node',
      'prebuilds/win32-x64/conpty/conpty.dll',
      'prebuilds/win32-x64/conpty/OpenConsole.exe',
      'lib/index.js',
      'lib/windowsPtyAgent.js',
      'package.json',
      'LICENSE',
    ]
    expect(await retained(required)).toEqual(required)
  })
})

async function fixture(run: (entry: string, stage: string) => Promise<void>): Promise<void> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'windows-builder-context-')))
  const entry = join(root, 'filtered parent'), stage = join(root, 'physical stage')
  await mkdir(entry); await mkdir(stage)
  try { await run(entry, stage) } finally { await rm(root, { recursive: true, force: true }) }
}

describe('Windows builder execution context', () => {
  it.each(['pack:win-dir', 'pack:setup'])('routes the public %s script through the derived configuration with relative paths', async (name) => {
    const manifest = JSON.parse(await readFile(join(desktop, 'package.json'), 'utf8')) as { scripts: Record<string, string> }
    const [executable, entrypoint, ...args] = manifest.scripts[name]!.split(' ')
    expect(executable).toBe('node')
    expect(resolve(desktop, entrypoint!)).toBe(resolve(import.meta.dirname, 'windows-desktop-builder.ts'))
    await fixture(async (entry) => {
      const stage = join(entry, '.stage')
      await mkdir(stage)
      await symlink(await realpath(join(desktop, 'node_modules')), join(entry, 'node_modules'), 'junction')
      const configPath = join(stage, 'electron-builder.yml')
      const original = await readFile(join(desktop, 'electron-builder.yml'))
      await writeFile(configPath, original)
      const invocation = await prepareWindowsBuilderInvocation(args, entry, testEnv)
      expect(invocation.cwd).toBe(stage)
      expect(invocation.argv).toEqual(['--projectDir', stage, '--config', join(stage, 'electron-builder.windows-derived.json'),
        '--win', name === 'pack:setup' ? 'nsis' : 'dir', '--x64'])
      expect(await readFile(configPath)).toEqual(original)
      const derived = JSON.parse(await readFile(invocation.argv[3]!, 'utf8')) as { files: unknown[]; win: { files?: unknown } }
      expect(derived.files).toHaveLength(1)
      expect(derived.win.files).toBeUndefined()
    })
  })
  it('resolves projectDir from the entering cwd and config from that project directory', async () => {
    await fixture(async (entry) => {
      const stage = join(entry, 'stage with spaces')
      await mkdir(stage)
      await symlink(await realpath(join(desktop, 'node_modules')), join(entry, 'node_modules'), 'junction')
      await writeFile(join(stage, 'electron-builder.yml'), await readFile(join(desktop, 'electron-builder.yml')))
      const plan = await prepareWindowsBuilderInvocation(['--projectDir', 'stage with spaces', '--config', 'electron-builder.yml', '--win', 'dir', '--x64'], entry, testEnv)
      expect(plan.cwd).toBe(stage)
      expect(plan.argv.slice(0, 4)).toEqual(['--projectDir', stage, '--config', join(stage, 'electron-builder.windows-derived.json')])
    })
  })
  it('enters the Node wrapper inside filtered pnpm exec and forwards the stage and NSIS argv', async () => {
    const workflow = load(await readFile(new URL('../.github/workflows/windows-desktop.yml', import.meta.url), 'utf8'), {
      schema: JSON_SCHEMA,
    }) as { jobs: { 'build-install-smoke': { steps: { name?: string; run?: string }[] } } }
    const build = workflow.jobs['build-install-smoke'].steps.find(step => step.name === 'Build the assisted Windows Setup')?.run ?? ''
    expect(build).toContain("GetFullPath('scripts/windows-desktop-builder.ts')")
    expect(build).toContain('pnpm --filter @deepseek-ai/dsh-desktop exec node $builderEntry --projectDir')
    expect(build).toContain('--win nsis --x64')
    expect(build).not.toContain('exec electron-builder')
  })
  it('anchors relative and empty PATH entries while preserving absolute paths, spaces and other pnpm context', async () => {
    await fixture(async (entry, stage) => {
      const absolute = join(entry, 'absolute space', 'bin')
      const env = { Path: ['node_modules/.bin', absolute, ''].join(delimiter), PNPM_PACKAGE_NAME: '@deepseek-ai/dsh-desktop' }
      const context = await prepareWindowsBuilderContext(stage, entry, env)
      expect(context.cwd).toBe(stage)
      expect(context.env.Path).toBe([join(entry, 'node_modules/.bin'), absolute, entry].join(delimiter))
      expect(context.env.PNPM_PACKAGE_NAME).toBe(env.PNPM_PACKAGE_NAME)
      expect(env.Path).toBe(['node_modules/.bin', absolute, ''].join(delimiter))
    })
  })
  it('keeps the actual which-selected package manager file after entering an external stage', async () => {
    await fixture(async (entry, stage) => {
      const relativeBin = join(entry, 'node_modules/.bin'), fallback = join(entry, 'fallback')
      await mkdir(relativeBin, { recursive: true }); await mkdir(fallback)
      const name = process.platform === 'win32' ? 'pnpm.CMD' : 'pnpm'
      for (const directory of [relativeBin, fallback]) { await writeFile(join(directory, name), 'inert command identity fixture'); await chmod(join(directory, name), 0o755) }
      const env = { ...testEnv, PATH: ['node_modules/.bin', fallback].join(delimiter) }
      const context = await prepareWindowsBuilderContext(stage, entry, env)
      const code = 'console.log(require("node:fs").realpathSync(require(' + JSON.stringify(reqApp.resolve('which')) + ').sync("pnpm")))'
      const before = await execFileAsync(process.execPath, ['-e', code], { cwd: entry, env })
      const after = await execFileAsync(process.execPath, ['-e', code], context)
      expect(before.stdout.trim()).toBe(await realpath(join(relativeBin, name)))
      expect(after.stdout).toBe(before.stdout)
    })
  })
  it('uses the installed public builder CLI and preserves every builder argument', async () => {
    await fixture(async (_entry, stage) => {
      const args = ['--projectDir', stage, '--config', join(stage, 'electron-builder.yml'), '--win', 'nsis', '--x64', '--config.foo', 'space & ; $ value']
      const original = await readFile(join(desktop, 'electron-builder.yml'))
      await writeFile(args[3]!, original)
      const plan = await prepareWindowsBuilderInvocation(args, desktop, testEnv)
      const packagePath = reqDesktop.resolve('electron-builder/package.json')
      const manifest = JSON.parse(await readFile(packagePath, 'utf8')) as { bin: { 'electron-builder': string } }
      expect(plan.cli).toBe(await realpath(resolve(packagePath, '..', manifest.bin['electron-builder'])))
      expect(plan.argv).toEqual(args.map((value, index) => index === 3 ? join(stage, 'electron-builder.windows-derived.json') : value))
      expect(await readFile(args[3]!)).toEqual(original)
      const before = load(original.toString(), { schema: JSON_SCHEMA }) as Record<string, unknown>
      const after = JSON.parse(await readFile(plan.argv[3]!, 'utf8')) as Record<string, unknown>
      expect(after).toEqual({ ...before,
        files: [{ from: '.', to: '.', filter: [...(before.files as string[]).flatMap(pattern => pattern === 'node_modules/**'
          ? [pattern, 'official-runtime/node_modules/**'] : [pattern]), ...(before.win as { files: string[] }).files.flatMap(pattern =>
          pattern.startsWith('!official-runtime/node_modules/node-pty/')
            ? [pattern, pattern.replace('!official-runtime/node_modules/node-pty/', '!official-runtime/node_modules/**/node-pty/')] : [pattern]), '!electron-builder.windows-derived.json'] }],
        win: Object.fromEntries(Object.entries(before.win as Record<string, unknown>).filter(([key]) => key !== 'files')),
      })
      expect(plan.cwd).toBe(stage)
    })
  })
  it('preserves argv, cwd and nonzero child exit without a shell', async () => {
    await fixture(async (entry, stage) => {
      const cli = join(entry, 'observe.mjs'), output = join(stage, 'observed.json')
      await writeFile(cli, 'import fs from "node:fs";fs.writeFileSync(process.argv[2],JSON.stringify({argv:process.argv.slice(3),cwd:process.cwd()}));process.exit(17);')
      const args = [output, '--projectDir', stage, 'space & ; $ value']
      expect(await runWindowsBuilder({ cli, argv: args, cwd: stage, env: testEnv })).toBe(17)
      expect(JSON.parse(await readFile(output, 'utf8'))).toEqual({ argv: args.slice(1), cwd: stage })
    })
  })
  it('retains the excluded derived receipt without overwriting either configuration', async () => {
    await fixture(async (_entry, stage) => {
      const source = join(stage, 'electron-builder.yml')
      await writeFile(source, await readFile(join(desktop, 'electron-builder.yml')))
      const args = ['--projectDir', stage, '--config', source, '--win', 'nsis', '--x64']
      const invocation = await prepareWindowsBuilderInvocation(args, desktop, testEnv)
      const receipt = await readFile(invocation.argv[3]!)
      await expect(prepareWindowsBuilderInvocation(args, desktop, testEnv)).rejects.toThrow('EEXIST')
      expect(await readFile(invocation.argv[3]!)).toEqual(receipt)
      expect(await readFile(source)).toEqual(await readFile(join(desktop, 'electron-builder.yml')))
    })
  })
  it('refuses external configuration, mixed platforms and unsupported file mappings', async () => {
    await fixture(async (entry, stage) => {
      const outside = join(entry, 'electron-builder.yml')
      const bytes = await readFile(join(desktop, 'electron-builder.yml'))
      await writeFile(outside, bytes)
      const args = ['--projectDir', stage, '--config', outside, '--win', 'nsis']
      await expect(prepareWindowsBuilderInvocation(args, desktop, testEnv)).rejects.toThrow('in its stage')
      await expect(prepareWindowsBuilderInvocation([...args, '--mac'], desktop, testEnv)).rejects.toThrow('Windows-only')
      const inside = join(stage, 'electron-builder.yml')
      await writeFile(inside, 'files: [{from: elsewhere}]\nwin: {files: []}\n')
      await expect(prepareWindowsBuilderInvocation(args.map(value => value === outside ? inside : value), desktop, testEnv))
        .rejects.toThrow('staged global file patterns')
      expect(await readFile(outside)).toEqual(bytes)
    })
  })
  it('rejects missing stages and missing projectDir before executing a builder', async () => {
    await fixture(async (entry, stage) => {
      await expect(prepareWindowsBuilderContext(join(stage, 'missing'), entry, testEnv)).rejects.toThrow()
      await expect(prepareWindowsBuilderInvocation(['--win', 'nsis'], desktop, testEnv)).rejects.toThrow()
    })
  })
})
