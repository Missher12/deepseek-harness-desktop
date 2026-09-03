# Intel Mac 两阶段启动进度设计

[English](2026-08-20-macos-two-stage-boot-progress-design.md) | 中文

## 目标

在不展示虚构百分比的前提下，让启动进度清晰可见。采用已批准的 Codex 风格极简方向与官方 DeepSeek 白鲸图标，并把改动限制在 Intel Mac Desktop 界面。

## 范围

启动体验包含两个如实阶段：

1. 内核本地 Electron 页面显示一个四像素 indeterminate 进度条，同时原生 shell 检查运行时所有权并启动本地 Harness。
2. Harness URL 可用后，Web 启动页面切换为 determinate 四像素进度条。百分比由已激活 Client 条目数除以完整启动 roster 得出。

普通浏览器界面和非 macOS Desktop 界面保留现有启动呈现。

## 视觉设计

- 使用官方圆角 DeepSeek 白鲸图标，居中放在紧凑的 `DeepSeek Harness` 字标上方。
- 用近黑背景上的一层克制蓝色径向光晕，替换现有网格、扫描线、角落装饰、轨道和抽象标记。
- 使用五像素高、最大 300 像素宽的轨道，配单调增长的蓝至青色填充和低强度光晕。
- 在轨道上方放置一行安静、易读的副标题。本地阶段显示 `正在准备你的工作区`，不显示数值百分比。
- 插件阶段在左侧显示当前活动、右侧显示推导百分比。即使可见文案更短，无障碍文本仍保留 `正在加载组件 {active}/{total}`。
- 应用标题栏和周围原生窗口视觉保持不变。
- 达到 100% 后，只在应用渲染器替换启动界面前保留完成状态；不增加人为延迟。

## 组件与数据流

### 本地启动页面

`apps/desktop/renderer/loading-macos.html` 保持自包含且不访问网络。它使用打包的本地图标资源，并通过 ARIA 与动画明确表示 indeterminate 进度。禁止由定时器生成百分比。

### Client 启动页面

`packages/client/web/src/boot-page.ts` 已持有启动 roster 和已激活条目集合。它将公开一个仅限 macOS Desktop 的线性进度元素，并更新：

- `aria-valuemin=0`、`aria-valuemax=100` 和当前 `aria-valuenow`；
- 填充宽度，使用截断到合法范围的整数百分比；
- 可见状态文本中的已激活数量与总数。

其他界面继续使用现有圆形进度呈现。平台选择来自已有的 `surface=desktop` query 与 macOS user agent，不增加 IPC 或新的原生权限。仅限 Mac 的 Web 呈现沿用居中的本地页面构图，使两个阶段之间的导航不会明显改变视觉语言。

## 失败与边界情况

- 启动条目为零时显示 0%，且不出现除零错误。
- 已激活条目只能让显示百分比增加；重复状态通知不会重复计数。
- 插件失败时，使用现有失败报告替换进度呈现。
- reduced-motion 模式移除扫动动画，同时保留可见轨道和 determinate 宽度。
- 窄窗口把状态、百分比和轨道保持在 320 像素 viewport 内。

## 测试

实施遵循 red-green-refactor：

1. 扩展 renderer-page 测试，要求可见的四像素 indeterminate Mac 轨道和状态标签。
2. 扩展 `BootPage` 测试，要求 macOS Desktop 线性进度语义、计数、单调百分比和失败替换。
3. 证明生产代码修改前新测试会失败。
4. 运行聚焦的 renderer 与 Web 启动测试套件、368 项功能矩阵、生产构建、打包 Electron smoke 和 `hdiutil verify`。
5. 安装生成的 Intel x64 应用并目视验证启动过程，不改动 `~/.dsh`。

## 验收标准

- 原生 Mac 启动时立即显示官方白鲸图标、紧凑居中字标和五像素进度条。
- 本地运行时阶段绝不声称虚构百分比。
- 插件阶段报告真实 roster 进度，并在全部条目激活时达到 100%。
- 现有失败可见性、CSP 限制、reduced-motion 行为、系统更新、会话通信、Usage Insights、推理控制和插件市场行为保持完好。
- 最终应用仍为 Intel x86_64，并使用随机 loopback 端口且不打开浏览器。

## 非目标

- 不重新设计 Windows 或普通浏览器界面。
- 不增加 IPC channel 或进度 telemetry。
- 不改变后台 updater 行为。
- 不为了展示动画而人为延长启动时间。
