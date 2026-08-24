# 本地外置大脑 0.3.8 实施计划

[English](2026-08-24-local-external-brain-038.md) | 中文

> **供智能体工作者使用：** 必须使用子 Skill：superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans，逐项实施本计划。步骤使用复选框（`- [ ]`）跟踪。

**目标：** 为 Intel macOS 与 Windows x64 发布 DeepSeek Harness Desktop 0.3.8，包含一个本地 Brain Hub、Harness 原生 MSE Provider、可回滚的已审核记忆固化，以及内置 TencentDB 只读兼容能力。

**架构：** `@deepseek-ai/dsh-missher-brain@0.1.1-rc.2` 统一负责注入和预算；`dsh-missher-memory@0.2.0` 负责事实状态、FTS5、胶囊和旧版只读 Reader；`dsh-missher-evolution@0.1.1` 负责程序性学习。Desktop 固定不可变 Provider Release 包，先组合 Brain 再组合两个 Provider，并从同一个公开源码提交生成两个原生安装包。

**技术栈：** TypeScript、Cordis、React、Typert Remote、Node `worker_threads`、`node:sqlite`/FTS5、Vitest、Electron/electron-builder、GitHub Actions、PowerShell、macOS `hdiutil`。

---

## 仓库与文件映射

- Desktop 仓库：`/Users/missher/Documents/ChatGPT/Deepseek-Desktop`；设计提交合入公开 `origin/main` 后，从它创建 `.worktrees/external-brain-038` 实施 worktree。
- 记忆仓库：`/Users/missher/Documents/ChatGPT/Deepseek-Desktop/.worktrees/dsh-missher-memory-github`；从 `origin/main`（`5c672a4` 或更新提交）创建同级 `dsh-missher-memory-brain-020` 实施 worktree。
- MSE 仓库：`/Users/missher/Documents/Missher Evolution System`；从 `codex/universal-agent-mse`（`43eb7d0` 或经审核的后续提交）创建 `.worktrees/harness-brain-provider`，绝不使用有改动的主 worktree。
- 公开 MSE 包仓库：`/Users/missher/Documents/ChatGPT/Deepseek-Desktop/.worktrees/dsh-missher-evolution-public`；只接收白名单内的 Harness 包导出，绝不包含 Hermes、飞书、凭据、运行状态或个人配置。
- Brain Hub 位于公开 Desktop monorepo 的 `packages/brain/missher-brain/`，作为 workspace release member `@deepseek-ai/dsh-missher-brain@0.1.1-rc.2`。
- 记忆 schema、迁移、FTS、固化和 TencentDB 隔离保留在独立记忆仓库。
- Desktop 组合、Release 元数据、打包 smoke 和原生安装包保留在 `apps/desktop/` 与 `scripts/`。

### 任务 1：建立 Brain Hub Provider 契约

**文件：**
- 新建：`packages/brain/missher-brain/package.json`
- 新建：`packages/brain/missher-brain/tsconfig.json`
- 新建：`packages/brain/missher-brain/src/contracts.ts`
- 新建：`packages/brain/missher-brain/src/registry.ts`
- 测试：`packages/brain/missher-brain/tests/registry.spec.ts`

- [ ] **步骤 1：编写失败的注册表和 lease 测试**

```typescript
it('rejects duplicate provider ids and disposes registrations', () => {
  const registry = new BrainProviderRegistry()
  const dispose = registry.register(fakeProvider('memory'))
  expect(() => registry.register(fakeProvider('memory'))).toThrow('duplicate provider')
  dispose()
  expect(registry.list()).toEqual([])
})

it('accepts only selected contribution handles', async () => {
  const batch = fakeBatch(['m1', 'm2'])
  await batch.accept(['m2'])
  expect(batch.accepted()).toEqual(['m2'])
})
```

- [ ] **步骤 2：运行聚焦测试并确认 RED**

运行：`pnpm exec vitest run packages/brain/missher-brain/tests/registry.spec.ts`

预期：失败，因为 `BrainProviderRegistry` 和 Provider 契约尚不存在。

- [ ] **步骤 3：增加最小版本化契约和注册表**

