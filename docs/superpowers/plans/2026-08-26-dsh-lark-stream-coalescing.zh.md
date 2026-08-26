# `dsh-lark` 流更新合并实施计划

[English](2026-08-26-dsh-lark-stream-coalescing.md) | 中文

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 用最新状态合并替代逐分片串行飞书卡片写入，保证最终状态及时送达，并移除未使用的跨包 Session 解析器改动。

**架构：** `TurnCardStream` 持有一个最新投影、一个计时器和一个在途写入。非最终调用只调度而不等待；最终调用取消计时器，并在最多一个已有请求后排空最新状态。除删除未使用的 `session-messenger` 新增内容外，修改都保留在可移除的 Lark Bundle 内。

**技术栈：** TypeScript、Cordis、Vitest 假计时器、飞书 `im.message.patch`、pnpm workspace 工具。

---

### 任务 1：记录已确认设计

**文件：**
- 新建：`docs/superpowers/specs/2026-08-26-dsh-lark-stream-coalescing-design.md`
- 新建：`docs/superpowers/specs/2026-08-26-dsh-lark-stream-coalescing-design.zh.md`
- 新建：`docs/superpowers/specs/2026-08-26-dsh-lark-stream-coalescing-design.i18n.yaml`

- [ ] **步骤 1：确认设计覆盖已量化故障**

要求规格说明包含当前 100 分片/101 次写入/35 秒复现、`im.message.patch` 限流约束、最新状态合并、最终状态优先、停用取消、降级行为和精确的包隔离范围。

- [ ] **步骤 2：记录并验证双语配对**

运行：

```bash
pnpm run verify-translation-pairing --write docs/superpowers/specs/2026-08-26-dsh-lark-stream-coalescing-design.md
pnpm run verify-translation-pairing docs/superpowers/specs/2026-08-26-dsh-lark-stream-coalescing-design.md
```

预期：写入一条记录，并报告指定配对一致。

### 任务 2：添加失败的调度器测试

**文件：**
- 修改：`packages/extensions/lark/tests/cards.host.spec.ts`

- [ ] **步骤 1：用突发更新合并替代串行写入预期**

使用 Vitest 假计时器，并在不推进时间的情况下提交多个更新：

```ts
import { expect, vi } from 'vitest'

interface Stream {
  update(next: unknown, final?: boolean): Promise<void>
}

interface Controller {
  open(chatId: string, initial: unknown): Promise<Stream>
}

type StateFactory = (text: string, status?: 'placeholder' | 'streaming' | 'completed') => unknown

async function verifyBurst(
  controller: Controller,
  updateCard: ReturnType<typeof vi.fn>,
  state: StateFactory,
): Promise<void> {
  vi.useFakeTimers()
  vi.setSystemTime(1_000)
  const stream = await controller.open('oc_dm', state('', 'placeholder'))
  await stream.update(state('H'))
  await stream.update(state('He'))
  await stream.update(state('Hello'))
  expect(updateCard).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(100)
  expect(updateCard).toHaveBeenCalledOnce()
  expect(JSON.stringify(updateCard.mock.calls[0]![1])).toContain('Hello')
}

void verifyBurst
```

- [ ] **步骤 2：证明最终状态最多只等待一个在途请求**

让第一次写入保持未结算，提交更新文字和终态，再释放第一次写入：

```ts
import { expect, vi } from 'vitest'

interface Stream {
  update(next: unknown, final?: boolean): Promise<void>
}

type StateFactory = (text: string, status?: 'streaming' | 'completed') => unknown
type CreateStream = (updateCard: ReturnType<typeof vi.fn>) => Promise<Stream>

async function verifyFinalPriority(createStream: CreateStream, state: StateFactory): Promise<void> {
let releaseFirst!: () => void
const updateCard = vi.fn()
  .mockImplementationOnce(() => new Promise<void>(resolve => { releaseFirst = resolve }))
  .mockResolvedValue(undefined)
const stream = await createStream(updateCard)
await stream.update(state('A'))
await vi.advanceTimersByTimeAsync(100)
await stream.update(state('AB'))
const final = stream.update(state('ABC', 'completed'), true)
expect(updateCard).toHaveBeenCalledTimes(1)
releaseFirst()
await final
expect(updateCard).toHaveBeenCalledTimes(2)
expect(JSON.stringify(updateCard.mock.calls[1]![1])).toContain('ABC')
}

void verifyFinalPriority
```

