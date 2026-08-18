# DeepSeek Harness 使用统计实施计划

[English](2026-08-18-deepseek-harness-usage-insights.md) | 中文

> **给智能体执行者：** 必须使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans，逐项执行本计划。遵守仓库当前 `AGENTS.md`；只有当前协作策略允许时才能委派。

**目标：** 在 macOS DeepSeek Harness 设置面板中加入保护隐私、覆盖全部历史的使用统计页，尽量贴近用户提供的参考图，同时只展示持久会话日志能够准确支撑的指标。

**架构：** Host 包把不可变会话检查结果折叠为逐会话派生行，并以会话 id 和不透明日志修订值为键写入可重建 storage domain。只读 Typert Remote 把这些行聚合成有界快照。Client 包负责设置分区、局部化渲染、图表投影、加载/错误状态和响应式样式。Web bundle 装配两端；Electron 不新增 IPC 或文件权限。

**技术栈：** TypeScript、Cordis 服务与 Loader、Typert Remote 生成、Zod 存储 schema、React 18、CSS Modules、Vitest、Testing Library、Playwright/Electron 打包脚本。

---

## 文件地图

- 新建 `packages/session/usage-insights/`，容纳纯折叠、缓存 schema、聚合服务、Remote 合同、不变量、文档和测试。
- 新建 `packages/client/ui-settings-usage/`，容纳设置槽位注册、React 仪表盘、图表辅助函数、局部化字典、CSS、不变量、文档和测试。
- 修改 `packages/api/remotes/src/client/index.ts`、包元数据和引用，挂载并重新导出生成的 Remote Client。
- 只修改 `packages/client/ui-settings-general/src/client/SettingsRoot.tsx`，给新 `usage` 分区分配原生导航图标。
- 修改 `packages/bundle/web-app/cordis.patch.yml` 和 `package.json`，装配 Host 与 Client 包。
- 修改根 TypeScript 项目引用以及由包清单生成的工作区元数据。
- 在 `.agents/notes/implemented/feature/` 下新增已实施的双语 Agent Note。
- 更新 `PROJECT_CONTEXT.md`，记录交付行为、边界和当前验证证据。

### 任务 1：先为纯会话折叠建立红灯测试

**文件：**

- 新建：`packages/session/usage-insights/tests/fold.spec.ts`
- 新建：`packages/session/usage-insights/src/types.ts`
- 新建：`packages/session/usage-insights/src/fold.ts`

**步骤：**

- [ ] 添加 `turn/start`、`turn/end`、提供商 usage chunk/最终消息、请求模型/推理强度变化、直接与嵌套工具调用、显式 skill-invocation 来源、错误 skill 参数以及 fork `seedLength` 的夹具。
- [ ] 断言同 turn/step 重复 usage 样本使用替换语义，并断言 reasoning token 不会重复计数。
- [ ] 断言本地时区日期分桶、DST 安全连续天数、已完成 turn 时长、当前连续天数可止于昨天，以及全历史最长连续天数。
- [ ] 断言非有限、负数、小数及超出安全整数范围的提供商计数被省略并增加不完整计数，而非估算。
- [ ] 运行 `pnpm vitest run packages/session/usage-insights/tests/fold.spec.ts`，确认实现前新预期失败。
- [ ] 实现同步纯折叠，仅保留派生的数字/名称数据，并忽略 `header.seedLength` 之前的事件。
- [ ] 重跑聚焦测试并提交 `feat(usage): fold durable session activity`。

### 任务 2：构建可重建 Host 索引与聚合 Remote

**文件：**

- 新建：`packages/session/usage-insights/src/spec.ts`
- 新建：`packages/session/usage-insights/src/aggregate.ts`
- 新建：`packages/session/usage-insights/src/index.ts`
- 新建：`packages/session/usage-insights/src/invariant.ts`
- 新建：`packages/session/usage-insights/tests/service.spec.ts`
- 新建：`packages/session/usage-insights/tests/invariant.spec.ts`
- 新建：`packages/session/usage-insights/tests/loader-composition.spec.ts`
- 新建：`packages/session/usage-insights/package.json`
- 新建：`packages/session/usage-insights/tsconfig.json`

**步骤：**

