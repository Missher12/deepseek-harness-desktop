# Intel Mac Codex 风格工作区设计

[English](2026-08-20-macos-codex-workbench-design.md) | 中文

## 目标

为 Intel macOS Desktop 应用增加紧凑的 Codex 风格工作区，同时不把 Web 客户端变成拥有特权的桌面页面。产品名始终为 `DeepSeek Harness`；`Session log` 旁边只放一个按钮，用它打开可调整宽度的右侧面板；面板提供 Terminal、Browser、Files、Side Chat 和 Review 五种模式。正在生成的推理改用克制的打字机式展示，不再使用当前的扫光效果。

实现必须保留 Harness 会话语义、插件可移除性、随机回环地址启动、受保护的更新器以及 Electron renderer 的强化安全边界。

## 已确认的产品决策

- 工具入口是一枚位于 `conversation.session.header.utilities` 的 32 像素图标按钮，紧跟 `session-log-download`。它不是常驻侧栏，也不放在窗口控制按钮旁边。
- 工作区默认关闭。点击入口会打开上次选择的模式；再次点击会关闭面板。
- 面板页头按照 Terminal、Browser、Files、Side Chat、Review 的顺序显示五种模式。
- 面板沿用 Harness 的字体、间距、边框、低对比度表面以及蓝色聚焦／激活 token。它不使用粒子、角色吉祥物、持续扫动的渐变或悬浮卡片。
- 用户可以调整面板宽度。首选宽度在应用重启后仍然保留；窗口较窄时，相同内容改为右侧抽屉展示，不会把会话区压缩到无法使用的宽度。
- Side Chat 是唯一的手动跨会话通信界面。收到的投递与回复仍直接出现在普通会话中，并带有发送方归属；不再保留独立的 messenger 页头按钮或旧抽屉。
- 本次只交付 Intel macOS。Windows 和 GitHub Release 发布不在本次改动范围内。

## 已考虑的方案

### 常驻工具侧栏

这种方案可以让所有工具一直可见，但会永久占用横向空间，也不符合已经确认的交互方式，因此不采用。

### 恢复旧 messenger 抽屉并增加多个独立工具按钮

这种方案可以复用更多既有 UI，但会重复用户已经否定的突兀、卡片化展示，还会制造多个彼此竞争的右侧界面，因此不采用。

### 使用 renderer `<webview>` 或 `<iframe>` 嵌入任意网站

常见网站会拒绝 iframe 嵌入。启用 `<webview>` 则会削弱 Desktop shell 当前明确阻止 renderer 创建 webview 的策略，因此不采用。

### 一个可移除的 Client／Host 工作区扩展加一层收窄的 Electron 浏览器桥接

这种方案把绝大多数产品行为保留在 Harness 插件边界内，复用现有布局与会话服务，并且只把真正需要的能力交给原生层。由 Electron 管理的 `WebContentsView` 提供浏览器，同时不给 Harness renderer 增加 Node 权限，因此采用该方案。

## 架构

### 包边界

新增一个 Desktop 专用工作区扩展包，并拆分 Host 与 Client 两个实现面。Desktop profile 通过现有 patch／profile 组合启用它，普通 Web profile 不启用。该扩展负责：

- 页头入口与工作区面板；
- 面板状态、当前模式以及已保存宽度；
- 由用户拥有的 Terminal Host 服务；
- 有界的 Files 与 Review Host 服务；
- 基于现有 session-messenger 传输层组合的 Side Chat。

Electron 应用只增加浏览器视图控制器和该控制器所需的封闭 preload API。它不会获得原始文件系统、shell、包管理器或无限制 IPC 方法。

移除工作区扩展时，入口、面板、Terminal、Files、Review 和 Side Chat 界面必须一起消失，并且不能改变普通会话行为。现有 relay 节点 renderer 继续留在 session-messenger 包中，因此即使工作区界面不存在，持久化的跨会话消息仍可阅读。

### 布局归属

为 `ui-layout` 增加一个可选的 `layout.utility` slot 和工具栏状态。关闭时该栏宽度为零；打开时使用已保存宽度。打开工具面板会关闭现有工具调用详情栏，打开工具调用详情栏也会关闭工具面板，避免两个右栏同时挤占会话空间。