- [ ] **步骤 3：固定生命周期和失败行为**

添加测试，证明 `stop()` 会取消待触发计时器、缩短文字仍会被忽略、文字相同的运行时修订仍会被接受，并且一次卡片请求失败后，即使继续收到更新也最多发送一次有界降级回复。

- [ ] **步骤 4：运行聚焦测试并观察 RED**

运行：

```bash
pnpm exec vitest run packages/extensions/lark/tests/cards.host.spec.ts
```

预期：新的合并和最终优先测试失败，因为当前 promise 尾链会为每个更新执行一次写入，而且没有 `stop()` 方法。

### 任务 3：实现最新状态调度器

**文件：**
- 修改：`packages/extensions/lark/src/cards.ts`
- 修改：`packages/extensions/lark/src/index.ts`
- 修改：`packages/extensions/lark/src/config.ts`

- [ ] **步骤 1：用显式持有状态替换 promise 尾链**

`TurnCardStream` 必须持有以下字段，不得保存投影修订队列：

```ts
interface TurnProjectionState {}

class TurnCardStreamState {
  private current!: TurnProjectionState
  private lastFlush = 0
  private failed = false
  private stopped = false
  private dirty = false
  private finalRequested = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private inFlight: Promise<void> | undefined
  private finalPromise: Promise<void> | undefined
  private resolveFinal: (() => void) | undefined
}
```

在保留可注入时钟的同时，为已解析选项增加可注入计时器函数：

```ts
interface StreamingCardTimerOptions {
  setTimer?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void
}
```

- [ ] **步骤 2：让非最终更新合并**

`update(next, false)` 校验单调前缀，把 `next` 克隆到 `current`，设置 `dirty`，调用非阻塞 `pump()`，并返回 `Promise.resolve()`。`pump()` 在已停止、已失败、已有在途请求或已有计时器时不启动工作；否则在节流窗口开放时立即写入，或只为剩余间隔设置一个计时器。

- [ ] **步骤 3：让最终更新立即排空**

`update(next, true)` 设置 `finalRequested`，取消计时器，创建一个最终 promise，并调用 `pump()`。最终状态的 `pump()` 绕过节流。在一个在途请求期间状态发生变化时，其完成回调会立即执行第二次写入；只有没有 dirty 状态后才结算最终 promise。

- [ ] **步骤 4：收敛失败并持有停用生命周期**

第一次 `updateCard` 拒绝时，设置 `failed`、取消计时器，并尝试从最新状态发送一次有界 `sendText`。只吞掉这次有界降级自身的失败，避免它终止共享 mux。实现：

```ts
class StoppableTurnCardStream {
  private stopped = false
  private dirty = false

  stop(): void {
    this.stopped = true
    this.dirty = false
    this.cancelTimer()
    this.settleFinal()
  }

  private cancelTimer(): void {}
  private settleFinal(): void {}
}
```

在 `mux.stop` 中，对每个活动轮次调用 `active.stream.stop()`，然后再执行 `activeTurns.clear()`。

- [ ] **步骤 5：运行聚焦测试并观察 GREEN**

运行：

```bash
pnpm exec vitest run packages/extensions/lark/tests/cards.host.spec.ts
```

预期：全部卡片测试通过且没有未处理拒绝；突发更新只产生有界写入，最终卡片包含最新状态。

### 任务 4：收紧插件隔离并记录已交付决策