```typescript
export type BrainContributionKind = 'reviewed-memory' | 'memory-capsule' | 'legacy-memory' | 'learned-rule'

export interface BrainContribution {
  handle: string
  providerId: string
  kind: BrainContributionKind
  text: string
  reference: string
  recordedAt: string
  score: number
  pinned: boolean
}

export interface PreparedBrainBatch {
  items: readonly BrainContribution[]
  accept(handles: readonly string[]): Promise<void>
  cancel(): Promise<void>
}

export interface BrainProvider {
  readonly protocolVersion: 1
  readonly id: string
  readonly byteBudget: number
  prepare(input: { projectKey: string; query: string; signal: AbortSignal }): Promise<PreparedBrainBatch>
  status(): Promise<{ state: 'ready' | 'disabled' | 'unavailable'; count: number }>
}
```

`BrainProviderRegistry.register()` 拒绝空 ID、同一 ID 的第二个有效注册、不是 `1` 的协议版本，以及 `1..6000` 之外的预算；disposer 只移除精确的已注册对象。

- [ ] **步骤 4：运行测试和包检查**

运行：`pnpm exec vitest run packages/brain/missher-brain/tests/registry.spec.ts && pnpm --filter @deepseek-ai/dsh-missher-brain run typecheck`

预期：所有注册表测试通过，严格 TypeScript 退出码为 `0`。

- [ ] **步骤 5：提交契约**

```bash
git add packages/brain/missher-brain pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "feat(brain): add provider contract"
```

### 任务 2：实现唯一且 fail-open 的 Brain Hub 注入路径

**文件：**
- 新建：`packages/brain/missher-brain/src/arbiter.ts`
- 新建：`packages/brain/missher-brain/src/index.ts`
- 新建：`packages/brain/missher-brain/src/injection.ts`
- 测试：`packages/brain/missher-brain/tests/arbiter.spec.ts`
- 测试：`packages/brain/missher-brain/tests/injection.spec.ts`

- [ ] **步骤 1：编写失败的仲裁和故障隔离测试**

```typescript
it('keeps reviewed facts ahead of legacy duplicates and accepts selected handles only', async () => {
  const result = await arbitrate([reviewed('same', 'm1'), legacy('same', 't1'), activeRule('r1')], {
    maxItems: 6,
    maxBytes: 4000,
  })
  expect(result.items.map(item => item.handle)).toEqual(['m1', 'r1'])
})

it('returns the downstream decision when every provider times out', async () => {
  expect(await runPreStep({ providers: [neverProvider()], timeoutMs: 20 })).toEqual(downstreamDecision)
})
```

- [ ] **步骤 2：运行测试并确认 RED**

运行：`pnpm exec vitest run packages/brain/missher-brain/tests/arbiter.spec.ts packages/brain/missher-brain/tests/injection.spec.ts`

预期：失败，因为仲裁与注入尚不存在。

- [ ] **步骤 3：实现确定性预算和共享取消截止时间**

```typescript
const KIND_PRIORITY: Record<BrainContributionKind, number> = {
  'reviewed-memory': 400,
  'memory-capsule': 350,
  'learned-rule': 300,
  'legacy-memory': 100,
}

export function rank(item: BrainContribution): number {
  return KIND_PRIORITY[item.kind] + item.score + Number(item.pinned) * 1000
}
```

pre-step Hook 只在顶层直接用户第一步运行。它在一个 `AbortController` 下并行准备 Provider，不修改任何存储地去重规范化文本，最多选择六条/4,000 字节，只对已选 handle 调用 `accept()`，对未选或放弃的 batch 调用 `cancel()`，并在返回原始 decision 前捕获所有 Provider 或格式化错误。

- [ ] **步骤 4：运行聚焦测试和覆盖率**

运行：`pnpm exec vitest run packages/brain/missher-brain/tests --coverage.enabled --coverage.include=packages/brain/missher-brain/src/**`

预期：所有测试通过，新 Host 的 statements、branches、functions 和 lines 均为 `100%`。

- [ ] **步骤 5：提交注入器**

