# Agent Note: 语义浏览器适配器的所有权与安全边界

Status: implemented

[English](2026-08-28-semantic-browser-adapter-ownership.md) | 中文

## 问题

模型驱动的浏览器控制需要提供有用的页面语义，同时不能让 Electron renderer、debugger、已登录浏览器状态或网络访问变成通用权限。浏览器页面不受信任，而 debugger 附加、导航、无障碍树变更与销毁都可能和每项异步观察或输入操作发生竞态。

人工 Workbench 浏览器已经拥有持久化的已登录 partition。如果 Agent（智能体）工作隐式复用该 partition，会混合会话所有权与凭据；如果独立 Agent 浏览器表层没有进程级所有者，不同会话又可能同时显示、隐藏或更改彼此的浏览器。

语义树与截图也是由攻击者影响的数据。不受限的遍历、任意 CDP（Chrome DevTools Protocol）、可编辑值、私有网络目标、原生文件选择器、下载、权限或整页捕获都会让信息和动作范围超出固定的 Browser Control 约定。

## 决策

Desktop 浏览器层把全局表层所有权、页面策略与封闭的 CDP 适配器分别放在 [`surface-manager.ts`](../../../../apps/desktop/src/browser/surface-manager.ts)、[`policy.ts`](../../../../apps/desktop/src/browser/policy.ts) 和 [`cdp-adapter.ts`](../../../../apps/desktop/src/browser/cdp-adapter.ts)。[`contracts.ts`](../../../../apps/desktop/src/browser/contracts.ts) 负责动作校验器、不透明 ref 形状、partition 名称、快照 envelope、结构化失败与固定资源边界。这些文件只导出窄化的 Electron 接口，不注册模型工具，也不改变 main、preload 或 renderer 组合。

## 所有权与生命周期

单个 `BrowserSurfaceManager` 实例拥有进程级唯一 Agent 浏览器位置。acquire 输入携带由受信任提供方得出的官方会话。首次调用会原子保留该会话，并且只会消费 coordinator 已验证、精确指向 `persist:dsh-workbench-browser` 实例的 Give intent；否则，它会创建具备唯一名称的非持久化表层，并在返回前完成可见挂载。只有携带精确会话与 generation 的调用才能复用活动表层；另一个会话只会收到 `BUSY`，不会消费新 intent，也不会对所有者调用 mount、hide 或 teardown。

每次 mount 都有 generation 与 mount token。陈旧的 hide 和 Stop token 不产生影响，清理失败时仍以封闭失败方式保留所有者，不会接纳替代者。Stop 按顺序尝试属于该 generation 的 handler dispose、debugger detach、view teardown、临时存储清理与 coordinator revoke；即使其中一步失败，也会等待所有步骤，并且只在整个序列达到完全停稳（quiescence）后释放所有权。被转移的人工持久化表层绝不会清理存储；临时 Agent partition 始终不同于 Workbench partition。

表层资源会在 mount 前安装 popup、导航、下载与权限防护。防护会拒绝所有新窗口、取消下载，并让 permission check 与 permission request 两条路径拒绝所有权限，包括相机、麦克风、位置与剪贴板访问。handler registration 按身份分层，因此陈旧 dispose 无法移除较新的 generation。适配器会在每次自有 debugger 附加时启用 `Page.setInterceptFileChooserDialog`，并且不暴露任何设置文件的操作。

## CDP 与引用边界

`CdpBrowserAdapter` 会先对已经附加或在附加竞态中胜出的外部 debugger 返回 `BUSY`；它只在自己成功附加后记录 `attachedByUs`，也只在此状态下执行 detach。主文档导航、同文档导航、表层销毁、debugger detach、`Accessibility.nodesUpdated` 与 `DOM.documentUpdated` 都会推进适配器 epoch 和 revision、清除所有 ref，并让每个延迟完成的 CDP 调用无法通过 await 后的 epoch 复检。

CDP 方法闭集仅包含 `Accessibility.getRootAXNode`、有界广度优先的 `Accessibility.getChildAXNodes`、只读 `DOM.describeNode`、`DOM.getBoxModel`、固定的 `Input.dispatchMouseEvent`、`Input.dispatchKeyEvent` 与 `Input.insertText`、可见 viewport 的 `Page.captureScreenshot`，以及文件选择器拦截。`DOM.describeNode` 只贡献 `type`、`autocomplete`、`disabled` 与 `readonly`。系统不暴露任何 `Runtime` 方法、JavaScript 求值、selector、任意 CDP dispatch、remote-debugging port、坐标动作或文件设置路径。

