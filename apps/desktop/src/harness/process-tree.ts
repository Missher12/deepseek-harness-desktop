import { spawnSync } from 'node:child_process'

/** Escalation level requested for one application-owned process tree. */
export type TerminationMode = 'graceful' | 'force'

/** Synchronous Windows command seam used by deterministic tests. */
export interface ProcessTreeRunner {
  run(command: string, args: readonly string[]): void
}

const systemRunner: ProcessTreeRunner = {
  run(command, args) {
    spawnSync(command, [...args], { stdio: 'ignore', windowsHide: true })
  },
}

/**
 * Terminate one exact application-owned process tree with host-native semantics.
 * @param pid - Positive root PID returned by the application's spawn call.
 * @param mode - Graceful or forced termination requested by the owner.
 * @param platform - Node platform identifier for signal selection.
 * @param runner - Injectable Windows command runner.
 */
export function terminateProcessTree(
  pid: number,
  mode: TerminationMode,
  platform: NodeJS.Platform,
  runner: ProcessTreeRunner = systemRunner,
): void {
  if (pid <= 0) return
  try {
    if (platform === 'win32') {
      runner.run('taskkill', ['/PID', String(pid), '/T', '/F'])
      return
    }
    process.kill(-pid, mode === 'graceful' ? 'SIGTERM' : 'SIGKILL')
  } catch {
    // The owned tree may settle between observation and termination.
  }
}
