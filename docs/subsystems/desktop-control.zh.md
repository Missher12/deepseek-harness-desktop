# 桌面控制

[English](desktop-control.md) | 中文

桌面控制定义 Host 侧 Service Definition 与专用自有子进程 IPC provider，供后续适配器控制可见的 Agent 浏览器和用户授权的原生应用。它尚不提供 lease authority、浏览器调试器、原生 helper、UI 或模型工具实现。

源码：

- [`packages/control/desktop-control-protocol`](../../packages/control/desktop-control-protocol)
- [`packages/control/browser-control`](../../packages/control/browser-control)
- [`packages/control/computer-control`](../../packages/control/computer-control)
- [`packages/control/desktop-control-host`](../../packages/control/desktop-control-host)

## 协议归属

`@deepseek-ai/dsh-desktop-control-protocol` 是所有跨进程请求、结果、错误和品牌化标识的唯一所有者。其 27 种 bridge 清单包含仅供内部使用的 acquire／release。Acquire 保留每一组应用／窗口关系，只接受封闭的 surface 与 capability 清单，并只返回使用相对时长的生效描述符；helper install 复用这些 targets，再加入 Electron 所有的总量与分类 quota。Browser 与 Computer Service Definition 直接导入或重新导出这些类型；它们自身的类型只包含同进程的所有权与校验事实。

封闭协议不暴露 JavaScript、selector、命令、通用 payload 或原始操作系统逃逸口。可选 PNG 元数据只包含传输标识、字节长度、小写 SHA-256、宽度和高度；PNG 字节通过协议内独立且有界的二进制信封传输。Transport 所有的 JSON 校验器会在截图关联前运行，因此方向错误的有效消息会立即失败，不会打开 PNG pending 状态。

编码会在序列化前拒绝自定义 prototype、`toJSON`、accessor、不可枚举或 symbol key 状态，以及共享或循环值，再严格校验实际发出的 JSON frame。方向校验器只能接收这份分离的 JSON、不得返回数据；拒绝消息或返回任何内容都会永久关闭其 decoder。

## 自有子进程 Host bridge

Desktop 专用 `@deepseek-ai/dsh-desktop-control-host` 插件只在 Harness 进程拥有 Electron 创建的准确 Node IPC 通道时注册两项 service provider。一个进程级 client、lease cache、32 项 pending ledger、256 项 FIFO 终态 tombstone 集与 callback 驱动 envelope queue 同时服务两个 provider。Electron peer 拥有独立 ledger 与 queue。该 Node channel 上的每个 frame 都经过复制且没有前缀；JSON 与其可选的已验证 PNG 保持相邻，任一 peer 都不会依据 `send()` 不具权威性的布尔返回值推进。

Harness 到 Electron 接受全部 27 项 bridge request，另外只接受 request cancellation 与 session revocation。Electron 到 Harness 接受匹配 response，另外只接受其紧邻 PNG、lease revocation 与 parent shutdown。两个方向都在 image correlation 前完成验证，把工作绑定到准确子进程 generation，要求 ID／kind／session 与可选 lease tuple 匹配，并且在畸形、方向错误、不匹配或 transport 失败时只关闭 control link。

正常 turn stopping 会同步让缓存 lease 失效，并用独立 cleanup signal 等待有界 release。提交后的 `turn/end` listener 按设计是 fire-and-forget，只排入 fallback；可等待的 session flush 会 drain 该 tail。Session disposal 会排入 session revocation，插件／应用 teardown 则在断开准确 IPC link、终止自有进程树前 drain cleanup。在后续 Electron authority 安装前，请求会以 `NOT_SUPPORTED` 遇疑即拒；普通 Harness 启动与聊天不依赖该通道。

## 浏览器服务 seam

`ctx.browserControl` 先向受信 Consumer 提供内部 `acquireLease(request, signal)`，再捕获有界语义快照、执行十种封闭浏览器动作之一，并撤销某一会话的全部浏览器所有权。提供方持有的 opaque ref 会绑定官方会话 id、surface id、surface generation 和快照 revision。系统先拒绝外来会话，再披露目标是否仍然新鲜。

