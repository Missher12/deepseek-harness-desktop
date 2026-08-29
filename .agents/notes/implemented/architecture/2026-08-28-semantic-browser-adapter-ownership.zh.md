# Agent Note: 语义浏览器适配器的所有权与安全边界

Status: implemented

[English](2026-08-28-semantic-browser-adapter-ownership.md) | 中文

## 问题

模型驱动的浏览器控制需要提供有用的页面语义，同时不能让 Electron renderer、debugger、已登录浏览器状态或网络访问变成通用权限。浏览器页面不受信任，而 debugger 附加、导航、无障碍树变更与销毁都可能和每项异步观察或输入操作发生竞态。

人工 Workbench 浏览器已经拥有持久化的已登录 partition。如果 Agent（智能体）工作隐式复用该 partition，会混合会话所有权与凭据；如果独立 Agent 浏览器表层没有进程级所有者，不同会话又可能同时显示、隐藏或更改彼此的浏览器。

语义树与截图也是由攻击者影响的数据。不受限的遍历、任意 CDP（Chrome DevTools Protocol）、可编辑值、私有网络目标、原生文件选择器、下载、权限或整页捕获都会让信息和动作范围超出固定的 Browser Control 约定。

## 决策

Desktop 浏览器层把全局表层所有权、页面策略与封闭的 CDP 适配器分别放在 [`surface-manager.ts`](../../../../apps/desktop/src/browser/surface-manager.ts)、[`policy.ts`](../../../../apps/desktop/src/browser/policy.ts) 和 [`cdp-adapter.ts`](../../../../apps/desktop/src/browser/cdp-adapter.ts)。[`contracts.ts`](../../../../apps/desktop/src/browser/contracts.ts) 负责动作校验器、不透明 ref 形状、partition 名称、快照 envelope、结构化失败与固定资源边界。Electron main 组合层提供这些窄接口；renderer 与工具调用方不会获得 WebContents、Session、表层身份、generation、partition、proxy port 或 grant。

## 所有权与生命周期

单个 `BrowserSurfaceManager` 实例拥有进程级唯一 Agent 浏览器位置。acquire 输入携带由受信任提供方得出的官方会话。首次调用会原子保留该会话，并且只会消费 coordinator 已验证、精确指向 `persist:dsh-workbench-browser` 实例的 Give intent；否则，它会创建具备唯一名称的非持久化表层，并在返回前完成可见挂载。新的临时 mount 会在附加 `WebContentsView` 后加载并等待 `about:blank`，因此 Windows 与 macOS 都只会在 Electron 启动 renderer target 后发布该表层。只有携带精确会话与 generation 的调用才能复用活动表层；另一个会话只会收到 `BUSY`，不会消费新 intent，也不会对所有者调用 mount、hide 或 teardown。

每次 mount 都有 generation 与 mount token。陈旧的 hide 和 Stop token 不产生影响，清理失败时仍以封闭失败方式保留所有者，不会接纳替代者。持久化转移分为两个阶段：reserve 保留精确的人工 view、owner、identity、bounds、visibility、URL、title 与 tab state，只有安全 mount 与 commit 完成后才发布；从 reserve 开始到精确 cleanup release 结束，renderer 发起的人工 show、control、hide 或隐式创建 view 全部保持 `BUSY`。commit 前失败时绝不会关闭或替换人工 view，并且只会在 handler dispose、debugger detach、view teardown 与 coordinator revoke 全部成功后恢复它。Stop 遵循相同顺序，即使其中一步失败也会等待所有清理步骤，只有最终 release 达到完全停稳（quiescence）后才释放所有权。未发布清理失败时，失败步骤仍绑定原 session 与 generation，所有 acquire 保持 `BUSY`，只有携带精确身份的生命周期重试在这些步骤成功后才能释放位置。被转移的人工持久化表层绝不会清理存储；临时 Agent partition 始终不同于 Workbench partition。

表层资源会在 mount 前安装 popup、导航、下载与权限防护。防护会拒绝所有新窗口、取消下载，并让 permission check 与 permission request 两条路径拒绝所有权限，包括相机、麦克风、位置与剪贴板访问。长期存在的 main-process handler owner 只安装一次 Electron 的 window-open 与 permission 单槽 dispatcher，把既有人工 handler 保留为基础层，并在不把这些槽写回 `null` 的前提下添加或移除 Agent generation；陈旧 dispose 无法移除较新 generation，也无法移除下面的人工行为。既有事件 listener 同样保持原位，每个 generation 只移除自己安装的导航与下载 listener。适配器会在每次自有 debugger 附加时启用 Accessibility domain 与 `Page.setInterceptFileChooserDialog`，在 detach 该自有 debugger 前将两者关闭，并且不暴露任何设置文件的操作。