```bash
git add packages/brain/missher-brain
git commit -m "feat(brain): arbitrate local memory and rules"
```

### 任务 3：适配并发布 Harness 原生 MSE Provider

**文件：**
- 修改：`harness-plugin/src/adapter.ts`
- 新建：`harness-plugin/src/brain-provider.ts`
- 修改：`harness-plugin/src/index.ts`
- 修改：`harness-plugin/src/client/index.ts`
- 修改：`harness-plugin/package.json`
- 新建：`scripts/export_public_harness_plugin.mjs`
- 测试：`harness-plugin/tests/brain-provider.spec.ts`
- 测试：`harness-plugin/tests/public-export.spec.ts`

- [ ] **步骤 1：编写失败的单次使用和反馈隔离测试**

```typescript
it('does not accept a prepared rule until Brain Hub selects it', async () => {
  const batch = await provider.prepare(turnInput('direct user correction'))
  expect(store.auditByAction('rules_injected')).toHaveLength(0)
  await batch.accept([batch.items[0]!.handle])
  expect(store.auditByAction('rules_injected')).toHaveLength(1)
})

it('never learns recalled or maintenance text', async () => {
  await provider.observe(pluginMessage('missher-brain', 'recalled text'))
  await provider.observe(pluginMessage('missher-memory', 'maintenance text'))
  expect(store.captureCount()).toBe(0)
})
```

- [ ] **步骤 2：运行聚焦 MSE 测试并确认 RED**

运行：`pnpm --dir harness-plugin exec vitest run tests/brain-provider.spec.ts tests/public-export.spec.ts`

预期：失败，因为 Provider preparation 和公开导出白名单尚不存在。

- [ ] **步骤 3：拆分准备与接受，并增加安全导出**

`MseAdapter.prepareStep()` 返回单次使用的准备规则，不调用 `acceptInjection`。`MseBrainProvider.accept()` 只为选中的不透明 handle 调用一次 `acceptInjection`；`cancel()` 释放准备回合。独立模式的 `preStep()` 使用同一 Provider，并立即接受它注入的条目，在 Brain Hub 不存在时保持当前行为。

公开导出脚本只复制 `harness-plugin/{src,tests,README*,LICENSE,package.json,tsconfig*.json,cordis.patch.yml}` 以及构建所需的白名单内嵌 SDK 源码。如果输出包含 `Hermes`、`Feishu`、疑似 token 值、运行状态、`.env`、Python Hook、Cron、Gateway 文件、数据库或安装脚本，脚本以非零退出。

- [ ] **步骤 4：运行 MSE 回归和包验证**

运行：`pnpm --dir harness-plugin test && pnpm --dir harness-plugin run typecheck && pnpm --dir harness-plugin run build && pnpm --dir harness-plugin run pack && pnpm --dir harness-plugin run verify:package -- harness-plugin/dist/dsh-missher-evolution-0.1.1.tgz`

预期：既有 103 项或更多测试加新增 Provider/导出测试全部通过；包版本为 `0.1.1`，没有安装脚本或私有运行材料，并在 macOS Intel、macOS Apple Silicon 和 Windows x64 CI 通过 native smoke。

- [ ] **步骤 5：提交并发布不可变 MSE 0.1.1**

```bash
git add harness-plugin scripts/export_public_harness_plugin.mjs PROJECT_CONTEXT.md
git commit -m "feat(harness): expose MSE brain provider"
```

只有导出测试通过后才创建公开白名单仓库，推送经过审核的 PR，标记 `v0.1.1`，上传规范 CI `.tgz` 与 LF/ASCII checksum，并在 Desktop 引用 URL 前匿名重下载验证。

### 任务 4：把记忆状态迁移到 schema 2 和串行 Worker

**文件：**
- 新建：`src/shared/state-protocol.ts`
- 新建：`src/workers/state-runtime.ts`
- 新建：`src/workers/state.worker.ts`
- 新建：`src/host/state-worker.ts`
- 修改：`src/host/state-store.ts`
- 新建：`src/host/state-schema.ts`
- 测试：`tests/state-worker.spec.ts`
- 测试：`tests/schema-migration.spec.ts`

