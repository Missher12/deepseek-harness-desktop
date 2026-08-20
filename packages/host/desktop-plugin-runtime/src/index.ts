/** Desktop-only Host services consumed by package-management plugins. */

import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { delimiter, dirname, isAbsolute, join } from 'node:path'
import type { Readable } from 'node:stream'
import type { Context } from '@deepseek-ai/cordis'
import { resolveProfileDir } from '@deepseek-ai/dsh-app-boot'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type { SubprocessHandle, SubprocessOutcome } from '@deepseek-ai/dsh-subprocess'

const NAME = 'desktop-plugin-runtime'
const TERMINATION_GRACE_MS = 3_000
const require = createRequire(import.meta.url)

/** Immutable trusted paths for one Desktop Host generation. */
export interface DesktopPluginRuntimeFacts {
  profileName: string
  profileDir: string
  homeDir: string
  executable: string
  cliEntry: string
  pnpmEntry: string
}

/** Immutable identity and directory for the Desktop-owned active profile. */
export interface DesktopCurrentProfile {
  readonly name: string
  readonly dir: string
}

/** Fixed-profile facade consumed by trusted package-management plugins. */
export interface DesktopProfiles {
  readonly current: DesktopCurrentProfile
  /**
   * List profiles exposed to the package manager.
   *
   * @returns The single Desktop-owned profile available in this generation.
   */
  list(): readonly DesktopCurrentProfile[]
  /**
   * Accept the active profile name and reject every profile switch attempt.
   *
   * @param name - Requested Harness profile name.
   * @returns A settled promise when the requested name is already active.
   */
  select(name: string): Promise<void>
}

/** One cancellable, tree-managed packaged-pnpm operation. */
export interface DesktopPnpmHandle {
  readonly stdout: Readable
  readonly stderr: Readable
  readonly done: Promise<SubprocessOutcome>
  cancel(): void
}

/** Restricted command runner that invokes the bundled DSH plugin command. */
export interface DesktopPnpm {
  /**
   * Run one validated DSH plugin command through the packaged pnpm entry.
   *
   * @param args - Trusted plugin-command arguments supplied by the Host plugin.
   * @param invokingDir - Absolute caller directory used for package resolution.
   * @param signal - Optional cancellation signal scoped to the operation.
   * @returns Managed output streams, completion promise, and cancellation hook.
   */
  runPlugin(args: readonly string[], invokingDir: string, signal?: AbortSignal): DesktopPnpmHandle
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    desktopProfiles: DesktopProfiles
    desktopPnpm: DesktopPnpm
  }
}

interface ActiveOperation {
  readonly child: SubprocessHandle
  done: Promise<SubprocessOutcome>
}

function assertAbsolute(label: string, value: string): void {
  if (value.length === 0 || value.includes('\0') || !isAbsolute(value)) {
    throw new Error(`${NAME}: ${label} must be an absolute path without NUL`)
  }
}

function validateFacts(facts: DesktopPluginRuntimeFacts): void {
  if (!/^[A-Za-z0-9_-]+$/.test(facts.profileName)) {
    throw new Error(`${NAME}: profile name must use letters, digits, underscore, or hyphen`)
  }
  for (const [label, value] of [
    ['profile directory', facts.profileDir],
    ['Harness home', facts.homeDir],
    ['runtime executable', facts.executable],
    ['DSH CLI entry', facts.cliEntry],
    ['pnpm entry', facts.pnpmEntry],
  ] as const) assertAbsolute(label, value)
}

function validateArgs(args: readonly string[]): string[] {
  if (args.length === 0) throw new Error(`${NAME}: package arguments must not be empty`)
  if (args.some(argument => argument.includes('\0'))) {
    throw new Error(`${NAME}: package arguments must not contain NUL`)
  }
  return [...args]
}

/**
 * Resolve pnpm's JavaScript bin without trusting PATH or a renderer value.
 *
 * @param manifestPath - Resolved pnpm manifest path; injectable for isolated validation tests.
 * @returns Absolute JavaScript entry path for the packaged pnpm binary.
 */
export function resolvePackagedPnpmEntry(manifestPath = require.resolve('pnpm')): string {
  // pnpm exports its manifest as the package root (`pnpm`), while deliberately
  // rejecting the `pnpm/package.json` subpath. Resolve only the supported root.
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    bin?: string | Record<string, string>
  }
  const relative = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.pnpm
  if (typeof relative !== 'string' || relative.length === 0 || relative.includes('\0')) {
    throw new Error(`${NAME}: packaged pnpm manifest does not declare a safe pnpm bin`)
  }
  const entry = join(dirname(manifestPath), relative)
  assertAbsolute('pnpm entry', entry)
  return entry
}

/**
 * Resolve the current packaged process facts once for the active web profile.
 *
 * @param profileName - Trusted Harness profile mounted by the Desktop composition.
 * @returns Validated immutable paths used by Desktop package services.
 */
export function resolveDesktopPluginRuntimeFacts(profileName = 'web'): DesktopPluginRuntimeFacts {
  const homeDir = resolveDshHome()
  const cliEntry = process.argv[1]
  if (cliEntry === undefined) throw new Error(`${NAME}: DSH CLI entry is unavailable`)
  const facts: DesktopPluginRuntimeFacts = {
    profileName,
    profileDir: resolveProfileDir(profileName, homeDir),
    homeDir,
    executable: process.execPath,
    cliEntry,
    pnpmEntry: resolvePackagedPnpmEntry(),
  }
  validateFacts(facts)
  return facts
}