浏览器服务不提供坐标动作。页面文本与 accessibility 语义始终不受信任，不能授予审批，也不能证明敌意页面 JavaScript 不会产生外部副作用。

## 计算机服务 seam

`ctx.computerControl` 提供同一套协议所有的内部 lease acquire，报告平台支持、列出可授权的应用与窗口、捕获有界原生快照、执行八种封闭原生动作之一，并停止某一会话的原生控制。提供方持有的 opaque ref 会绑定会话、应用、进程 id 与创建身份、窗口、快照 revision 和显示缩放。

两个 acquire 操作都不是模型工具。后续工具 Consumer 会推导官方 session 与 transport 字段；其模型 schema 绝不会公开 acquire、lease authority、approval、quota、clock 或 action digest。

生成的文档会为受信第一方实现方保留两个服务约定，但面向模型的运行时 Cordis 目录与实时检查会排除它们；即便动态包声明了 inject，façade 也会拒绝属性与 `ctx.get()` 访问。普通静态第一方 Cordis 提供方与 Consumer 不受影响，同时模型编写的动态包无法取得 Desktop 控制权威。

纯策略只返回 `ALLOW`、`APPROVAL_REQUIRED` 或 `DENY`。未知运行时事实会 fail closed。已知安全字段以及特权或破坏性目标类别会被拒绝；外部副作用和持久 human browser 变更需要独立原生审批。正确 surface 的 Stop 始终无需审批，目标分类不能阻断撤销。

## 有界不可变结果

两个服务包都只接受原语运行时字段，按封闭字段重新构建协议结果，并返回完全分离且深冻结的对象。语义集合和文本使用协议拥有的限制。PNG 元数据严格从五个已校验字段重建，因此提供方本地对象或额外字段不能越过服务边界。每个 snapshot 服务返回严格的本地 envelope，其中包含协议 result，并且只在元数据声明图像时携带复制后的协议 `ImmutablePng`；服务 seam 不会公开原始字节数组字段。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxbrowsercontrol--browsercontrol-abstract-seam"></a>

### `ctx.browserControl` — `BrowserControl` (abstract seam)

Abstract semantic browser-control seam. A single Service Provider owns the visible surface, current reference registry, session revocation, and all browser-side cleanup.

```ts cordis-catalog
/**
 * Ask Electron main to authorize and mint one browser control lease.
 * This is an internal trusted-provider operation and never a model tool.
 * @param request - Protocol-owned request with official session and transport fields.
 * @param signal - Caller lifetime.
 * @returns the effective Electron-authored lease descriptor.
 */
abstract acquireLease( request: ControlLeaseAcquireRequest, signal: AbortSignal, ): Promise<ControlLeaseAcquireResult>

/**
 * Capture bounded semantics and an optional image for the current browser surface.
 * @param request - Strict protocol request received from the Desktop bridge.
 * @param signal - Caller lifetime.
 * @returns an immutable service envelope whose result and PNG owner remain paired.
 */
abstract snapshot(request: BrowserSnapshotRequest, signal: AbortSignal): Promise<BrowserSnapshotEnvelope>

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
 * Ask Electron main to authorize and mint one native-application control lease.
 * This is an internal trusted-provider operation and never a model tool.
 * @param request - Protocol-owned request with official session and transport fields.
 * @param signal - Caller lifetime.
 * @returns the effective Electron-authored lease descriptor.
 */
abstract acquireLease( request: ControlLeaseAcquireRequest, signal: AbortSignal, ): Promise<ControlLeaseAcquireResult>

/**
 * Read the bounded local platform support and permission snapshot.
 * @param sessionId - Official live Harness session requesting the snapshot.
 * @returns current platform support and permission states.
 */
abstract status(sessionId: SessionId): Promise<ComputerControlStatus>

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
 * @returns an immutable service envelope whose result and PNG owner remain paired.
 */
abstract snapshot(request: ComputerSnapshotRequest, signal: AbortSignal): Promise<ComputerSnapshotEnvelope>

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