- [ ] **步骤 1：编写失败的迁移和 Worker 终止测试**

```typescript
it('migrates v1 atom rows without changing content or bindings', async () => {
  const before = await snapshotV1(databasePath)
  await store.open()
  expect(await snapshotV2(databasePath)).toMatchObject(before)
  expect(await pragmaUserVersion(databasePath)).toBe(2)
})

it('leaves the v1 database authoritative when migration is interrupted', async () => {
  await expect(openWithFault('after-backup')).resolves.toMatchObject({ status: 'incompatible-state' })
  expect(await pragmaUserVersion(databasePath)).toBe(1)
})
```

- [ ] **步骤 2：运行聚焦测试并确认 RED**

运行：`pnpm exec vitest run tests/state-worker.spec.ts tests/schema-migration.spec.ts`

预期：失败，因为 schema 2 和状态 Worker 尚不存在。

- [ ] **步骤 3：通过 Worker 实现增量 schema 2 迁移**

```sql
ALTER TABLE approved_memories ADD COLUMN lifecycle_state TEXT NOT NULL DEFAULT 'active';
CREATE TABLE memory_capsules (
  capsule_id TEXT PRIMARY KEY,
  project_key TEXT NOT NULL REFERENCES projects(project_key) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  kind TEXT NOT NULL,
  topic_key TEXT NOT NULL,
  content TEXT NOT NULL,
  source_ids_json TEXT NOT NULL,
  status TEXT NOT NULL,
  policy_version INTEGER NOT NULL,
  checksum TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE maintenance_runs (
  run_id TEXT PRIMARY KEY,
  project_key TEXT NOT NULL REFERENCES projects(project_key) ON DELETE CASCADE,
  trigger TEXT NOT NULL,
  result TEXT NOT NULL,
  input_count INTEGER NOT NULL,
  output_count INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL
);
PRAGMA user_version = 2;
```

Proxy 保留既有异步 `StateStore` API，而所有 `DatabaseSync` 操作都在一个可终止 Worker 中执行。迁移在 `BEGIN IMMEDIATE` 前写入 `0600` 备份，校验密钥和 v1 schema，执行事务，并在任何故障下让未修改的 v1 文件恢复权威。

- [ ] **步骤 4：运行完整记忆回归**

运行：`pnpm test && pnpm run typecheck && pnpm run build`

预期：既有 100 项或更多测试和新增 Worker/迁移测试全部通过；没有测试读写真实 `$DSH_HOME`。

- [ ] **步骤 5：提交 schema 2**

```bash
git add src tests package.json PROJECT_CONTEXT.md
git commit -m "feat(memory): add reversible schema two state"
```

### 任务 5：增加索引召回并隔离内置 TencentDB 兼容能力

**文件：**
- 新建：`src/workers/fts-index.ts`
- 修改：`src/host/approved-search.ts`
- 修改：`src/host/reader-worker.ts`
- 修改：`src/workers/sqlite-reader.worker.ts`
- 修改：`src/host/path-policy.ts`
- 测试：`tests/fts-search.spec.ts`
- 测试：`tests/tencentdb-isolation.spec.ts`
- 测试：`tests/long-history.spec.ts`

- [ ] **步骤 1：编写失败的原生 FTS 和字节保留测试**

```typescript
it('searches 50,000 mixed Chinese and English atoms under the p95 budget', async () => {
  const samples = await benchmarkSearch(seedAtoms(50_000), ['架构边界', 'retry policy'], 40)
  expect(percentile(samples, 95)).toBeLessThan(150)
})

it('never changes the legacy vectors database', async () => {
  const before = await sha256(vectorsDb)
  await searchLegacyAndRunMaintenance(vectorsDb)
  expect(await sha256(vectorsDb)).toBe(before)
})
```

- [ ] **步骤 2：运行聚焦测试并确认 RED**

运行：`pnpm exec vitest run tests/fts-search.spec.ts tests/tencentdb-isolation.spec.ts tests/long-history.spec.ts`

预期：失败，因为已批准记忆仍在进程中扫描，且没有跨操作保留断言。

