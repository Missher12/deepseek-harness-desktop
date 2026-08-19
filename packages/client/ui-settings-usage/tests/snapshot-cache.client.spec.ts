import { afterEach, describe, expect, it } from 'vitest'
import type { UsageInsightsSnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import {
  readUsageSnapshot, resetUsageSnapshotForTest, writeUsageSnapshot,
} from '../src/client/snapshot-cache.ts'

afterEach(resetUsageSnapshotForTest)

describe('usage snapshot process-memory cache', () => {
  it('holds only the latest successful immutable snapshot for the current process', () => {
    expect(readUsageSnapshot()).toBeUndefined()
    const snapshot = { generatedAt: 1 } as UsageInsightsSnapshot
    writeUsageSnapshot(snapshot)
    expect(readUsageSnapshot()).toBe(snapshot)
  })
})