## Desktop 组合

[`main.ts`](../../../../apps/desktop/src/main.ts) 拥有唯一的 Electron 表层 registry、`BrowserSurfaceManager`、语义适配器、pinned transport、takeover authority 与 `DesktopControlCoordinator` 浏览器适配器。临时 acquire 会创建使用唯一非持久化 partition、已可见挂载的 `WebContentsView`。经过验证的 Give 只转移精确的可见 Workbench view 及其 `persist:dsh-workbench-browser` partition。两条路径都从官方 provider session 得出 owner，并且通过拥有该 view 的精确 Electron `Session` 上的 `resolveHost()` 获取 DNS 结果。

main 拥有的 loopback transport 会为一个活动 generation 绑定不公开的随机端口，并配置所属 Session 把 HTTP 与 HTTPS 代理流量都送入该端口，同时移除 Chromium 的隐式 loopback bypass。每个 generation 还拥有随机 proxy 凭据；preload、工具与 transport API 都不会暴露这些凭据。main-process Electron `login` handler 只会响应 WebContents、loopback port、Basic scheme 与 realm 都精确匹配的活动 generation，proxy 会以恒定时间比较完整 authorization 值。未认证流量只会收到 proxy authentication challenge；已认证的普通 HTTP 请求仍会失败，CONNECT 也只接受没有 userinfo、Host authority 完全匹配且端口为 443 的请求。每个获准 CONNECT 都会通过 Chromium Session 重新解析，并只拨号一个已验证的 public IP；TLS 仍使用原 hostname 完成 SNI 与证书校验。server 从接收连接起就跟踪每个 client，设置较短的 header 与 request timeout，并在 dispose 时销毁 partial-header、等待 resolver 与已建立的 socket。Stop、revoke、activation rollback 与 shutdown 会关闭全部隧道并把 Session 网络恢复为 system proxy 基线；proxy 配置只完成一部分即失败时也走同一清理路径。

preload 只向受信任 Harness main frame 暴露无参数的 Give、Stop 与 status 方法。Give 为下一次官方 acquire 保存 main 拥有的不透明 intent；status 只暴露 human／given／agent／stopping 阶段与已登录警告。Workbench 工具栏会在 Give 前要求确认，并在清理完成前保持 Stop pending。右侧实用表层会持久化 420–960px 的宽度，默认 640px；左侧会话栏会持久化上次展开的 264–640px 宽度，默认 320px。浏览器模式会把实时 DOM 宿主的精确 x／y／width／height 变化串行同步到原生 `WebContentsView`，包括仅位置发生变化的情况，因此面板、窗口或侧边栏移动后，视图仍留在右侧表层内。非 minimal Desktop preset 包含 `tool-browser-control`；它的 Cordis injection 只在 Desktop 拥有的 `BrowserControl` provider 存在期间注册闭集工具与只允许官方浏览器工具的 prompt section。没有该 provider 的 CLI 与 Web 组合不会拥有浏览器工具或相应 prompt 文本。官方 BrowserControl 出现任何失败后，绑定 session 与 turn 的单调 execution guard 会拒绝 Bash、PowerShell、Code Mode 与终端命令入口。官方 browser snapshot 或 action 只会清除可恢复的 transport、lease、ownership 或 internal failure；authorization、policy、permission、unsupported、quota 与 binary failure 则保持封闭直到 turn 结束。成功并等待清理完成的 `browser_stop` 会在清理后清除 session 防护，失败的 Stop 则不会。在恢复有效时仍允许 Stop 与一次官方重试；普通模型工具流水线无法把失败的官方请求替换成直连 DevTools 或 remote-debugging port 的脚本。

## CDP 与引用边界

`CdpBrowserAdapter` 会先对已经附加或在附加竞态中胜出的外部 debugger 返回 `BUSY`；它只在自己成功附加后记录 `attachedByUs`，也只在此状态下执行 detach。对 renderer readiness 敏感的初始化会在独立的 10,000ms 预算内启用 Accessibility 与文件选择器拦截，并在同一次自有 attachment 上最多尝试两次。主文档导航、同文档导航、表层销毁、debugger detach、`Accessibility.nodesUpdated` 与 `DOM.documentUpdated` 都会推进适配器 epoch 和 revision、清除所有 ref，并让每个延迟完成的 CDP 调用无法通过 await 后的 epoch 复检。