- [ ] **步骤 3：实现 FTS5 和严格旧版来源隔离**

建立与有效原子和胶囊事务同步的 FTS5 表。查询规范化继续参数化，并拒绝敏感或畸形输入。旧版 Worker 以 `{ readOnly: true, allowExtension: false }` 打开精确解析后的 `vectors.db`，拒绝根目录/数据库符号链接和 containment 失败，只暴露带标签的召回行，并且协议中不存在任何 mutation 操作。

Brain preparation 只在返回 batch 中去重旧版行，永远不把它们写入 FTS、候选、胶囊、MSE、导出、删除或重置。当前已审核记忆优先于完全重复的旧版命中；矛盾内容保留双方标签和时间。

- [ ] **步骤 4：运行性能、安全和完整回归**

运行：`pnpm exec vitest run tests/fts-search.spec.ts tests/tencentdb-isolation.spec.ts tests/path-policy.spec.ts tests/query-policy.spec.ts tests/long-history.spec.ts && pnpm test`

预期：参考 Intel Mac 上 FTS p95 低于 150 ms，路径/SQL/符号链接测试通过，fixture 数据库哈希不变，完整测试为绿色。

- [ ] **步骤 5：提交索引召回**

```bash
git add src tests README.md README.zh.md PROJECT_CONTEXT.md
git commit -m "feat(memory): index durable recall safely"
```

### 任务 6：实现可回滚自动固化

**文件：**
- 新建：`src/host/consolidation-policy.ts`
- 新建：`src/host/consolidation-service.ts`
- 新建：`src/host/consolidation-validation.ts`
- 新建：`src/workers/consolidation-runtime.ts`
- 修改：`src/index.ts`
- 测试：`tests/consolidation.spec.ts`
- 测试：`tests/consolidation-faults.spec.ts`

- [ ] **步骤 1：编写失败的 eligibility、校验和回滚测试**

```typescript
it('excludes pending, pinned, recent, cross-project, and incompatible-kind atoms', async () => {
  expect(selectEligible(fixtureAtoms(), policy)).toEqual(['old-project-progress-1', 'old-project-progress-2', 'old-project-progress-3', 'old-project-progress-4'])
})

it('rejects a capsule that invents an identifier', async () => {
  expect(validateCapsule({ content: 'Deploy commit deadbeef', sourceIds }, sources)).toEqual({ ok: false, reason: 'identifier-fidelity' })
})

it('rolls back by superseding the capsule and reactivating every source atom', async () => {
  await store.rollbackCapsule(capsuleId)
  expect(await store.capsuleState(capsuleId)).toBe('superseded')
  expect(await store.sourceStates(capsuleId)).toEqual(['active', 'active', 'active', 'active'])
})
```

- [ ] **步骤 2：运行测试并确认 RED**

运行：`pnpm exec vitest run tests/consolidation.spec.ts tests/consolidation-faults.spec.ts`

预期：失败，因为策略、胶囊校验、事务提交和回滚尚不存在。

- [ ] **步骤 3：实现有界空闲管线**

Eligibility 要求已审核有效原子、至少存放七天、四条兼容来源、未固定、无敏感文本、同项目/scope 且无未解决冲突。单批最多 24 条/12 KiB。完全重复内容确定性固化；语义固化只在空闲时调用配置的低成本 Harness route，校验不透明来源 ID 和标识符忠实度，然后在一个 Worker 事务中提交胶囊并归档来源。

除非用户点击“立即整理”，每个项目每 24 小时最多运行一次。超时、畸形输出、低电量、活跃聊天、锁竞争、Worker 退出或应用关闭只记录固定结果类别，所有来源保持有效。

- [ ] **步骤 4：运行固化和包回归**

运行：`pnpm exec vitest run tests/consolidation.spec.ts tests/consolidation-faults.spec.ts --coverage.enabled && pnpm test && pnpm run verify:package -- dist/dsh-missher-memory-0.2.0.tgz`

预期：所有测试通过，新增固化代码达到 100% 聚焦覆盖率，包内没有数据库、状态、密钥、安装脚本或未列出文件。

