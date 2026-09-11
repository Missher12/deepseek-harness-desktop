# DeepSeek Harness 桌面版

[English](README.md) | 中文

这是官方 DeepSeek Harness 运行时的原生桌面外壳。应用只在本机回环地址启动一个由自身管理的 Harness 子进程，端口由操作系统随机分配，现有 Harness Web 客户端运行在加固后的 Electron 窗口内。

初始窗口和无效状态回退会适配主显示器工作区；恢复窗口时选择可见面积占比最大的合格显示器，较小工作区也会相应降低最小尺寸。成品首启验收先检查窗口范围和“继续”操作，再扩大测试视口；Windows Search 证据会等待前台 Shell 搜索根内的完整查询和唯一可操作结果。

侧栏提供类似 Codex 的已归档会话管理器。归档会保留会话日志及其原有
Workspace 位置，可在管理器中原位恢复；永久删除只能从归档管理器进入，
必须明确二次确认，且运行中的会话会被拒绝删除。
每个已有内容的会话都在操作菜单中提供“复制会话 ID”，归档会话卡片也
提供同一操作，复制时不会恢复或删除会话。应用复制完整且稳定的原始 ID，
并根据宿主剪贴板是否接受写入显示结果提示。

在输入框键入 `@` 会打开同一个聚合菜单：文件／文件夹与会话引用、聚焦的
“目标”和“计划”操作，以及当前会话实时可用的技能。选择技能后会插入其标准
`/技能名` 调用，因此发现入口与执行仍共用现有的受审计技能链路。

可移除的 `@deepseek-ai/dsh-session-messenger` 插件提供同一 profile 内有界的 Agent
通信。复制会话 A 的准确 ID，粘贴到会话 B，再让 B 的 Agent 发送：Native Function
Calling 或 Code Mode 会启动 A 的已有 Agent，A 可通过 receipt 绑定元数据回复或继续
同一协作链。五个工具覆盖直接发送、可选的发送并等待、一次性 Host 授权回复、显式
匹配回复等待，以及参与方停止整条协作链。停止会立即结算未完成的投递和等待，拒绝
后续回复或 continuation；用户明确发起的新消息仍能建立独立新链。通信只显示在普通
Harness 会话历史中，来源侧消息行仅增加紧凑的“停止／已停止”操作；没有标题栏入口、
操作抽屉、自定义消息卡片或第二份消息档案。它不会创建新会话、subagent 或自主 Agent
对聊循环，收到的文字始终按不可信内容处理。

Desktop 的“常规”设置提供关闭行为与分时费用估算两个偏好。macOS 默认关闭窗口后
在后台保留，Windows 默认直接退出；Windows 只有选择后台保留时才创建带“显示／退出”
的系统托盘。任何显式“退出”都会停止应用拥有的 Harness 进程。会话底部保留原有性能
数据，并在第二行显示已结算的本轮费用估算、会话累计估算、官方接口返回的准确余额和
当前价格时段；关闭分时估算后会隐藏估算与时段，但不会隐藏准确余额。

可移除的 `@deepseek-ai/dsh-reasoning-effort` 插件把普通思考等级行替换为支持
键盘操作的滑块，并且只使用当前模型实际声明的档位。Harness 风格浮层在空间
足够时默认向下、必要时自动翻到上方；保留标注来源的 HanaAyane Canvas 粒子，
可选小人物默认关闭，确认后的 effort 继续通过现有模型选择路径持久化。

Desktop 专属组合还固定接入 `dshmarket@1.10.1`，在设置中提供**插件市场**。
搜索、安装、更新、卸载、分组和备份只作用于当前 `web` profile，并通过成品
内置的 `pnpm@11.7.0` 执行，不依赖系统 pnpm 或 PATH。Desktop 模式禁用自重启，
会修改状态的 HTTP 路由要求同源回环请求，安装目标必须来自精选目录；没有
Desktop patch 的普通浏览器 profile 不受影响。插件属于第三方代码，安装前
仍应查看源码，并审阅其请求的构建脚本授权。

