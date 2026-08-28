# 桌面控制

[English](desktop-control.md) | 中文

桌面控制定义 Host 侧 Service Definition，供后续适配器控制可见的 Agent 浏览器和用户授权的原生应用。它本身不提供 Electron、浏览器调试器、原生 helper、UI 或模型工具实现。

源码：

- [`packages/control/desktop-control-protocol`](../../packages/control/desktop-control-protocol)
- [`packages/control/browser-control`](../../packages/control/browser-control)
- [`packages/control/computer-control`](../../packages/control/computer-control)

## 协议归属

`@deepseek-ai/dsh-desktop-control-protocol` 是所有跨进程请求、结果、错误和品牌化标识的唯一所有者。Browser 与 Computer Service Definition 直接导入或重新导出这些类型；它们自身的类型只包含同进程的所有权与校验事实。

封闭协议不暴露 JavaScript、selector、命令、通用 payload 或原始操作系统逃逸口。可选 PNG 元数据只包含传输标识、字节长度、小写 SHA-256、宽度和高度；PNG 字节通过协议内独立且有界的二进制信封传输。

## 浏览器服务 seam

`ctx.browserControl` 捕获有界语义快照、执行十种封闭浏览器动作之一，并撤销某一会话的全部浏览器所有权。提供方持有的 opaque ref 会绑定官方会话 id、surface id、surface generation 和快照 revision。系统先拒绝外来会话，再披露目标是否仍然新鲜。

浏览器服务不提供坐标动作。页面文本与 accessibility 语义始终不受信任，不能授予审批，也不能证明敌意页面 JavaScript 不会产生外部副作用。

## 计算机服务 seam

`ctx.computerControl` 报告平台支持、列出可授权的应用与窗口、捕获有界原生快照、执行八种封闭原生动作之一，并停止某一会话的原生控制。提供方持有的 opaque ref 会绑定会话、应用、进程 id 与创建身份、窗口、快照 revision 和显示缩放。

纯策略只返回 `ALLOW`、`APPROVAL_REQUIRED` 或 `DENY`。未知运行时事实会 fail closed。已知安全字段以及特权或破坏性目标类别会被拒绝；外部副作用和持久 human browser 变更需要独立原生审批。正确 surface 的 Stop 始终无需审批，目标分类不能阻断撤销。

## 有界不可变结果

两个服务包都只接受原语运行时字段，按封闭字段重新构建协议结果，并返回完全分离且深冻结的对象。语义集合和文本使用协议拥有的限制。PNG 元数据严格从五个已校验字段重建，因此提供方本地对象或额外字段不能越过服务边界。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxbrowsercontrol--browsercontrol-abstract-seam"></a>

### `ctx.browserControl` — `BrowserControl` (abstract seam)

Abstract semantic browser-control seam. A single Service Provider owns the visible surface, current reference registry, session revocation, and all browser-side cleanup.

```ts cordis-catalog
/**
 * Capture bounded semantics and an optional image for the current browser surface.
 * @param request - Strict protocol request received from the Desktop bridge.
 * @param signal - Caller lifetime.
 * @returns an immutable bounded protocol snapshot.
 */
abstract snapshot(request: BrowserSnapshotRequest, signal: AbortSignal): Promise<BrowserSnapshot>

/**
 * Execute one action from the closed browser request roster.
 * @param request - Strict protocol action DTO.
 * @param signal - Caller lifetime.
 * @returns the protocol result associated with the action family.
 */
abstract act(request: BrowserActionRequest, signal: AbortSignal): Promise<BrowserActionResult>

/**
 * Revoke a session's browser ownership and await complete surface cleanup.
 * @param sessionId - Official Harness session identity to revoke.
 */
abstract revokeSession(sessionId: SessionId): Promise<void>
```

Types: [SessionId](core.zh.md)

Source: [`packages/control/browser-control/src/index.ts`](../../packages/control/browser-control/src/index.ts)

<a id="ctxcomputercontrol--computercontrol-abstract-seam"></a>

### `ctx.computerControl` — `ComputerControl` (abstract seam)

Abstract native Computer Control seam. A single Service Provider owns authorization, app/window identity, reference freshness, stop, and native resource cleanup.

```ts cordis-catalog
/**
 * Read the bounded local platform support and permission snapshot.
 * @returns current platform support and permission states.
 */
abstract status(): Promise<ComputerControlStatus>

/**
 * List only applications and windows eligible for an explicit user grant.
 * @param request - Strict protocol list request.
 * @param signal - Caller lifetime.
 * @returns an immutable bounded protocol collection.
 */
abstract list(request: ComputerListRequest, signal: AbortSignal): Promise<ComputerListResult>

/**
 * Capture bounded semantics and an optional image for one authorized window.
 * @param request - Strict target-scoped protocol request.
 * @param signal - Caller lifetime.
 * @returns an immutable bounded protocol snapshot.
 */
abstract snapshot(request: ComputerSnapshotRequest, signal: AbortSignal): Promise<ComputerSnapshot>

/**
 * Execute one action from the closed native request roster.
 * @param request - Strict target-scoped protocol action DTO.
 * @param signal - Caller lifetime.
 * @returns the protocol result associated with the action family.
 */
abstract act(request: ComputerActionRequest, signal: AbortSignal): Promise<ComputerActionResult>

/**
 * Stop a session's native control and await release of its native resources.
 * @param sessionId - Official Harness session identity to stop.
 */
abstract stop(sessionId: SessionId): Promise<void>
```

Types: [SessionId](core.zh.md)

Source: [`packages/control/computer-control/src/index.ts`](../../packages/control/computer-control/src/index.ts)
<!-- END GENERATED cordis-surface -->