**文件：**
- 修改：`packages/extensions/session-messenger/src/target-resolver.ts`
- 修改：`packages/extensions/session-messenger/tests/target-resolver.client.spec.ts`
- 修改：`packages/extensions/lark/README.md`
- 修改：`packages/extensions/lark/README.zh.md`
- 修改：`packages/extensions/lark/README.i18n.yaml`
- 修改：`packages/extensions/lark/LICENSE`
- 修改：`PROJECT_CONTEXT.md`
- 新建：`.agents/notes/implemented/bug-fix/2026-08-26-lark-stream-coalescing.md`
- 新建：`.agents/notes/implemented/bug-fix/2026-08-26-lark-stream-coalescing.zh.md`
- 新建：`.agents/notes/implemented/bug-fix/2026-08-26-lark-stream-coalescing.i18n.yaml`

- [ ] **步骤 1：移除未使用的跨包新增内容**

只删除 `assertOrdinarySession()`、`resolveOrdinarySession()` 及其导入和测试，并把 `resolveOrdinaryTargetForSource()` 恢复为 merge-base 实现。保留 Lark 对既有公开解析器的使用，以及可安装 Bundle 所需的全部包注册。

- [ ] **步骤 2：更新包行为和署名**

README 必须说明中间投影会在可配置间隔内合并、终态会绕过待触发计时器，而且停用会取消计时器。在双语 README 和第三方声明中，把“串行卡片刷新模式”替换为“合并式卡片刷新调度器”。

- [ ] **步骤 3：记录决策与项目状态**

已实现 Agent Note 必须包含 `Problem`、`Decision`、`Alternatives considered`、`Verification` 和 `Consequences`，并记录限流权衡以及 Harness 核心和 Session 持久化不变的否定保证。更新 `PROJECT_CONTEXT.md` 中的 Lark 段落，写明最新状态合并和最终优先。

- [ ] **步骤 4：记录双语配对**

运行：

```bash
pnpm run verify-translation-pairing --write packages/extensions/lark/README.md
pnpm run verify-translation-pairing --write .agents/notes/implemented/bug-fix/2026-08-26-lark-stream-coalescing.md
pnpm run verify-translation-pairing --write docs/superpowers/plans/2026-08-26-dsh-lark-stream-coalescing.md
```

预期：写入全部三条记录，且范围内配对检查通过。

- [ ] **步骤 5：提交源码修复**

运行：

```bash
git add packages/extensions/lark packages/extensions/session-messenger/src/target-resolver.ts packages/extensions/session-messenger/tests/target-resolver.client.spec.ts docs/superpowers .agents/notes/implemented/bug-fix PROJECT_CONTEXT.md
git commit -m "fix(lark): coalesce streamed card updates"
```

预期：一个提交包含调度器、聚焦测试、隔离清理和当前文档。

### 任务 5：验证、安装并推送

**文件：**
- 新建：`artifacts/deepseek-ai-dsh-lark-0.1.1-rc.2-coalesced-20260826.tgz`

- [ ] **步骤 1：运行与改动成比例的源码检查**

运行：

```bash
pnpm exec vitest run packages/extensions/lark/tests packages/extensions/session-messenger/tests/target-resolver.client.spec.ts
pnpm run typecheck
pnpm --filter @deepseek-ai/dsh-lark bundle
pnpm run doc-sync
git diff --check
```

预期：全部相关测试、类型检查、包构建、文档门禁和空白检查通过。

- [ ] **步骤 2：打包唯一名称产物并核对字节**

打包该包，以短提交后缀重命名 tarball，计算 SHA-256，检查归档条目清单，并确认其中不存在凭据或实时状态文件。

- [ ] **步骤 3：只刷新可移除的实时 Profile Bundle**

保留现有 `~/.dsh/profiles/web` 的凭据、配对、绑定和队列状态。使用唯一绝对 tarball 路径运行 `dsh plugin --profile web add`，重启 Harness，然后在不打印标识符或密钥的前提下验证启用/连接/配对/绑定状态、队列深度、已安装包版本和已安装包 hash。

- [ ] **步骤 4：推送 Git**

运行：

```bash
git push origin codex/dsh-lark-desktop-compat
```

预期：远端分支推进到已验证提交，不修改其他 worktree 或 Desktop 核心包。
