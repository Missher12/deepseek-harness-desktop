import type { UsageInsightsSnapshot } from '@deepseek-ai/dsh-api-remotes/client'

let latestSnapshot: UsageInsightsSnapshot | undefined

/** Read the last successful Usage snapshot retained by this renderer process. */
export function readUsageSnapshot(): UsageInsightsSnapshot | undefined {
  return latestSnapshot
}

/** Replace the process-memory Usage snapshot after a successful refresh. */
export function writeUsageSnapshot(snapshot: UsageInsightsSnapshot): void {
  latestSnapshot = snapshot
}

/** Clear process-memory state between isolated component tests. */
export function resetUsageSnapshotForTest(): void {
  latestSnapshot = undefined
}