遍历会在 2,000 个原始节点、32 层深度、512 次 CDP 调用或 2,000 ms 时停止。投影最多保留 300 个可动作 ref、49,152 个 UTF-8 语义字节与 65,536 字节的编码 JSON 结果。ref 会绑定表层 generation、适配器 revision、AX identity、后端 DOM identity 与 registry 位置。快照不包含可编辑值；策略会在 ref 进入 registry 前拒绝密码、一次性验证码、支付、文件、上传、disabled、readonly 与敏感性不确定的可编辑目标。

动作校验器只接受 navigate、基于 ref 的 click 和 type、有界 key chord、基于 ref 的 select、有界 viewport 或基于 ref 的 scroll、有界 duration/navigation/loading-idle wait、历史导航、reload，以及外围生命周期中的 Stop。浏览器输入只会在解析当前 ref 后计算内部 box center；调用方无法提供 selector 或坐标。

## 网络与截图策略

`AgentBrowserUrlPolicy` 只接受没有 userinfo 的 HTTP(S) URL。它会校验字面与解析后的目标，包括 IPv4-mapped IPv6，并且拒绝 loopback、link-local、private、carrier-grade NAT、site-local、unspecified、multicast、格式错误的解析器输出与 localhost 保留名称，除非用户拥有的 allowlist 明确允许精确目标。适配器会先取消页面驱动的导航与每一跳 redirect，再独立授权并发起下一跳；页面文本不能改变 allowlist。

截图只覆盖可见 viewport，并设置 `captureBeyondViewport: false`。适配器会在捕获前确定性选择不大于 1 的 scale，确保预期输出的任一边都不超过 2,048 像素，面积也不超过 4,194,304 像素。编码过大时会按几何比例降低 scale，总尝试次数最多为 3，并且不会分配无界的解码 buffer。交付的图片必须先通过规范 base64 解码、PNG signature 与 IHDR 校验、精确缩放尺寸、4,194,304 字节与像素边界、UUID transfer ID 校验和 SHA-256 计算，之后 metadata 与分离的 PNG 字节才能进入保持配对的快照 envelope。

## 验证

[`browser-agent.spec.ts`](../../../../apps/desktop/tests/browser-agent.spec.ts)、[`browser-policy.spec.ts`](../../../../apps/desktop/tests/browser-policy.spec.ts) 与 [`browser-contracts.spec.ts`](../../../../apps/desktop/tests/browser-contracts.spec.ts) 使用 fake debugger、WebContents、Session 与表层资源。focused suite 固定了附加所有权与竞态、延迟响应与 ref 失效、所有资源边界、敏感目标省略、CDP 和动作闭集、截图缩减与校验、URL 与页面策略、会话原子所有权、陈旧 token、持久化转移、失败清理与 revoke。三个 spec 共 53 个测试通过；Desktop package 的 `tsc --noEmit` 通过，实现与测试的仓库 scoped oxlint 也通过。

## 备选方案

**机会式附加，并在 Stop 时始终执行 detach。** 这样 Agent 清理可能断开开发者或其他子系统拥有的 debugger。当前实现显式记录所有权，并让 detach 取决于 `attachedByUs`。

**使用 `Runtime`、JavaScript 求值或 selector 获得更丰富的交互。** 这些机制会形成通用的页面执行与提取通道，其权限无法由固定 Browser Control 动作闭集表达。无障碍语义与不透明 ref 有意牺牲覆盖范围，以换取可评审的封闭边界。

**让每个 Agent 会话复用已登录 Workbench partition。** 自动复用会在没有验证转移的情况下暴露人工 cookie 与存储，也会使会话隔离含糊。除非 coordinator 消费了显式指向可见持久化实例的 Give intent，否则 Agent 工作会获得唯一的非持久化 partition。

**捕获整页，或把截图坐标暴露为 fallback。** 整页捕获具有由页面控制的 geometry，而坐标 fallback 会把图像观察变成不受限的 pointer 权限。适配器保持 viewport 捕获有界，并让浏览器动作维持语义化。

**清理尝试失败后释放全局所有权。** 当 debugger、view、storage 或 revoke 状态不确定时接纳替代者，可能产生两个有效所有者。清理过程会尝试每个步骤，但仍把失败的 generation 保持为 busy，直到进程所有者解决失败。

## 影响

浏览器适配器具有小而可审计的权限边界：一个受信任会话拥有一个可见表层；每个页面派生 ref 都会在实质变更时失效；所有输入都来自固定闭集；网络、权限、文件、遍历、JSON 与图片边界都会封闭失败。除非 coordinator 验证显式转移，否则人工 Workbench 浏览器会保留其持久化 partition 与既有行为。

同一边界有意放弃任意 Web 自动化。缺少可用无障碍语义的页面控件、无法确认敏感性的字段、没有显式 allowlist 的私有目标、popup、下载、上传与依赖权限的工作流都不受支持。真实 Electron 组合会通过这些窄接口提供 manager resource 与 authority coordinator；本层自身不改变普通 CLI 或 Web 启动，也不通过 UI 或工具暴露 Browser Control。