- [ ] **步骤 5：提交并发布记忆 0.2.0**

```bash
git add src tests package.json README.md README.zh.md PROJECT_CONTEXT.md
git commit -m "feat(memory): consolidate reviewed memory reversibly"
```

向 `Missher12/dsh-missher-memory` 推送 PR，要求 macOS Intel/Apple Silicon 和 Windows x64 规范 CI，标记 `v0.2.0`，上传规范 `.tgz` 与 LF/ASCII checksum，再匿名验证准确字节和 SHA-256。

### 任务 7：构建统一“外置大脑”设置概览

**文件：**
- 新建：`packages/brain/missher-brain/src/contracts.ts`
- 新建：`packages/brain/missher-brain/src/index.ts`
- 新建：`packages/client/ui-settings-brain/src/client/BrainSettingsSection.tsx`
- 新建：`packages/client/ui-settings-brain/src/client/BrainSettingsSection.module.css`
- 新建：`packages/client/ui-settings-brain/src/client/index.ts`
- 新建：`packages/client/ui-settings-brain/src/client/locales.ts`
- 测试：`packages/client/ui-settings-brain/tests/components.client.spec.tsx`
- 测试：`packages/client/ui-settings-brain/tests/apply.client.spec.tsx`

- [ ] **步骤 1：编写失败的 UI 状态和无障碍测试**

```tsx
it('shows stable placeholders before provider counts arrive', () => {
  render(<BrainSection remote={deferredRemote()} />)
  expect(screen.getByRole('heading', { name: '外置大脑' })).toBeVisible()
  expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  expect(screen.queryByText('加载中')).toBeNull()
})

it('replaces placeholders with bounded pathless provider counts', async () => {
  render(<BrainSettingsSection load={resolvedSnapshot()} />)
  expect(await screen.findByText('2 条记忆')).toBeVisible()
  expect(screen.queryByText('/Users/example/project')).toBeNull()
})
```

- [ ] **步骤 2：运行 Client 测试并确认 RED**

运行：`pnpm exec vitest run packages/client/ui-settings-brain/tests/components.client.spec.tsx packages/client/ui-settings-brain/tests/apply.client.spec.tsx`

预期：失败，因为页面、Remote 和提示尚不存在。

- [ ] **步骤 3：实现受管设置页和 Provider 面板**

Brain Settings Client 注册一个 `settings.section` 条目。Memory 和 MSE 保留各自 Provider 所有的控件，概览页只读取一份有界的 Brain Remote 快照，其中仅包含不含路径的状态和计数。

页面遵循共享设置宽度和标题/简介/小节排版。它会立即绘制稳定占位内容，随后刷新，且不暴露文件系统路径、数据库名称、本地键、原始会话 ID 或 Provider 错误。

- [ ] **步骤 4：运行 Client 测试、快照和视觉 smoke**

运行：`pnpm exec vitest run packages/brain/missher-brain/tests packages/client/ui-settings-general/tests/settings-root.client.spec.tsx && pnpm run build:client`

预期：所有测试通过；浅色/深色及 760/640 px 浏览器快照无溢出、重复设置入口、布局跳动或不可访问控制。

- [ ] **步骤 5：提交产品界面**

```bash
git add packages/brain/missher-brain packages/client apps/web/tests/snapshots
git commit -m "feat(brain): add unified external brain controls"
```

### 任务 8：集成、验收并发布 Mac 与 Windows Desktop 0.3.8

**文件：**
- 修改：`apps/desktop/package.json`
- 修改：`apps/desktop/desktop.cordis.patch.yml`
- 修改：`apps/desktop/update-metadata.json`
- 修改：`apps/desktop/tests/manifest.spec.ts`
- 修改：`apps/desktop/tests/packaged-smoke.ts`
- 修改：`scripts/stage-desktop.ts`
- 修改：`scripts/windows-desktop-setup-smoke.ps1`
- 修改：`PROJECT_CONTEXT.md`
- 测试：`apps/desktop/tests/packaged-smoke.spec.ts`