市场界面采用紧凑的 Harness 单列列表：40 像素图标、两行简介、固定且独立的
搜索／筛选行和分类轨道，以及稳定的“发现／已安装／更新／活动”标签。每个发现项只保留一个
主操作，详情、源码和复制包名统一放入更多菜单。所有 registry 分类都按来源顺序
保留在同一条横向滚动轨道上；切换选择不会重排 chip，边缘控件会反映真实滚动边界。
当前市场包不能停用、卸载或
更新自身（`dshmarket` 与 `dsh-market` 都会在包运行器启动前被拒绝），普通插件
操作仍保留上游路由行为。

全局“个性化”页面只编辑 `$DSH_HOME/AGENTS.md` 中由 Desktop 管理的有界区块。
区块外手工维护的内容会原样保留，保存采用版本冲突检测和原子替换；回复风格可选
默认、简洁、亲和或专业。保存结果从下一次请求起生效，项目内 `AGENTS.md` 仍是
范围更窄的项目规则。

Desktop 使用侧边栏、对话和按需打开的详情布局。轮次导航与左侧边界间隔 16px，并为正文保留独立留白。应用不包含工作台、专用浏览器 IPC、BrowserSkill 或 Open Design。插件市场仍可用，应用不内置 Brain、Memory 或 Evolution。用户安装的插件由 Web profile 管理；移除应用内置组合不会删除插件源码或数据。

“使用统计”为每次 Host 刷新设置 12 秒上限，并通过原生持久化取消信号终止待完成的 Session 读取。已完成记录会保留为部分快照，超时记录会计入省略数，共享刷新始终会结束。活动 Session 的折叠结果只会放在进程内，并在下一条 Session 事件到达时失效；因此重复打开页面不必反复扫描同一份长日志，同时不会把领先于持久化修订的数据写入磁盘。渲染端在首次加载 15 秒后会退出无限占位图并提供“重试”；已有缓存汇总仍保持可见，并显示过期提示。

Desktop 设置外壳统一约束原生、内置与 profile 安装分区的 760 像素内容宽度、页标题、简介和小节标题排版。各插件仍拥有自己的控件与业务布局，但不会再因为来源不同而出现标题字号、顶部留白或正文起点跳变。

## 系统更新

原生更新确认和 Windows 托盘使用操作系统语言，中英文文案统一由 `src/locales.ts` 管理。

未选择项目的新会话使用 `~/deepseek-temp/<sessionId>/`（Windows 位于用户目录下）。会话 header 记录工作目录；重新打开或删除对话历史后，生成文件仍然保留。显式项目和已有会话的位置保持不变。

“系统更新”分别显示正在运行的 Desktop 版本和内置 Harness 核心版本。检查固定的官方 Harness Release 可以提示存在更新的核心，但不会宣称已安装核心已经改变。原生进程选择匹配的 Intel macOS DMG、Windows x64 Setup，或已识别的 Linux x64 `.deb`／AppImage；Linux 安装格式未知时会禁用下载与安装，不会猜测。

下载按 manifest（元数据清单）的准确大小显示已接收字节，服务器未提供 Content-Length 时也如此。取消只清理当前未完成的暂存目录。完整下载必须通过预期 Release URL、字节数、SHA-256、原生文件格式和物理文件检查；验证失败不会启用安装。渲染端不能提供 URL、文件系统路径、校验值或命令。首次状态读取失败时可仅重试状态读取。

macOS 的“重启并安装”会准备现有的受保护替换辅助进程，只有准备成功才退出。Windows 的“打开安装向导”先要求用户保存工作并确认关闭应用。短生命周期的系统引导进程验证独立工作进程后，先于应用退出；工作进程等待准确的父进程退出，再次检查安装包并打开可见 Setup，不传静默安装参数。取消或准备失败会保持应用打开并撤销安装权限；工作进程清理未经确认时报告失败。辅助进程接收交接后，界面只报告已经交接，不会宣称安装成功，也不推测外部向导的结果。

Linux 的“查看安装包”只打开已验证安装包的所在目录，应用继续运行。它不会执行安装包、调用 sudo、修改可执行位、修改 AppArmor 或替换应用。可以重复查看，`.deb` 与 AppImage 各自保留独立安装说明。完整且已验证的安装包在检查更新、发生错误与应用退出后仍会保留；更新器不会自动回收它们或删除用户数据。没有此更新桥接的 Windows 版本需要手动下载 Setup，才能进入这条更新路径。