工具状态记录 `open`、`mode` 与 `preferredWidth`。宽度限制在 320–720 像素之间，默认 420 像素，并使用带版本的本地偏好配置键持久化。关闭面板时保留首选宽度。进入现有窄屏断点后，工具栏变成宽度有上限且带遮罩的右侧固定抽屉；按 Escape 会关闭抽屉并把焦点还给页头入口。作为相邻 Bug 修复，现有工具调用详情操作会接通已经实现的详情栏；它遵守同一套互斥规则，不会增加另一个右侧界面。

面板主体只在打开时挂载。切换模式时保留轻量表单状态，但会分离原生浏览器像素，并暂停非活动模式的终端渲染。

### 页头入口

工作区 Client 插件在 `conversation.session.header.utilities` 注册一个条目，并明确排序在 `session-log-download` 后面。控件沿用 Session log 控件的 32 像素高度、焦点环、悬停表面与禁用语义，但只显示图标，同时提供可访问的 `打开工具` 或 `关闭工具` 标签以及 `aria-expanded` 状态。

由于这里使用会话作用域 slot，未选择会话时不会显示控件。切换当前会话会保留面板模式与宽度，但所有属于会话的数据都改为新会话的数据。

## 品牌

把通用客户端标题和侧边栏回退值从 `DSH Local Build` 改为 `DeepSeek Harness`。官方品牌插件仍可提供同一个值，但官方构建环境缺失或到达较晚时，打包应用不再显示开发占位文本。

文档标题仍可包含会话信息：选中会话后可以显示 `<session title> — DeepSeek Harness`，但侧边栏常驻产品标识始终显示 `DeepSeek Harness`。测试覆盖官方构建环境和 Desktop 暂存实际使用的回退路径。

## 工具模式

### Terminal

Terminal 是由用户拥有的交互式 PTY 界面，不会调用面向模型的 `terminal_*` 工具，也不会冒充会话 Agent。Host 服务在服务端解析请求的会话，从持久化会话页头取得工作目录，并按照客户端连接、会话 id 和终端 id 建立独立的终端所有者记录。

Client 接收有界的增量输出帧，只发送经过校验的 UTF-8 输入、尺寸调整值以及封闭的信号词汇。界面最初显示一个当前终端；用户可以在保守的每会话上限内创建和关闭其他终端。关闭面板会在当前应用会话内保留仍在运行的终端；移除会话、断开 Client、关闭 Host 或退出应用时，系统会终止对应的完整进程树。

终端界面尽可能复用 Harness 的等宽字体和 ANSI primitive。它支持复制、清空视图、重启和显式关闭；不会静默执行命令，不会跨应用重启恢复命令历史，也不会暴露选中会话工作区之外的 shell。

### Browser

Electron main 为每个 Desktop 窗口拥有一个 `WebContentsView`。首次使用时才创建该视图，并设置 `nodeIntegration: false`、`contextIsolation: true`、`sandbox: true`、`webSecurity: true`，同时使用不同于 Harness renderer 的 partition。Harness 页面只能请求以下经过校验的操作：按像素边界显示、隐藏、导航到 HTTP(S) URL、后退、前进、重新加载、停止以及读取有界导航快照。

main 进程会在每个请求中校验完全相同且受信的 Harness `webContents`、main frame 以及当前随机回环 Harness URL 的准确 origin。它把普通搜索文本转换为配置的搜索 URL，拒绝非 HTTP(S) scheme，拒绝弹窗，阻止权限请求，拒绝下载，在用户明确要求外部打开时使用系统浏览器，并在窗口销毁时销毁视图。

Browser 活动时，Client 上报浏览器视口的 CSS 矩形和缩放变化。main 把它转换成 content-view 边界，裁剪到窗口内容区域内，并在任何面板切换前先隐藏原生视图，避免残留像素覆盖其他模式。经过校验的快照会回传导航状态和失败信息；页面内容绝不会进入 Harness DOM。

### Files

Files 是一个以当前会话工作区为根的只读懒加载文件树。Host 解析并规范化工作区根路径，也会规范化每个请求的子路径，并拒绝路径穿越或符号链接逃逸。目录分页和文件预览分别限制条目数、字节数与响应大小。二进制文件只显示元数据，过大的文本文件显示明确标注的截断预览。

该模式支持筛选、展开／收起、复制路径，以及把 `@path` 插入当前编辑器草稿。它不会展示任意操作系统路径，也不会编辑、重命名、删除、上传或执行文件。

### Side Chat

Side Chat 复用现有 session-messenger Host 传输、投递回执、唤醒控制、回复关联、未读状态和内联 relay 节点。工作区使用紧凑的连续布局，不再使用旧卡片抽屉：

