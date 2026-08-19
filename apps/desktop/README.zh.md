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
Calling 或 Code Mode 会启动 A 的已有 Agent，A 可通过 receipt 绑定元数据回复 B；任意
一方之后也能使用对方 ID 发起另一条消息。四个工具覆盖直接发送、可选的发送并等待、
一次性 Host 授权回复和显式匹配回复等待。收到的消息使用 Harness 原生上下文折叠行，
不再显示自定义消息卡片。会话标题栏入口会打开记忆宽度的 320–560 px 操作抽屉，用于
精确 ID 复制、发送／回复、待处理／未读状态和只含元数据的活动记录；“启动目标 Agent”
默认开启，窄窗口下会占满宽度。它不会创建新会话、subagent 或自主 Agent 对聊循环，
收到的文字始终按不可信内容处理。

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

这个命令必须在原生 Windows x64 上运行，输出 `apps/desktop/release/DeepSeek-Harness-Setup-0.1.9-win-x64.exe`。Windows CI 使用独立的短暂存目录，避免原生 MSVC 重编译触发旧式路径长度限制；所有发布产物都写入 `apps/desktop/release`。

Windows Setup 是当前用户范围的一键 NSIS 安装器，不需要管理员权限，也不需要 Node.js、pnpm、终端、浏览器或固定端口；交互式安装完成后，它会创建桌面和开始菜单快捷方式并启动 DeepSeek Harness。卸载会删除应用和快捷方式，但保留 Harness 与 Electron 用户数据。

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
./scripts/windows-desktop-setup-smoke.ps1 `
  -SetupPath apps/desktop/release/DeepSeek-Harness-Setup-0.1.9-win-x64.exe
```

成品测试使用仓库外的临时工作目录、临时 Electron 用户数据和临时 `DSH_HOME`。Intel macOS 测试会验证 preload、三栏工作台、普通与归档 Session ID 写入真实系统剪贴板且不打开／恢复／删除／发送／启动 Agent、对等会话发送／回复元数据、默认启动开关、原生无卡片渲染、抽屉宽度持久化与拒绝分支无副作用、默认向下且可自适应翻转的思考滑块与 effort 持久化、Canvas 确实输出且小人物关闭、使用统计的全部 371 个颗粒与每日／每周／累积悬停语义、插件市场分类顺序稳定及分离后的搜索／筛选／分类几何、自更新保护、隔离 profile 中真实卸载普通插件、随机监听端口，以及原生退出后的完整进程回收。工具级验收会另行证明双向 Agent 启动／回复行为、可选的精确 receipt 绑定等待与匹配回复拒绝；它不发起外部模型请求。Desktop staging 还要求 staged 树中有且只有一个 `dshmarket@1.10.1`，其源码、Client bundle 与 source map 的紧凑布局和分类轨道标记一致，Host 自保护标记存在，并强制检查不可变 Desktop patch、插件运行时 provider 及内置 pnpm 入口确实进入成品。Windows 测试会验证相同功能行为，以及静默安装、快捷方式创建、真实剪贴板复制、卸载清理和数据保留。原生 Windows CI 会构建 Setup、运行这项测试、记录 SHA-256，并上传两个文件。

本地产物没有签名。macOS 可能要求从 Finder 右键菜单选择“打开”，Windows SmartScreen 可能要求确认未知发布者；只有受信任的平台签名凭据才能消除这些系统提示。
