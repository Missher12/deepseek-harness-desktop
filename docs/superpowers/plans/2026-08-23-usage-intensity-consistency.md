# Usage Particle Intensity Consistency Implementation Plan

English | [中文](2026-08-23-usage-intensity-consistency.zh.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make weekly and cumulative Usage particles communicate relative token volume with the same four blue intensity levels already used by the daily view.

**Architecture:** Keep the Host snapshot and all 371 stable particle positions unchanged. Add a client-only logarithmic aggregate intensity helper, then combine that level with the existing bottom-up filled-row projection so weekly and cumulative views encode volume through both height and color.

**Tech Stack:** TypeScript, React projection helpers, Vitest.

---

### Task 1: Prove aggregate particles need graded intensity

**Files:**
- Create: `packages/client/ui-settings-usage/tests/charts.client.spec.ts`
- Modify: `packages/client/ui-settings-usage/src/client/charts.ts`

- [x] **Step 1: Write the failing weekly and cumulative tests**

```ts ignore-check
import { describe, expect, it } from 'vitest'
import type { UsageActivityDay } from '@deepseek-ai/dsh-api-remotes/client'
import { buildParticleGrid } from '../src/client/charts.ts'

function day(index: number, tokens: number): UsageActivityDay {
  return {
    date: new Date(Date.UTC(2026, 0, 4 + index)).toISOString().slice(0, 10),
    humanMessages: tokens > 0 ? 1 : 0,
    tokens,
    toolCalls: 0,
    level: tokens > 0 ? 1 : 0,
  }
}

describe('aggregate particle intensity', () => {
  const activity = [
    ...Array.from({ length: 7 }, (_, index) => day(index, index === 0 ? 10 : 0)),
    ...Array.from({ length: 7 }, (_, index) => day(index + 7, index === 0 ? 990 : 0)),
  ]

  it('uses lighter filled particles for lower-volume weeks', () => {
    const weeks = buildParticleGrid(activity, 'weekly')
    expect(new Set(weeks[0].map(item => item.level).filter(level => level > 0))).toEqual(new Set([2]))
    expect(new Set(weeks[1].map(item => item.level).filter(level => level > 0))).toEqual(new Set([4]))
  })

  it('grades cumulative filled particles as the running total grows', () => {
    const weeks = buildParticleGrid(activity, 'cumulative')
    expect(new Set(weeks[0].map(item => item.level).filter(level => level > 0))).toEqual(new Set([2]))
    expect(new Set(weeks[1].map(item => item.level).filter(level => level > 0))).toEqual(new Set([4]))
  })
})
```

- [x] **Step 2: Run the focused test and verify RED**

Run: `pnpm exec vitest run packages/client/ui-settings-usage/tests/charts.client.spec.ts`

Expected: FAIL because both aggregate modes currently return only level `4` for every filled particle.

- [x] **Step 3: Add the minimal relative-level projection**

```ts ignore-check
function logarithmicLevel(tokens: number, maximum: number): UsageActivityDay['level'] {
  if (tokens <= 0 || maximum <= 0) return 0
  const level = Math.ceil(4 * Math.log1p(tokens) / Math.log1p(maximum))
  return Math.min(4, Math.max(1, level)) as 1 | 2 | 3 | 4
}

function stackLevel(
  row: number,
  filledRows: number,
  level: UsageActivityDay['level'],
): UsageActivityDay['level'] {
  return row >= 7 - filledRows ? level : 0
}
```

In weekly and cumulative projection, compute `const level = logarithmicLevel(tokens, maximum)` and pass it to `stackLevel(row, filledRows, level)`.

- [x] **Step 4: Run the focused test and verify GREEN**

Run: `pnpm exec vitest run packages/client/ui-settings-usage/tests/charts.client.spec.ts packages/client/ui-settings-usage/tests/components.client.spec.tsx packages/client/ui-settings-usage/tests/styles.client.spec.ts`

Expected: all Usage tests pass with no snapshot geometry changes.

- [x] **Step 5: Commit the independently testable Usage change**

```bash
git add packages/client/ui-settings-usage/src/client/charts.ts packages/client/ui-settings-usage/tests/charts.client.spec.ts
git commit -m "fix(usage): grade aggregate particle intensity"
```