CDP 方法闭集仅包含 Accessibility 启用／关闭、`Accessibility.getRootAXNode`、有界广度优先的 `Accessibility.getChildAXNodes`、只读 `DOM.describeNode`、`DOM.getBoxModel`、固定的 `Input.dispatchMouseEvent`、`Input.dispatchKeyEvent` 与 `Input.insertText`、可见 viewport 的 `Page.captureScreenshot`，以及文件选择器拦截。根节点无效或为空时，会在同一个 10,000ms 操作预算内最多重试三次、每次间隔 500ms；系统不会把空树伪装成成功的空白快照。`DOM.describeNode` 只贡献 `type`、`autocomplete`、`disabled` 与 `readonly`。系统不暴露任何 `Runtime` 方法、JavaScript 求值、selector、任意 CDP dispatch、remote-debugging port、坐标动作或文件设置路径。

遍历会在 2,000 个原始节点、32 层深度、512 次 CDP 调用或 10,000 ms 时停止。debugger cleanup 保留独立的 2,000 ms 边界。投影最多保留 300 个可动作 ref、49,152 个 UTF-8 语义字节与 65,536 字节的编码 JSON 结果。ref 会绑定表层 generation、适配器 revision、AX identity、后端 DOM identity 与 registry 位置。快照不包含可编辑值；策略会在 ref 进入 registry 前拒绝密码、一次性验证码、支付、文件、上传、disabled、readonly 与敏感性不确定的可编辑目标。在每个基于 ref 的变更动作执行前，适配器会再次完成有界 AX 读取与 `DOM.describeNode`，根据实时 role、name、editability、type、autocomplete、disabled 与 readonly 重新分类；一旦目标变得敏感，或 AX identity／语义发生变化，就会在发出任何 `Input` 命令前拒绝。type 与 select 会拆分为多段受检步骤：click 后重新读取 AX 与 DOM，要求有且仅有一个带后端节点身份的 focused 节点且必须与 ref 相同，并在 `Input.insertText` 前再次检查敏感性与可编辑性；select 还会在插入文本之后、发出 Enter 之前再次执行相同的焦点身份与策略检查。

动作校验器只接受 navigate、基于 ref 的 click 和 type、有界 key chord、基于 ref 的 select、有界 viewport 或基于 ref 的 scroll、有界 duration/navigation/loading-idle wait、历史导航、reload，以及外围生命周期中的 Stop。navigation 与 loading-idle wait 会先订阅事件再复检实时 loading 状态：已经稳定的页面立即返回，仍在加载的页面必须等到后续终止事件；超时仍是有界失败，不会被伪装成成功。从第一个真实页面返回到适配器自有的初始 `about:blank` 是安全空操作，其他非 Web 或受保护的历史目标仍会拒绝。浏览器输入只会在解析当前 ref 后计算内部 box center；调用方无法提供 selector 或坐标。

## 网络与截图策略

`AgentBrowserUrlPolicy` 只接受没有 userinfo 的 HTTP(S) URL。它没有 Node DNS fallback：组合层必须适配拥有该表层的精确 Electron `Session` 的 `resolveHost()`。策略会校验字面与解析后的目标，包括 IPv4-mapped IPv6，并且拒绝 loopback、link-local、private、carrier-grade NAT、site-local、unspecified、multicast、格式错误的解析器输出与 localhost 保留名称，除非用户拥有的 allowlist 明确允许精确目标。适配器会先取消页面驱动的导航与每一跳 redirect，再独立授权下一跳；页面文本不能改变 allowlist。

先检查一次 DNS 结果再调用普通 `loadURL()` 并不能防御 rebinding，因为 Chromium 仍可能在连接前再次解析。public HTTPS IP literal 经策略校验后保留直接加载；普通 HTTP 不可用。hostname 使用属于该表层的 pinned-navigation transport。navigate、back、forward 与 reload 都会先取得并授权其精确目标 URL，再把对应的一次性原生 commit 交给同一 transport；只有完成 request-time 校验后才能执行 commit，并且 transport 返回或失败后的延迟 commit 会被拒绝。在 history 或 reload commit 之前，适配器还会在没有中间 await 的情况下重新检查导航 revision 与当前 URL；history 移动还要求原 active index，以及活动／目标 entry 的精确 URL、title 与 Chromium page state 全部保持不变。transport 会对每次 CONNECT 使用 request-time `resolveAndValidate` 能力，只把 socket 连接到返回的某个 public address，同时保留原 URL hostname 供 HTTP Host、HTTPS SNI 与证书校验使用。没有该 transport 时，每条 hostname 导航路径都会封闭失败且绝不回退到 `loadURL` 或原生 history／reload；适配器不会用 `webRequest` 或 URL-to-IP 重写伪装成地址固定。