[原生更新源码](src/update/)拥有安装包选择与安装权限；[设置包](../../packages/client/ui-settings-system-update/README.zh.md)拥有本地化展示。各平台的 manifest 使用不同名称，因此生成 Windows 或 Linux manifest 不会替换 macOS manifest。[更新决策](../../.agents/notes/implemented/architecture/2026-09-09-platform-specific-desktop-updates.zh.md)记录校验机制与原生验收边界。

<a id="icon-provenance"></a>

## 图标来源

`assets/icon-source.png` 是 2026-08-14 通过 macOS 与 Windows 两端验收的
1254×1254 RGBA 正式母版。透明四角、奶白圆角底板、蓝色内层与白色
DeepSeek 白鲸均保持原样，未替换、未重新设计。

母版 SHA-256：
`1fe0c2a3b6475c451f86dc999e97de33e4aabace244e35a284d1c5e162b0672a`

`assets/icon.icns` 是由该母版转换的 macOS 标准 16–1024 px 图标集，
`assets/icon.ico` 是由同一母版生成的 Windows 容器。对应 SHA-256 分别为
`d453a58a11cb5247f83f3b220bca2c6f0f216f07a6c7dfbb4998bb9f9f72c54e`
和 `2331df774341ce7796c1c0d06e708ae37bbde84a53e4edd2741659bbe8d4e4ae`。

## 构建

每个发布产物都在对应的原生操作系统上构建。平台无关的单元测试和暂存检查可以在其他系统运行，但安装包包含原生模块，因此交叉构建结果不能作为发布证据。

### Intel macOS

```bash
pnpm run desktop:pack
pnpm run desktop:dmg
```

两个命令都以 Intel（`x86_64`）macOS 为目标。`desktop:pack` 生成可直接启动的 `.app`，`desktop:dmg` 生成安装镜像。

### Windows x64

```bash
pnpm run desktop:setup
```

这个命令必须在原生 Windows x64 上运行。Setup 名称由 `apps/desktop/package.json` 派生；输出路径为 `apps/desktop/release/DeepSeek-Harness-Setup-<version>-win-x64.exe`。Windows CI 使用独立的短暂存目录，避免原生 MSVC 重编译触发旧式路径长度限制；所有发布产物都写入 `apps/desktop/release`。

Windows Setup 是当前用户范围的可见向导式 NSIS 安装器。正常双击后会依次显示欢迎、安装目录、展开的安装进度／明细与完成页面。安装时，进度条反映实际解压和安装过程，并显示阶段文字与安装明细。静默安装仍可用；它不需要管理员权限，也不需要 Node.js、pnpm、终端、浏览器或固定端口。安装会创建桌面和开始菜单快捷方式，并在完成页提供启动 DeepSeek Harness 的选项。卸载会删除应用和快捷方式，但保留 Harness 与 Electron 用户数据。

### Ubuntu 22.04 / 24.04 x64

在安装了 Clang 15 和 musl-tools 的原生 Ubuntu 22.04 x64 上运行 `pnpm run desktop:linux`。命令会构建并探测 Landlock 启动器、暂存运行时，在 `apps/desktop/release` 生成 `DeepSeek-Harness-<version>-linux-x64.deb` 和 `.AppImage`。Linux 工作流只在 22.04 构建一次，再使用完全相同的安装包字节验证两个 Ubuntu 版本。ARM64 与 Wayland 验收不在本次范围内。

使用 `sudo apt install ./DeepSeek-Harness-<version>-linux-x64.deb` 安装 `.deb`。安装包会配置桌面入口、图标、依赖及应用专属 AppArmor 策略。卸载会保留 Harness 设置、会话和 Electron 用户数据。

AppImage 需要 `lsof`、FUSE 2（22.04 为 `libfuse2`，24.04 为 `libfuse2t64`）和可执行权限。使用 `sudo apt install lsof` 安装启动时检查既存 Harness 写入进程所需的工具。24.04 启动前，使用 `sudo bash scripts/linux-desktop-appimage-policy.sh install /absolute/path/DeepSeek-Harness-<version>-linux-x64.AppImage` 安装绑定准确路径的用户命名空间策略。辅助脚本必须来自安装包对应的源码版本；路径支持 ASCII 字母、数字、空格、斜杠、点、下划线和连字符。移动镜像或更换文件名时，需要使用 `remove` 移除旧路径策略，再为新路径安装。启动器拒绝关闭沙箱的参数；辅助脚本保持系统级用户命名空间限制开启。“系统更新”下载并验证匹配的 Linux 安装包，安装仍由用户手动完成。

