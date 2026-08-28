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

每次 mount 都有 generation 与 mount token。陈旧的 hide 和 Stop token 不产生影响，清理失败时仍以封闭失败方式保留所有者，不会接纳替代者。Stop 按顺序尝试属于该 generation 的 handler dispose、debugger detach、view teardown、临时存储清理与 coordinator revoke；即使其中一步失败，也会等待所有步骤，并且只在整个序列达到完全停稳（quiescence）后释放所有权。在发布前 mount 失败时遵循同一规则：所有清理步骤都会执行，失败步骤仍绑定未发布的 session 与 generation，所有 acquire 保持 `BUSY`，只有携带精确身份的生命周期重试在这些步骤成功后才能释放位置。被转移的人工持久化表层绝不会清理存储；临时 Agent partition 始终不同于 Workbench partition。

表层资源会在 mount 前安装 popup、导航、下载与权限防护。防护会拒绝所有新窗口、取消下载，并让 permission check 与 permission request 两条路径拒绝所有权限，包括相机、麦克风、位置与剪贴板访问。长期存在的 main-process handler owner 只安装一次 Electron 的 window-open 与 permission 单槽 dispatcher，把既有人工 handler 保留为基础层，并在不把这些槽写回 `null` 的前提下添加或移除 Agent generation；陈旧 dispose 无法移除较新 generation，也无法移除下面的人工行为。既有事件 listener 同样保持原位，每个 generation 只移除自己安装的导航与下载 listener。适配器会在每次自有 debugger 附加时启用 `Page.setInterceptFileChooserDialog`，在 detach 该自有 debugger 前将其关闭，并且不暴露任何设置文件的操作。

## CDP 与引用边界

`CdpBrowserAdapter` 会先对已经附加或在附加竞态中胜出的外部 debugger 返回 `BUSY`；它只在自己成功附加后记录 `attachedByUs`，也只在此状态下执行 detach。主文档导航、同文档导航、表层销毁、debugger detach、`Accessibility.nodesUpdated` 与 `DOM.documentUpdated` 都会推进适配器 epoch 和 revision、清除所有 ref，并让每个延迟完成的 CDP 调用无法通过 await 后的 epoch 复检。

CDP 方法闭集仅包含 `Accessibility.getRootAXNode`、有界广度优先的 `Accessibility.getChildAXNodes`、只读 `DOM.describeNode`、`DOM.getBoxModel`、固定的 `Input.dispatchMouseEvent`、`Input.dispatchKeyEvent` 与 `Input.insertText`、可见 viewport 的 `Page.captureScreenshot`，以及文件选择器拦截。`DOM.describeNode` 只贡献 `type`、`autocomplete`、`disabled` 与 `readonly`。系统不暴露任何 `Runtime` 方法、JavaScript 求值、selector、任意 CDP dispatch、remote-debugging port、坐标动作或文件设置路径。

遍历会在 2,000 个原始节点、32 层深度、512 次 CDP 调用或 2,000 ms 时停止。投影最多保留 300 个可动作 ref、49,152 个 UTF-8 语义字节与 65,536 字节的编码 JSON 结果。ref 会绑定表层 generation、适配器 revision、AX identity、后端 DOM identity 与 registry 位置。快照不包含可编辑值；策略会在 ref 进入 registry 前拒绝密码、一次性验证码、支付、文件、上传、disabled、readonly 与敏感性不确定的可编辑目标。在每个基于 ref 的变更动作执行前，适配器会再次完成有界 AX 读取与 `DOM.describeNode`，根据实时 role、name、editability、type、autocomplete、disabled 与 readonly 重新分类；一旦目标变得敏感，或 AX identity／语义发生变化，就会在发出任何 `Input` 命令前拒绝。type 与 select 会拆分为多段受检步骤：click 后重新读取 AX 与 DOM，要求有且仅有一个带后端节点身份的 focused 节点且必须与 ref 相同，并在 `Input.insertText` 前再次检查敏感性与可编辑性；select 还会在插入文本之后、发出 Enter 之前再次执行相同的焦点身份与策略检查。

动作校验器只接受 navigate、基于 ref 的 click 和 type、有界 key chord、基于 ref 的 select、有界 viewport 或基于 ref 的 scroll、有界 duration/navigation/loading-idle wait、历史导航、reload，以及外围生命周期中的 Stop。浏览器输入只会在解析当前 ref 后计算内部 box center；调用方无法提供 selector 或坐标。

## 网络与截图策略

`AgentBrowserUrlPolicy` 只接受没有 userinfo 的 HTTP(S) URL。它没有 Node DNS fallback：组合层必须适配拥有该表层的精确 Electron `Session` 的 `resolveHost()`。策略会校验字面与解析后的目标，包括 IPv4-mapped IPv6，并且拒绝 loopback、link-local、private、carrier-grade NAT、site-local、unspecified、multicast、格式错误的解析器输出与 localhost 保留名称，除非用户拥有的 allowlist 明确允许精确目标。适配器会先取消页面驱动的导航与每一跳 redirect，再独立授权下一跳；页面文本不能改变 allowlist。

