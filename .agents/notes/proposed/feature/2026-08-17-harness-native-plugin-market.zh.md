# Agent Note：Harness 原生插件市场展示

Status: proposed

[English](2026-08-17-harness-native-plugin-market.md) | 中文

## 问题

Desktop 已固定交付 `dshmarket@1.10.1`，但原有卡片网格在设置面板内占用过多横向和纵向空间；该包还允许通过自身更新路由，在请求仍由当前市场进程服务时替换这个市场管理器。

## 决策

保留已发布的包身份、Loader id、设置 id、Host 路由和 Desktop 包运行器。一份经过审计的 pnpm 依赖补丁只修改市场展示与三条当前管理器保护分支。

- “发现”采用单列列表、40 像素图标、两行简介、一个主操作，以及统一承载详情、源码和复制包名的更多菜单。
- 搜索与可横向滚动的分类行保留在 sticky 工具栏中。
- “发现／已安装／更新／活动”是稳定的一级标签；原有主题、分组、备份、对话框与普通包操作继续保留。
- 补丁使用 Harness `--dsw-*` token，不加入粒子或装饰性 canvas。

## 完整性与安全边界

源码基线为已发布的 `dshmarket@1.10.1` tarball 及上游 commit `6970a6f801108c04234eb953ff0f707feffa621a`。补丁包含已审阅的 TypeScript／CSS 源码、重新构建的 Client bundle 与 source map，以及生成后的 Host 路由产物。测试比较稳定的语义标记，而不依赖生成的 CSS 类名 hash。

以 `dshmarket` 或其 Loader 别名 `dsh-market` 为目标的请求，会在文件系统、网络或包运行器执行前返回 `409 { ok: false, code: "self-protected" }`。其他包仍沿用现有运行器；没有 Desktop patch 时，普通浏览器组合保持不变。

## 验收

- frozen-lock 重装必须重新得到完全一致的补丁依赖。
- staging 必须只找到一个 `dshmarket@1.10.1`，源码、Client bundle 与 source map 中的紧凑标记一致，并存在 Host 保护标记。
- 成品 smoke 会打开市场、切换四个一级标签、执行搜索，检查横向分类与每行单一主操作，拒绝自更新，并在隔离临时 profile 中执行一次普通包操作。
- 发布前仍须在原生 Intel macOS 上完成浅色／深色、正常与 200% 缩放的“发现／已安装／更新／活动”验收，确认无溢出且控制台无错误。
