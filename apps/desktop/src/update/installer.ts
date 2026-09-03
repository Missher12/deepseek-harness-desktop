import { spawn } from 'node:child_process'
import { chmodSync, copyFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import type { UpdateHelperConfig } from './update-helper.ts'

export interface DesktopInstallerLaunchOptions {
  helperSource: string
  electronExecutable: string
  currentAppPath: string
  dmgPath: string
  expectedDesktopVersion: string
  expectedHarnessVersion: string
  expectedSha256: string
  parentPid?: number
}

/** Copy and detach the packaged helper without a shell or inherited secrets. */
export function launchDesktopInstaller(options: DesktopInstallerLaunchOptions): number {
  const helperPath = join(dirname(options.dmgPath), 'update-helper.mjs')
  copyFileSync(options.helperSource, helperPath)
  chmodSync(helperPath, 0o700)
  const config: UpdateHelperConfig = {
    schema: 1,
    parentPid: options.parentPid ?? process.pid,
    currentAppPath: resolve(options.currentAppPath),
    dmgPath: resolve(options.dmgPath),
    expectedDesktopVersion: options.expectedDesktopVersion,
    expectedHarnessVersion: options.expectedHarnessVersion,
    expectedSha256: options.expectedSha256,
  }
  const child = spawn(options.electronExecutable, [helperPath, Buffer.from(JSON.stringify(config)).toString('base64url')], {
    detached: true,
    shell: false,
    stdio: 'ignore',
    env: {
      ELECTRON_RUN_AS_NODE: '1',
      HOME: homedir(),
      TMPDIR: tmpdir(),
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    },
  })
  child.unref()
  if (child.pid === undefined) throw new Error('Failed to launch the Desktop update helper.')
  return child.pid
}