先检查一次 DNS 结果再调用普通 `loadURL()` 并不能防御 rebinding，因为 Chromium 仍可能在连接前再次解析。public IP literal 经策略校验后保留直接加载；hostname 则必须使用属于该表层的 pinned-navigation transport。navigate、back、forward 与 reload 都会先取得并授权其精确目标 URL，再把对应的一次性原生 commit 交给同一 transport；只有完成 request-time 校验后才能执行 commit，并且 transport 返回或失败后的延迟 commit 会被拒绝。在 history 或 reload commit 之前，适配器还会在没有中间 await 的情况下重新检查导航 revision 与当前 URL；history 移动还要求原 active index，以及活动／目标 entry 的精确 URL、title 与 Chromium page state 全部保持不变。注入的 Task 8 transport contract 会获得 request-time `resolveAndValidate` 能力，并且必须对初始、redirect 与 subresource 的每次 CONNECT 使用该能力，只把 socket 连接到返回的某个 public address，同时保留原 URL hostname 供 HTTP Host、HTTPS SNI 与证书校验使用。没有该 transport 时，每条 hostname 导航路径都会封闭失败且绝不回退到 `loadURL` 或原生 history／reload；Task 7 不会用 `webRequest` 或 URL-to-IP 重写伪装成地址固定。

截图只覆盖可见 viewport，并设置 `captureBeyondViewport: false`。适配器会在捕获前确定性选择不大于 1 的 scale，确保预期输出的任一边都不超过 2,048 像素，面积也不超过 4,194,304 像素。编码过大时会按几何比例降低 scale，总尝试次数最多为 3，并且不会分配无界的解码 buffer。交付的图片必须先通过规范 base64 解码、PNG signature 与 IHDR 校验、精确缩放尺寸、4,194,304 字节与像素边界、UUID transfer ID 校验和 SHA-256 计算，之后 metadata 与分离的 PNG 字节才能进入保持配对的快照 envelope。

## 验证

[`browser-agent.spec.ts`](../../../../apps/desktop/tests/browser-agent.spec.ts)、[`browser-policy.spec.ts`](../../../../apps/desktop/tests/browser-policy.spec.ts) 与 [`browser-contracts.spec.ts`](../../../../apps/desktop/tests/browser-contracts.spec.ts) 使用 fake debugger、WebContents、Session 与表层资源。focused suite 固定了附加所有权与竞态、延迟响应与 ref 失效、所有资源边界、snapshot-to-action 敏感性变化、click 时的焦点重定向、CDP 和动作闭集、截图缩减与校验、直接及 history／reload 路径中的 public-to-private DNS rebinding 且不 load／connect、deferred transport 期间 history／reload 漂移且不原生提交、稳定恢复人工 handler、会话原子所有权、陈旧 token、持久化转移、反复失败的 mount-cleanup reservation 与精确 generation 生命周期重试，以及 revoke。三个 spec 共 77 个测试通过；Desktop package 的 `tsc --noEmit` 通过，实现与测试的仓库 scoped oxlint 也通过。

## 备选方案

**机会式附加，并在 Stop 时始终执行 detach。** 这样 Agent 清理可能断开开发者或其他子系统拥有的 debugger。当前实现显式记录所有权，并让 detach 取决于 `attachedByUs`。

**使用 `Runtime`、JavaScript 求值或 selector 获得更丰富的交互。** 这些机制会形成通用的页面执行与提取通道，其权限无法由固定 Browser Control 动作闭集表达。无障碍语义与不透明 ref 有意牺牲覆盖范围，以换取可评审的封闭边界。

**让每个 Agent 会话复用已登录 Workbench partition。** 自动复用会在没有验证转移的情况下暴露人工 cookie 与存储，也会使会话隔离含糊。除非 coordinator 消费了显式指向可见持久化实例的 Give intent，否则 Agent 工作会获得唯一的非持久化 partition。

**捕获整页，或把截图坐标暴露为 fallback。** 整页捕获具有由页面控制的 geometry，而坐标 fallback 会把图像观察变成不受限的 pointer 权限。适配器保持 viewport 捕获有界，并让浏览器动作维持语义化。

**清理尝试失败后释放全局所有权。** 当 debugger、view、storage 或 revoke 状态不确定时接纳替代者，可能产生两个有效所有者。清理过程会尝试每个步骤，但仍把失败的 generation 保持为 busy，直到进程所有者解决失败。

**只解析一次 hostname 后调用 `loadURL()`，或把 HTTPS URL 改写成选定 IP。** 前者会在校验与 Chromium 连接之间留下 DNS rebinding 窗口；后者会改变 SNI 与证书身份。因此 hostname 必须使用注入的地址固定 transport，并且在 Task 8 提供之前保持不可用。

## 影响

浏览器适配器具有小而可审计的权限边界：一个受信任会话拥有一个可见表层；每个页面派生 ref 都会在实质变更时失效；所有输入都来自固定闭集；网络、权限、文件、遍历、JSON 与图片边界都会封闭失败。除非 coordinator 验证显式转移，否则人工 Workbench 浏览器会保留其持久化 partition 与既有行为。

同一边界有意放弃任意 Web 自动化。缺少可用无障碍语义的页面控件、无法确认敏感性的字段、没有显式 allowlist 的私有目标、popup、下载、上传与依赖权限的工作流都不受支持。在 Task 8 注入满足固定地址约定的受控 CONNECT transport 前，hostname 导航也会刻意保持不可用，且没有不安全 fallback。真实 Electron 组合会通过这些窄接口提供该 transport、manager resource 与 authority coordinator；本层自身不改变普通 CLI 或 Web 启动，也不通过 UI 或工具暴露 Browser Control。
