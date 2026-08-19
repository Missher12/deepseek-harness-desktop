import type { UsageInsightsSnapshot } from '@deepseek-ai/dsh-api-remotes/client'

let latestSnapshot: UsageInsightsSnapshot | undefined

/**
 * Read the last successful Usage snapshot retained by this renderer process.
 * @returns the retained snapshot, or undefined before the first successful read.
 */
export function readUsageSnapshot(): UsageInsightsSnapshot | undefined {
  return latestSnapshot
}

/**
 * Replace the process-memory Usage snapshot after a successful refresh.
 * @param snapshot - immutable successful snapshot to retain for the next visit.
 */
export function writeUsageSnapshot(snapshot: UsageInsightsSnapshot): void {
  latestSnapshot = snapshot
}

/** Clear process-memory state between isolated component tests. */
export function resetUsageSnapshotForTest(): void {
  latestSnapshot = undefined
}