- [ ] 先写服务红灯测试，覆盖首次回填、修订复用、会话变更/删除、时区重建、缓存损坏/版本不匹配恢复、共享单次刷新、取消隔离、部分读取失败和实时失效竞争。
- [ ] 定义 `usage_insights` storage domain；记录只包含会话身份/修订值、时区、末尾 seq、逐日数字桶、模型/推理强度计数、skill/tool 计数和聚合标量。
- [ ] 实现只读 `UsageInsightsGateway.snapshot()`：列修订值、复用匹配行、只 inspect 已变更行、删除已消失行、聚合有界的近十二个月逐日序列和前五项功能，并返回被省略会话数。
- [ ] 缓冲或失效实时 `session/event` 变更，确保进行中的回填不会覆盖更新的内存事实；在完整 turn 边界和会话释放时合并持久缓存更新。
- [ ] 在无提供商密钥情况下证明真实 Loader 装配，并证明卸载会释放 Remote 与 storage domain。
- [ ] 运行 Host 聚焦测试，再运行 `pnpm run build:lib:host` 生成 `./typert` 与 `./remote` 产物。
- [ ] 提交 `feat(usage): index all local session history`。

### 任务 3：在 Client API 装配中挂载 Remote

**文件：**

- 修改：`packages/api/remotes/src/client/index.ts`
- 修改：`packages/api/remotes/package.json`
- 修改：`packages/api/remotes/tsconfig.client.json`
- 修改：`packages/api/remotes/tsconfig.host.json`
- 修改：`tsconfig.base.json`
- 修改：`tsconfig.host.json`

**步骤：**

- [ ] 添加生成的 Remote contribution import 和 Client-safe 快照类型重新导出。
- [ ] 添加工作区依赖及项目引用，不能把 Host 运行时值引入浏览器代码。
- [ ] 运行 remotes 类型检查/构建门禁，验证 `ctx.remote.usageInsights.snapshot()` 端到端具有类型。
- [ ] 与后续 Client 功能一起提交，确保组装后的 wire 已被真正测试。

### 任务 4：先为 Client 投影与页面状态建立红灯测试

**文件：**

- 新建：`packages/client/ui-settings-usage/tests/projection.client.spec.ts`
- 新建：`packages/client/ui-settings-usage/tests/components.client.spec.tsx`
- 新建：`packages/client/ui-settings-usage/tests/browser-usage.client.spec.tsx`
- 新建：`packages/client/ui-settings-usage/tests/invariant.client.spec.ts`

**步骤：**

- [ ] 断言符合 locale 的紧凑 token/时长格式，且不会把“不可用”转成零。
- [ ] 断言每日、每周与累计口径都保留完整 53×7 颗粒场，并具有稳定强度、符合当前口径的悬停总数，以及由 Host 本地日期范围导出的月份标签。
- [ ] 断言加载、空状态、部分数据、错误/重试、tab 键盘行为、顶级功能徽标和可访问的指标/图表摘要。
- [ ] 断言 800px 窗口、常规约 564px 内容列和 200% 缩放/窄布局均无页面级水平溢出。
- [ ] 运行 Client 聚焦测试，确认实现不存在时失败。

### 任务 5：实现贴近参考图的设置分区

**文件：**

- 新建：`packages/client/ui-settings-usage/src/client/index.ts`
- 新建：`packages/client/ui-settings-usage/src/client/UsageInsightsSection.tsx`
- 新建：`packages/client/ui-settings-usage/src/client/charts.ts`
- 新建：`packages/client/ui-settings-usage/src/client/format.ts`
- 新建：`packages/client/ui-settings-usage/src/client/locales.ts`
- 新建：`packages/client/ui-settings-usage/src/client/UsageInsightsSection.module.css`
- 新建：`packages/client/ui-settings-usage/src/index.ts`
- 新建：`packages/client/ui-settings-usage/src/invariant.ts`
- 新建：`packages/client/ui-settings-usage/src/css-modules.d.ts`
- 新建：`packages/client/ui-settings-usage/package.json`
- 新建：`packages/client/ui-settings-usage/tsconfig.json`
- 新建：`packages/client/ui-settings-usage/tsdown.config.ts`
- 修改：`packages/client/ui-settings-general/src/client/SettingsRoot.tsx`
- 修改：`tsconfig.client.json`

**步骤：**

