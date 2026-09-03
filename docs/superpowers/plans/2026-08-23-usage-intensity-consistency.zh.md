# Usage 颗粒强度一致性实现计划

[English](2026-08-23-usage-intensity-consistency.md) | 中文

> **面向 agent 工作者：** 必需的子 skill：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans，逐项实现本计划。步骤使用复选框（`- [ ]`）语法跟踪。

**目标：** 让 Usage 的每周与累积颗粒使用每日视图已有的四档蓝色强度来表达相对 token 量。

**架构：** 保持 Host 快照和全部 371 个稳定颗粒位置不变。新增一个仅限客户端的对数聚合强度辅助函数，再将该等级与现有的自底向上填充行投影结合，使每周与累积视图同时通过高度和颜色编码用量。

**技术栈：** TypeScript、React 投影辅助函数、Vitest。

---

### 任务 1：证明聚合颗粒需要分级强度

**文件：**
- 新建：`packages/client/ui-settings-usage/tests/charts.client.spec.ts`
- 修改：`packages/client/ui-settings-usage/src/client/charts.ts`

- [x] **步骤 1：编写失败的每周与累积测试**

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

- [x] **步骤 2：运行聚焦测试并验证 RED**

运行：`pnpm exec vitest run packages/client/ui-settings-usage/tests/charts.client.spec.ts`

预期：失败，因为两个聚合模式目前都会为每个填充颗粒只返回等级 `4`。

- [x] **步骤 3：添加最小相对等级投影**

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

在每周与累积投影中计算 `const level = logarithmicLevel(tokens, maximum)`，并将它传给 `stackLevel(row, filledRows, level)`。

- [x] **步骤 4：运行聚焦测试并验证 GREEN**

运行：`pnpm exec vitest run packages/client/ui-settings-usage/tests/charts.client.spec.ts packages/client/ui-settings-usage/tests/components.client.spec.tsx packages/client/ui-settings-usage/tests/styles.client.spec.ts`

预期：所有 Usage 测试均通过，且快照几何结构没有变化。

- [x] **步骤 5：提交可独立测试的 Usage 改动**

```bash
git add packages/client/ui-settings-usage/src/client/charts.ts packages/client/ui-settings-usage/tests/charts.client.spec.ts
git commit -m "fix(usage): grade aggregate particle intensity"
```