- 当前 Session ID 与复制操作；
- 发送前会校验的目标 Session ID；
- 消息编辑器和 `唤醒目标 Agent` 控件；
- 从收到的 relay 打开时显示的回复上下文；
- 近期只含元数据的投递状态。

发送不会导航到、打开、归档、恢复、删除或以其他方式修改目标会话。源会话会立刻得到一个内联发出 relay 节点，其中包含准确的发送文本与投递状态。目标会话会得到标记为 `由 DeepSeek Harness 从另一个聊天发来` 的内联节点；启用唤醒时，目标 Agent 可以回复，系统会把准确关联的回复显式镜像到源会话。整个流程没有任何一段只通过不可见上下文注入来表达。

移除过时的 messenger 入口、抽屉注册和陈旧文档。可复用的传输与 relay renderer 继续独立测试。

### Review

Review 是一个以当前会话工作区为根的只读 Git 界面。Host 使用参数数组调用 Git，绝不构造 shell 字符串。它展示仓库根目录、分支、有界 porcelain 状态、文件级 diff 统计，以及选中文件的有界 unified diff。所有路径都会规范化，并且必须位于已发现的仓库根目录内。

面板提供刷新、选择文件、复制 diff 和 `在当前聊天中审阅` 操作。最后一个操作只把准备好的审阅请求放入当前编辑器草稿，绝不会自动发送。非 Git 仓库显示空状态说明，不会反复重试进程。本版本不提供 stage、commit、checkout、reset、clean、discard 或其他修改操作。

## 推理展示

移除运行中推理行的扫光效果。推理运行且处于收起状态时，系统用短缓冲的打字机节奏和克制的光标展示最新真实推理摘要。该展示绝不编造文本，不会回放完整推理正文，也不会改变持久化内容。

展示队列有明确上限：小 token 分片会平滑显示，大量积压会快速追赶，完成时则立即刷新为准确最终文本。新的摘要行会替换旧目标，但不会重播已经稳定的内容。展开推理行时始终立即显示完整当前推理。`prefers-reduced-motion` 会绕过队列并隐藏光标。

推理结束、组件卸载、文档变为不可见或启用 reduced motion 时，系统会取消全部动画工作，避免空闲的 requestAnimationFrame 循环。

## 安全与信任边界

Harness renderer 继续在沙箱中运行，不会得到 Node primitive。新的 preload 值使用封闭的可辨识联合与明确的大小限制。每个特权 IPC handler 都使用同一个发送方判定，并要求：

- 当前 Desktop BrowserWindow 的准确 `webContents`；
- main frame，而不是子 frame；
- 当前持有的随机回环 Harness URL 的准确 origin。

Browser 视图使用不同的 session partition，也不会得到 Harness preload。Browser origin 的内容不能调用 Desktop IPC。Files、Review 和 Terminal 在 Host 内解析工作区归属，不信任 renderer 传入的绝对根路径。日志只记录操作类别和错误代码，不记录终端输入、文件内容、带 query string 的浏览器 URL、跨会话消息正文、凭证或环境值。

## 生命周期、错误与性能

- 打开工作区是同步操作；每个模式在收到第一份有界快照前显示本地 skeleton。
- 某个模式失败时只影响该模式，并在不关闭会话的情况下提供重试。
- Browser renderer 崩溃会在 Browser 模式中报告，隔离视图可以重新创建，无需重启 Harness。
- Terminal 输出按事件驱动并以有界批次渲染。非活动模式不轮询。
- Files 按需加载目录，不递归监听工作区。
- Review 在打开、手动刷新或收到明确的已知工作区修改信号时刷新；它不会定时运行 Git。
- Side Chat 使用现有推送事件，不执行后台轮询。
- 关闭面板时，系统会在布局动画开始前隐藏原生浏览器内容。退出应用时等待终端进程树清理完成，并销毁浏览器视图。
- 面板动画仅使用 transform／opacity，并在 reduced motion 下禁用。系统不会运行永久粒子、扫光或 canvas 循环。

## 随交付执行的程序审计

实现阶段会对本功能触及的界面和当前已打包 Mac 应用执行有边界的审计：