- [ ] 以 order 12 注册 `settings.section` id `usage`，使其位于 Models 与 Plugins 之间；局部化标签为 `使用统计` / `Usage`。
- [ ] 渲染五个等宽 KPI、每日/每周/累计颗粒 tab、活动洞察，以及带真实 Skill/Tool 徽标的“最常用的功能”。每日保持 53×7 日历热力图；每周与累计按周日对齐并从下向上填充每列，同时提供对应口径的中英文浮层文案。
- [ ] 使用已有 `--dsw-alias-*` token、表格数字、语义控件、暗色模式安全 color mixing、减少动画行为和响应式换行，且不改变全局设置面板宽度。
- [ ] 通过已有 primitive vocabulary 加入独立原生导航图标，同时保留未知分区的齿轮 fallback。
- [ ] 运行 Client 聚焦测试并提交 `feat(settings): add usage insights dashboard`。

### 任务 6：装配实际 Web/Mac bundle 并记录包合同

**文件：**

- 修改：`packages/bundle/web-app/cordis.patch.yml`
- 修改：`packages/bundle/web-app/package.json`
- 新建：`packages/session/usage-insights/README.md`
- 新建：`packages/session/usage-insights/README.zh.md`
- 新建：`packages/session/usage-insights/README.i18n.yaml`
- 新建：`packages/client/ui-settings-usage/README.md`
- 新建：`packages/client/ui-settings-usage/README.zh.md`
- 新建：`packages/client/ui-settings-usage/README.i18n.yaml`
- 新建：`.agents/notes/implemented/feature/2026-08-18-local-usage-insights.md`
- 新建：`.agents/notes/implemented/feature/2026-08-18-local-usage-insights.zh.md`
- 新建：`.agents/notes/implemented/feature/2026-08-18-local-usage-insights.i18n.yaml`
- 修改：`PROJECT_CONTEXT.md`

**步骤：**

- [ ] 在 storage/session persistence 之后挂载 Host 包，在 API remotes 与 Settings 基础服务之后挂载 Client 包。
- [ ] 添加包文档，覆盖 Model Experience、KV cache 计数、隐私边界、冷回填成本、部分数据以及旧 tool call 不能归因到 Loader plugin 的限制。
- [ ] 在双语 Agent Note 中记录已实施的 extension-point 与缓存决定；重新生成翻译 sidecar。
- [ ] 更新项目上下文中的实现状态和带日期验证证据。
- [ ] 运行翻译配对、Markdown 链接/换行、文档同步、包清单与 TypeScript 项目引用门禁。
- [ ] 提交 `docs: record local usage insights boundary`。

### 任务 7：运行仓库级回归与视觉验收

**文件：**

- 仅测试；只有失败由本变更导致时，才修复已在本功能范围内的文件。

**步骤：**

- [ ] 对两个新包运行 Host/Client 聚焦覆盖率，要求 100%。
- [ ] 运行变更包 lint/typecheck/build 以及真实 Web Loader 装配测试。
- [ ] 以确定性隔离 `DSH_HOME` 启动组装后的 Web 设置页；截取常规宽度、暗色主题、窄布局和 200% 缩放截图，并检查控制台错误和水平溢出。
- [ ] 独立折叠同一批夹具日志，对比 UI 的五项 KPI、活动单元、洞察行和顶级功能与预期数字。
- [ ] 运行 `git diff --check`、生成文件检查、不变量门禁以及适用于改动包的仓库 pre-push 清单。

### 任务 8：在不修改真实历史的前提下打包并验收 Intel macOS 应用

**文件：**

- 只在仓库既有 desktop distribution 路径内产生构建输出。

**步骤：**

- [ ] 使用仓库既定 desktop 打包命令构建 Intel macOS 产物。
- [ ] 让已打包 `.app` 使用隔离的确定性 `DSH_HOME` 启动；验证设置页、tab、暗色模式、缩放、重试路径，并确认无控制台/运行时错误。
- [ ] 验收前后计算夹具 JSONL 日志哈希，必须逐字节一致。
- [ ] 对用户已有 `~/.dsh` 进行最终只读验收：把 UI 总数与独立离线折叠结果对比，并确认所有历史 artifact 均未改变。
- [ ] 只有隔离验收通过后，才通过仓库既定可恢复安装路径安装/替换 Mac 应用，并保留上一版恢复路径。
- [ ] 记录 artifact 路径、架构、版本、大小、SHA-256、测试、截图及剩余限制。
- [ ] 只有全部必需验收通过后，才通知 Codex 任务 `019ffbac-ff3a-7be0-920c-d6bffb1ffcfc` 已完成。