class DesktopPnpmService implements DesktopPnpm {
  private active: ActiveOperation | undefined
  private closed = false
  private nodeShimDir: string | undefined

  constructor(private readonly ctx: Context, private readonly facts: DesktopPluginRuntimeFacts) {
    ctx.effect(
      () => async () => {
        this.closed = true
        const active = this.active
        try {
          if (active !== undefined) {
            active.child.terminate()
            await active.done.catch(() => {})
          }
        } finally {
          this.removeNodeShim()
        }
      },
      `${NAME}: package operation teardown`,
    )
  }

  runPlugin(args: readonly string[], invokingDir: string, signal?: AbortSignal): DesktopPnpmHandle {
    if (this.closed) throw new Error(`${NAME}: package runtime is closed`)
    if (this.active !== undefined) throw new Error(`${NAME}: another desktop pnpm operation is already running`)
    const forwarded = validateArgs(args)
    assertAbsolute('plugin invoking directory', invokingDir)
    signal?.throwIfAborted()
    const nodeShimDir = this.ensureNodeShim()
    const ambientPath = process.env.PATH ?? ''

    const child = this.ctx.subprocess.spawn({
      argv: [
        this.facts.executable,
        this.facts.cliEntry,
        'plugin',
        '--profile',
        this.facts.profileName,
        ...forwarded,
      ],
      cwd: invokingDir,
      stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
      graceMs: TERMINATION_GRACE_MS,
      ...(signal === undefined ? {} : { signal }),
      env: {
        CI: 'true',
        DSH_HOME: this.facts.homeDir,
        DSH_DESKTOP_NODE_EXECUTABLE: this.facts.executable,
        DSH_DESKTOP_PNPM_ENTRY: this.facts.pnpmEntry,
        ELECTRON_RUN_AS_NODE: '1',
        PATH: ambientPath.length === 0 ? nodeShimDir : `${nodeShimDir}${delimiter}${ambientPath}`,
      },
    })
    if (child.stdout === undefined || child.stderr === undefined) {
      child.terminate()
      throw new Error(`${NAME}: package subprocess did not expose piped output`)
    }
    const active: ActiveOperation = {
      child,
      done: Promise.resolve({ exitCode: null, signal: null }),
    }
    active.done = this.settle(active)
    this.active = active
    return {
      stdout: child.stdout,
      stderr: child.stderr,
      done: active.done,
      cancel: () => { child.terminate() },
    }
  }

  private async settle(active: ActiveOperation): Promise<SubprocessOutcome> {
    try {
      return await active.child.done
    } finally {
      try {
        await active.child.waitForExit()
      } finally {
        if (this.active === active) this.active = undefined
      }
    }
  }

  /**
   * Give pnpm/node-gyp lifecycle wrappers a stable bare `node` command without
   * relying on the GUI launch environment. The shim delegates to the packaged
   * Electron executable, which is already running in Node mode for this child.
   */
  private ensureNodeShim(): string {
    if (this.nodeShimDir !== undefined) return this.nodeShimDir
    const directory = mkdtempSync(join(tmpdir(), 'dsh-desktop-node-'))
    try {
      chmodSync(directory, 0o700)
      const windows = process.platform === 'win32'
      const path = join(directory, windows ? 'node.cmd' : 'node')
      const body = windows
        ? '@echo off\r\n"%DSH_DESKTOP_NODE_EXECUTABLE%" %*\r\n'
        : '#!/bin/sh\nexec "$DSH_DESKTOP_NODE_EXECUTABLE" "$@"\n'
      writeFileSync(path, body, { encoding: 'utf8', flag: 'wx', mode: 0o700 })
      if (!windows) chmodSync(path, 0o700)
      this.nodeShimDir = directory
      return directory
    } catch (error) {
      rmSync(directory, { recursive: true, force: true })
      throw error
    }
  }

  /** Remove the service-private executable shim when its Host generation ends. */
  private removeNodeShim(): void {
    const directory = this.nodeShimDir
    this.nodeShimDir = undefined
    if (directory === undefined) return
    try { rmSync(directory, { recursive: true, force: true }) } catch { /* best-effort temp cleanup */ }
  }
}

/**
 * Publish the two structural services dshmarket consumes in Desktop mode.
 *
 * @param ctx - Active Harness Host context receiving the structural services.
 * @param facts - Validated Desktop runtime and active-profile paths.
 * @returns Fixed profile and packaged-pnpm service objects.
 */
export function installDesktopPluginServices(ctx: Context, facts: DesktopPluginRuntimeFacts): {
  profiles: DesktopProfiles
  pnpm: DesktopPnpm
} {
  validateFacts(facts)
  const current = Object.freeze({ name: facts.profileName, dir: facts.profileDir })
  const profiles: DesktopProfiles = {
    current,
    list: () => [current],
    select: name => name === current.name
      ? Promise.resolve()
      : Promise.reject(new Error(`${NAME}: profile switching is not available in this Desktop shell`)),
  }
  const pnpm = new DesktopPnpmService(ctx, facts)
  ctx.provide('desktopProfiles', profiles)
  ctx.provide('desktopPnpm', pnpm)
  return { profiles, pnpm }
}

export const name = NAME
export const inject = ['subprocess']

/** Desktop plugin-runtime configuration supplied by the immutable patch. */
export interface Config {
  /** Harness profile exposed to package-management plugins. */
  profile?: string
}

/** Mount Desktop package services for the active profile generation. */
export function apply(ctx: Context, config: Config = {}): void {
  installDesktopPluginServices(ctx, resolveDesktopPluginRuntimeFacts(config.profile ?? 'web'))
}