- [ ] **步骤 1：编写失败的不可变组合和原生 smoke 断言**

```typescript
expect(desktop.version).toBe('0.3.8')
expect(desktop.dependencies['@deepseek-ai/dsh-missher-brain']).toBe('workspace:^')
expect(desktop.dependencies['dsh-missher-memory']).toMatch(/0\.2\.0\.tgz$/)
expect(desktop.dependencies['dsh-missher-evolution']).toMatch(/0\.1\.1\.tgz$/)
expect(compositionOrder).toEqual(['missher-brain', 'missher-memory', 'missher-evolution'])
```

打包 smoke 还必须断言：只有一次组合注入、没有重复 Provider 页面、可回滚胶囊固化、MSE 规则晋升、无 TencentDB 的全新安装、连接 fixture 数据库且 SHA-256 不变、干净退出/卸载，以及隔离状态保留。

- [ ] **步骤 2：运行 manifest 和 staging 测试并确认 RED**

运行：`pnpm exec vitest run apps/desktop/tests/manifest.spec.ts scripts/stage-desktop.spec.ts apps/desktop/tests/packaged-smoke.spec.ts`

预期：在版本 `0.3.7`、缺少 Brain/MSE 依赖、旧 Memory 版本和缺失 smoke 断言处失败。

- [ ] **步骤 3：固定规范插件包并组合 0.3.8**

每个公开插件包通过匿名字节验证后，才更新 `package.json` 和 lockfile。Brain 排在 Memory 与 Evolution 之前，为两个 Provider 开启受管 UI，保持 TencentDB 可选/只读，把 Desktop/更新元数据设为 `0.3.8`，并让 staging 在包版本、integrity 或预期文件不一致时拒绝构建。

- [ ] **步骤 4：运行源码、打包和原生 Release 门禁**

在 Intel macOS 本机运行：

```bash
pnpm test
pnpm run typecheck
pnpm run build:host
pnpm run build:client
pnpm run build:web
pnpm run doc-sync
pnpm desktop:dmg
pnpm exec vitest run apps/desktop/tests/packaged-smoke.spec.ts
hdiutil verify apps/desktop/release/DeepSeek-Harness-0.3.8-mac-x64.dmg
```

从准确公开 merge commit 运行 Windows `workflow_dispatch`。它必须构建可见的按用户 Setup、安装快捷方式、启动打包应用、操作“外置大脑”/记忆/固化/学习、验证只读 fixture 哈希和无目录全新安装、关闭后无孤儿进程、卸载，并保留隔离 `DSH_HOME` 与 Electron 数据。

- [ ] **步骤 5：提交、合并、安装并发布 0.3.8**

```bash
git add apps/desktop packages/brain scripts PROJECT_CONTEXT.md pnpm-lock.yaml
git commit -m "feat(desktop): ship local external brain 0.3.8"
```

推送 PR，要求所有 static/coverage/snapshot/native 检查，squash merge 并记录 merge SHA。从与 merge 等价的源码树重打 Mac，可恢复地替换 `/Applications/DeepSeek Harness.app`，并证明安装前后真实 `~/.dsh` 保留。创建 `desktop-v0.3.8`，上传 Mac DMG/checksum 和 Windows Setup/checksum，双方互不覆盖；随后重新查询 asset ID/state/size/digest，并匿名重下载所有资产验证 SHA-256 和逐字节一致。最后通过 docs-only 后续提交把证据写入 `PROJECT_CONTEXT.md`。

## 计划完成门禁

- [ ] Brain Hub `0.1.0`、MSE `0.1.1` 和 Memory `0.2.0` 是带校验和与原生消费者证据的不可变公开资产。
- [ ] 两个平台均安装 TencentDB 兼容代码，同时所有真实/fixture 数据库保持外置且逐字节不变。
- [ ] 只有已审核本地记忆被固化；来源可恢复；MSE 不接收召回或旧版内容。
- [ ] Mac Intel 和 Windows x64 包来自同一个公开 0.3.8 源码提交，并通过真实安装生命周期验收。
- [ ] 公开下载与已测试构件一致，替换/卸载应用保留用户数据。