截图只覆盖可见 viewport，并设置 `captureBeyondViewport: false`。适配器会在捕获前确定性选择不大于 1 的 scale，确保预期输出的任一边都不超过 2,048 像素，面积也不超过 4,194,304 像素。编码过大时会按几何比例降低 scale，总尝试次数最多为 3，并且不会分配无界的解码 buffer。交付的图片必须先通过规范 base64 解码、PNG signature 与 IHDR 校验、精确缩放尺寸、4,194,304 字节与像素边界、UUID transfer ID 校验和 SHA-256 计算，之后 metadata 与分离的 PNG 字节才能进入保持配对的快照 envelope。

## 验证

focused browser、policy、pinned-transport、coordinator adapter、takeover、preload、preset 与 Workbench client spec 会使用 fake debugger、WebContents、Session、proxy socket、IPC registry 与表层资源。它们固定了 mount 发布前的 renderer readiness、有界两次 debugger handshake、Accessibility 启用与空根节点有界重试、当前 loading wait 竞态、初始空白页历史行为、附加所有权与竞态、延迟响应与 ref 失效、所有资源边界、snapshot-to-action 敏感性变化、click 时的焦点重定向、CDP 和动作闭集、截图缩减与校验、public-to-private DNS rebinding 且不 load／connect、带认证的 CONNECT authority 与 proxy bypass 策略、partial-header 和等待 resolver 时的 dispose、system proxy 恢复、稳定恢复人工 handler、会话原子所有权、陈旧 token、两阶段持久化转移、失败清理的 reservation 与重试、可信无参数 IPC、Stop pending 状态、条件工具与 prompt 注册、执行 fallback 拒绝与显式 Stop 恢复、面板几何持久化、仅位置变化时的原生视图对齐，以及 revoke。打包后的 Electron smoke 会加载本地语义 fixture，并且必须取得精确的可访问 button 才会把 debugger 路径判为健康。Desktop 与 Workbench TypeScript 检查和仓库 scoped oxlint 覆盖该组合。

## 备选方案

**机会式附加，并在 Stop 时始终执行 detach。** 这样 Agent 清理可能断开开发者或其他子系统拥有的 debugger。当前实现显式记录所有权，并让 detach 取决于 `attachedByUs`。

**使用 `Runtime`、JavaScript 求值或 selector 获得更丰富的交互。** 这些机制会形成通用的页面执行与提取通道，其权限无法由固定 Browser Control 动作闭集表达。无障碍语义与不透明 ref 有意牺牲覆盖范围，以换取可评审的封闭边界。

**让每个 Agent 会话复用已登录 Workbench partition。** 自动复用会在没有验证转移的情况下暴露人工 cookie 与存储，也会使会话隔离含糊。除非 coordinator 消费了显式指向可见持久化实例的 Give intent，否则 Agent 工作会获得唯一的非持久化 partition。

**捕获整页，或把截图坐标暴露为 fallback。** 整页捕获具有由页面控制的 geometry，而坐标 fallback 会把图像观察变成不受限的 pointer 权限。适配器保持 viewport 捕获有界，并让浏览器动作维持语义化。

**清理尝试失败后释放全局所有权。** 当 debugger、view、storage 或 revoke 状态不确定时接纳替代者，可能产生两个有效所有者。清理过程会尝试每个步骤，但仍把失败的 generation 保持为 busy，直到进程所有者解决失败。

**只解析一次 hostname 后调用 `loadURL()`，或把 HTTPS URL 改写成选定 IP。** 前者会在校验与 Chromium 连接之间留下 DNS rebinding 窗口；后者会改变 SNI 与证书身份。因此 hostname 使用由其精确 Electron Session 拥有的地址固定 CONNECT transport。

**只增加共享的两秒 CDP 预算。** 这能减少部分 timeout，却仍保留首次 mount 的 renderer startup 竞态，还会让 cleanup 与语义遍历等待同样长的时间。临时 mount readiness、独立的有界初始化重试、十秒操作预算与保留的两秒 cleanup 边界让每段等待由对应所有者负责。

## 影响

浏览器适配器具有小而可审计的权限边界：一个受信任会话拥有一个可见表层；每个页面派生 ref 都会在实质变更时失效；所有输入都来自固定闭集；网络、权限、文件、遍历、JSON 与图片边界都会封闭失败。除非 coordinator 验证显式转移，否则人工 Workbench 浏览器会保留其持久化 partition 与既有行为。

同一边界有意放弃任意 Web 自动化。缺少可用无障碍语义的页面控件、无法确认敏感性的字段、没有显式 allowlist 的私有目标、普通 HTTP、popup、下载、上传与依赖权限的工作流都不受支持。真实 Electron 组合会通过窄接口提供 transport、manager resource、authority coordinator、严格 takeover IPC 与条件工具 provider。没有 Desktop 拥有的 provider 时，普通 CLI 与 Web 启动保持不变。