应用使用操作系统分配的随机回环端口，不会占用固定的 65000 端口。

每个发布成品都会附带 ASCII/LF 格式的 `.sha256` 文件。成品的精确字节请以
[公开 GitHub Release](https://github.com/Missher12/deepseek-harness-desktop/releases)
及其同名校验文件为准。

## 成品验证

Intel macOS 先生成目录版应用，再运行：

```bash
pnpm exec vitest run apps/desktop/tests/packaged-smoke.spec.ts --config vitest.config.ts
```

Windows 在原生系统生成 Setup 后运行：

```powershell
./scripts/windows-desktop-installer-ui-smoke.ps1 `
  -SetupPath apps/desktop/release/DeepSeek-Harness-Setup-0.5.4-win-x64.exe
./scripts/windows-desktop-setup-smoke.ps1 `
  -SetupPath apps/desktop/release/DeepSeek-Harness-Setup-0.5.4-win-x64.exe
```

可选的 macOS 交互计时使用[原生启动测量器](tests/macos-startup-scenarios.spec.ts)。提供位于 `/private/tmp/dsh-macos-startup-mount-*` 的自有只读挂载目录，设置 `DSH_MACOS_STARTUP_EXECUTABLE`、已核验的 `DSH_MACOS_STARTUP_ASAR_SHA256` 与 `DSH_MACOS_STARTUP_SOURCE_SHA`，以及 `DSH_MACOS_STARTUP_REPETITIONS=1` 或 `10`。脱敏观测写入 `.artifacts/desktop-057-startup/fresh-*`；结果受[测量边界](../../.agents/notes/implemented/architecture/2026-08-18-overlapped-desktop-startup.zh.md)约束。

成品测试使用仓库外的临时工作目录、临时 Electron 用户数据和临时 `DSH_HOME`。macOS 与 Windows 原生验收都会验证 preload、关闭偏好往返、后台保留时关闭隐藏且 Harness 继续运行、恢复窗口、普通与归档 Session ID 写入真实系统剪贴板且不打开／恢复／删除／发送／启动 Agent、对等会话发送／回复元数据、原生无卡片渲染与拒绝分支无副作用、Add 菜单、工作台移除状态、默认向下且可自适应翻转的思考滑块与 effort 持久化、Canvas 确实输出且小人物关闭、使用统计的全部 371 个颗粒与每日／每周／累积悬停语义、插件市场分类顺序稳定及分离后的搜索／筛选／分类几何、随机监听端口，以及原生退出后的完整进程回收。设置测试会检查真实六项操作的更新桥接、准确的运行版本和原生平台展示。真实安装器交接与替换仍须单独进行原生验收；设置分区可见或辅助进程预检并不等于这些证据。工具级验收会另行证明双向 Agent 启动／回复行为、准确 receipt 绑定等待、协作停止与匹配回复拒绝；它不发起外部模型请求。Desktop staging 还要求 staged 树中有且只有一个 `dshmarket@1.10.1`，其源码、Client bundle 与 source map 的紧凑布局和分类轨道标记一致，Host 自保护标记存在，并强制检查不可变 Desktop patch、插件运行时 provider、内置 pnpm 入口及向导式安装器 include 确实进入成品。Windows UI 测试会依次操作可见的欢迎、目录、展开的进度／明细和完成页面；生命周期测试则验证相同功能行为，以及静默安装、快捷方式创建、真实剪贴板复制、卸载清理和数据保留。原生 Windows CI 会从包版本派生产物名、构建 Setup、运行两项测试、记录 SHA-256，并上传两个精确文件。

本地产物没有签名。macOS 可能要求从 Finder 右键菜单选择“打开”，Windows SmartScreen 可能要求确认未知发布者；只有受信任的平台签名凭据才能消除这些系统提示。
