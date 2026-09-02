# DeepSeek Harness 桌面版

[English](README.md) | 中文

这是官方 DeepSeek Harness 运行时的原生桌面外壳。应用只在本机回环地址启动一个由自身管理的 Harness 子进程，端口由操作系统随机分配，现有 Harness Web 客户端运行在加固后的 Electron 窗口内。

侧栏提供类似 Codex 的已归档会话管理器。归档会保留会话日志及其原有
Workspace 位置，可在管理器中原位恢复；永久删除只能从归档管理器进入，
必须明确二次确认，且运行中的会话会被拒绝删除。
每个已有内容的会话都在操作菜单中提供“复制会话 ID”，归档会话卡片也
提供同一操作，复制时不会恢复或删除会话。应用复制完整且稳定的原始 ID，
并根据宿主剪贴板是否接受写入显示结果提示。

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

Desktop 内置一套有明确顺序的本地“记忆与学习”能力：`@deepseek-ai/dsh-missher-brain@0.1.1-rc.2`
负责协调，`dsh-missher-memory@0.2.0` 管理项目事实，Harness 原生
`dsh-missher-evolution@0.1.1` 管理经过验证的流程规则。用户可见设置页会用白话展示
经过审核的项目记忆和学到的工作流程。项目记忆与经验规则共用
唯一的有界召回路径；Provider 超时或失败不会阻塞正常回复。项目记忆新增本地 FTS5
检索和可恢复的精确重复项自动压缩。安装包包含旧 TencentDB 的可选只读读取能力，
但不会打包、写入、迁移或压缩用户数据库，也不会把旧记忆作为 MSE 学习输入。
三个组件都会在插件市场中显示为由 Desktop 管理的内置插件。

“使用统计”现在为每次 Host 刷新设置 12 秒上限，并通过原生持久化取消信号终止待完成的 Session 读取。已完成记录会保留为部分快照，超时记录会计入省略数，共享刷新始终会结束。活动 Session 的折叠结果只会放在进程内，并在下一条 Session 事件到达时失效；因此重复打开页面不必反复扫描同一份长日志，同时不会把领先于持久化修订的数据写入磁盘。渲染端在首次加载 15 秒后会退出无限占位图并提供“重试”；已有缓存汇总仍保持可见，并显示过期提示。

Desktop 设置外壳统一约束原生、内置与 profile 安装分区的 760 像素内容宽度、页标题、简介和小节标题排版。各插件仍拥有自己的控件与业务布局，但不会再因为来源不同而出现标题字号、顶部留白或正文起点跳变。

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

这个命令必须在原生 Windows x64 上运行。Setup 名称由 `apps/desktop/package.json` 派生；0.4.2 会输出 `apps/desktop/release/DeepSeek-Harness-Setup-0.4.2-win-x64.exe`。Windows CI 使用独立的短暂存目录，避免原生 MSVC 重编译触发旧式路径长度限制；所有发布产物都写入 `apps/desktop/release`。

Windows Setup 是当前用户范围的可见向导式 NSIS 安装器。正常双击后会依次显示欢迎、安装目录、展开的安装进度／明细与完成页面；它不需要管理员权限，也不需要 Node.js、pnpm、终端、浏览器或固定端口。安装会创建桌面和开始菜单快捷方式，并在完成页提供启动 DeepSeek Harness 的选项。卸载会删除应用和快捷方式，但保留 Harness 与 Electron 用户数据。

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
  -SetupPath apps/desktop/release/DeepSeek-Harness-Setup-0.4.2-win-x64.exe
./scripts/windows-desktop-setup-smoke.ps1 `
  -SetupPath apps/desktop/release/DeepSeek-Harness-Setup-0.4.2-win-x64.exe
```

成品测试使用仓库外的临时工作目录、临时 Electron 用户数据和临时 `DSH_HOME`。macOS 与 Windows 原生验收都会验证 preload、关闭偏好往返、后台保留时关闭隐藏且 Harness 继续运行、恢复窗口、普通与归档 Session ID 写入真实系统剪贴板且不打开／恢复／删除／发送／启动 Agent、对等会话发送／回复元数据、原生无卡片渲染与拒绝分支无副作用、Add 菜单、四模式工作台、默认向下且可自适应翻转的思考滑块与 effort 持久化、Canvas 确实输出且小人物关闭、使用统计的全部 371 个颗粒与每日／每周／累积悬停语义、插件市场分类顺序稳定及分离后的搜索／筛选／分类几何、随机监听端口，以及原生退出后的完整进程回收。受保护自更新继续仅限 macOS，并在 Windows 上明确验证为不存在。工具级验收会另行证明双向 Agent 启动／回复行为、准确 receipt 绑定等待、协作停止与匹配回复拒绝；它不发起外部模型请求。Desktop staging 还要求 staged 树中有且只有一个 `dshmarket@1.10.1`，其源码、Client bundle 与 source map 的紧凑布局和分类轨道标记一致，Host 自保护标记存在，并强制检查不可变 Desktop patch、插件运行时 provider、内置 pnpm 入口及向导式安装器 include 确实进入成品。Windows UI 测试会依次操作可见的欢迎、目录、展开的进度／明细和完成页面；生命周期测试则验证相同功能行为，以及静默安装、快捷方式创建、真实剪贴板复制、卸载清理和数据保留。原生 Windows CI 会从包版本派生产物名、构建 Setup、运行两项测试、记录 SHA-256，并上传两个精确文件。

本地产物没有签名。macOS 可能要求从 Finder 右键菜单选择“打开”，Windows SmartScreen 可能要求确认未知发布者；只有受信任的平台签名凭据才能消除这些系统提示。