1. 品牌／构建 profile 漂移，包括 Desktop 暂存资源的回退行为。
2. Desktop IPC main-frame／origin 校验以及导航／权限拒绝矩阵。
3. 陈旧的 session-messenger UI 代码、测试和 README 声明。
4. 当前布局中不可达或彼此竞争的右侧面板入口。
5. 监听器、动画帧、PTY、浏览器视图和子进程的资源释放。
6. 窄窗口几何、宽度持久化、键盘焦点与 reduced motion。
7. 已安装 Intel 应用中的 renderer 控制台错误和启动／运行时回归。

对本功能之外的发现会附带严重级别和证据单独报告。交付不会夹带高风险的无关重构。

## 测试策略

实现按照红灯、绿灯、重构拆成三个阶段。

### 阶段一：基础

- 使用聚焦 Client 测试锁定品牌回退行为。
- 增加通用工具栏及其与详情栏互斥的行为，并覆盖布局 store 与 AppFrame 测试。
- 在 Session log 后注册页头按钮，并验证打开、关闭、焦点恢复、窄屏抽屉、宽度限制与偏好恢复。
- 在暴露 Browser 控制器之前，先增加 preload 校验器和 main 进程允许／拒绝测试。

### 阶段二：功能完整性

- Terminal 服务测试覆盖服务端 cwd 解析、所有权、大小／输入限制、尺寸调整、断开连接、移除会话以及完整进程树清理。
- Browser 测试覆盖受信 main-frame 调用，被拒绝的子 frame／origin／scheme／弹窗／下载／权限请求、边界裁剪、切换前隐藏、崩溃恢复和关闭时销毁。
- Files 测试覆盖懒加载列表、文本预览、二进制／大文件行为、路径穿越、符号链接逃逸与会话切换。
- Side Chat 测试覆盖准确目标 id、源／目标可见投影、回复关联、唤醒／不唤醒、拒绝分支副作用，以及旧抽屉／按钮不存在。
- Review 测试覆盖仓库识别、参数安全的 Git 执行、边界、路径逃逸、非仓库行为以及只写入草稿的审阅操作。

### 阶段三：打磨与接近发布形态的验证

- 推理测试覆盖分片平滑、目标替换、展开／完成时立即显示准确文本、隐藏文档后的清理以及 reduced motion。
- 交互测试覆盖五种模式、宽度持久化、详情栏互斥、键盘导航、焦点恢复、窄屏几何以及控制台零错误。
- 运行相关包测试、Desktop main／preload 测试、生产 Host／Client／Web 构建、Desktop 暂存检查和现有功能回归矩阵。
- 构建 Intel x64 `.app` 与 `.dmg`，运行打包 Electron 冒烟测试，使用 `hdiutil` 校验 DMG，在不修改 `~/.dsh` 的情况下安装，并人工核对已确认的页头按钮与面板几何。
- 报告最终路径、字节数、SHA-256、测试总数以及仍未解决的审计发现。没有单独指令时，不发布或修改 GitHub Release。

## 验收标准

- 侧边栏产品标识始终显示 `DeepSeek Harness`；打包 UI 中不存在 `DSH Local Build`。
- `Session log` 紧邻位置只有一个紧凑按钮，用于打开和关闭工作区。不再存在常驻工具侧栏或旧 messenger 按钮／抽屉。
- Terminal、Browser、Files、Side Chat 和 Review 在面板内可正常使用，保持已经确认的顺序与 Harness 视觉语言，并且不会与工具调用详情栏冲突。
- 面板可以调整宽度并恢复已保存宽度；在窄窗口中改为抽屉，同时支持键盘与 reduced-motion 用户。
- 跨会话消息和回复在两个相关会话中都有清晰归属并可见，不会只注入上下文。
- 推理使用有界的打字机式流式展示，不再包含扫光、粒子、吉祥物或空闲动画循环。
- 有特权的浏览器与桌面操作通过默认拒绝的发送方、origin、frame、scheme、路径和生命周期测试。
- 最终产物保持 Intel x86_64，使用随机回环端口启动，保留受保护的更新器和全部现有用户数据，并通过接近发布形态的 Mac 验证。

## 非目标

- 不实现、构建或运行 Windows CI，也不修改 Windows 安装包或 Release 资产。
- 本设计阶段不执行 GitHub push、PR、merge、tag 或公开发布。
- 不提供文件编辑、Git 修改、终端自动执行、后台浏览器自动化或浏览器下载管理器。
- 不替换普通 Harness 聊天、会话列表、插件市场、Usage Insights、推理强度控件或更新器架构。
- 不让普通浏览器构建暴露原生 Terminal 或嵌入式 Browser 功能。
