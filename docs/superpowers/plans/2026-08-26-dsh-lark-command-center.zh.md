# `dsh-lark` Harness 命令中心实现计划

[English](2026-08-26-dsh-lark-command-center.md) | 中文

> **面向 agent worker：** 必须使用 superpowers:executing-plans，按任务执行本计划。步骤使用复选框（`- [ ]`）语法跟踪。

**目标：** 让精确 `/` 打开完整、仅所有者可用的 Harness 命令中心，并通过 Harness 原生服务对当前普通 Session 执行受支持操作。

**架构：** 包内新增 `CommandCenterService`，负责渲染签名卡片，并把固定远程安全命令集合适配到当前 Agent 与 Host API。`CommandRouter` 保留身份/事件准入和普通消息的持久化路由。`BindingController` 新增一条严格的新建 Session 绑定路径。不修改 Harness 核心或 Desktop 会话代码。

**技术栈：** TypeScript、Cordis、Host ApiProxy、Harness 命令/工具/后台任务注册表、Zod、Vitest、飞书交互卡片、pnpm workspace 工具。

---

### 任务 1：记录并配对已批准设计

**文件：**
- 新建：`docs/superpowers/specs/2026-08-26-dsh-lark-command-center-design.md`
- 新建：`docs/superpowers/specs/2026-08-26-dsh-lark-command-center-design.zh.md`
- 新建：`docs/superpowers/specs/2026-08-26-dsh-lark-command-center-design.i18n.yaml`
- 新建：`docs/superpowers/plans/2026-08-26-dsh-lark-command-center.md`
- 新建：`docs/superpowers/plans/2026-08-26-dsh-lark-command-center.zh.md`
- 新建：`docs/superpowers/plans/2026-08-26-dsh-lark-command-center.i18n.yaml`

- [ ] 使用仓库配对工具验证两组双语文件。

### 任务 2：用失败测试固定路由和新建 Session 行为

**文件：**
- 修改：`packages/extensions/lark/tests/commands.host.spec.ts`
- 修改：`packages/extensions/lark/tests/binding.host.spec.ts`

- [ ] 要求精确 `/` 调用 `sendCommandCenter`，而 `/进入` 与 `/切换` 保留项目选择。
- [ ] 要求命令别名、参数校验、已知 skill 持久化准入和未知斜杠帮助。
- [ ] 要求 `bindCreated` 只接受当前 workspace 返回、cwd 匹配的精确普通 Session（包括空白 Session），并拒绝所有陈旧或跨项目目标。
- [ ] 运行聚焦测试并观察 RED。

### 任务 3：实现命令中心和签名选择器

**文件：**
- 新建：`packages/extensions/lark/src/command-center.ts`
- 修改：`packages/extensions/lark/src/commands.ts`
- 修改：`packages/extensions/lark/src/binding.ts`
- 修改：`packages/extensions/lark/src/state.ts`
- 修改：`packages/extensions/lark/src/index.ts`
- 修改：`packages/extensions/lark/package.json`
- 修改：`packages/extensions/lark/tsconfig.json`

- [ ] 渲染包含有界安全按钮的完整目录。
- [ ] 把 Session 新建/重命名、模型/推理选择、原生命令、skill、工具、后台任务/subagent、用量和诊断适配到当前 Harness 服务。
- [ ] 扩展命令中心、模型提供方、模型和推理选择的签名一次性 action 类型。
- [ ] 原生命令使用固定白名单；skill 进入持久队列前必须存在于当前用户可调用目录。
- [ ] 卡片回调通过同一身份 action 准入边界路由。
- [ ] 运行聚焦测试并观察 GREEN。

### 任务 4：新增服务级测试并保护既有行为

**文件：**
- 新建：`packages/extensions/lark/tests/command-center.host.spec.ts`
- 修改：`packages/extensions/lark/tests/identity.host.spec.ts`
- 修改：`packages/extensions/lark/tests/state.host.spec.ts`

- [ ] 测试目录完整性、action 签名、模型与推理重新校验、原生命令白名单、有界视图和诊断脱敏。
- [ ] 测试模型/提供方失败，以及新建成功但绑定失败的报告。
- [ ] 运行完整 Lark 测试套件。

### 任务 5：记录已交付行为

**文件：**
- 修改：`packages/extensions/lark/README.md`
- 修改：`packages/extensions/lark/README.zh.md`
- 修改：`packages/extensions/lark/README.i18n.yaml`
- 修改：`PROJECT_CONTEXT.md`
- 新建：`.agents/notes/implemented/feature/2026-08-26-lark-harness-command-center.md`
- 新建：`.agents/notes/implemented/feature/2026-08-26-lark-harness-command-center.zh.md`
- 新建：`.agents/notes/implemented/feature/2026-08-26-lark-harness-command-center.i18n.yaml`

- [ ] 记录精确命令行为、安全边界、模型体验和已知排除项。
- [ ] 验证每组双语文件和仓库文档门禁。

### 任务 6：构建、安装并验证可移除 Bundle

**文件：**
- 修改：仅包依赖变化所必需的生成 manifest/lock 产物。
- 仅本地新建：`artifacts/` 下的版本化 tarball。

- [ ] 运行类型检查、lint/diff 检查、包 Bundle 构建和 pack 检查。
- [ ] 把精确 tarball 安装到当前 `web` Profile，重启 Harness，并在不输出密钥或身份值的前提下验证已启用、已连接、已配对和已绑定状态。
- [ ] 验证已安装包字节与 tarball 一致，并确认插件仍可独立移除。
- [ ] 运行仓库 pre-push 检查，只提交预期文件，并推送 `codex/dsh-lark-desktop-compat`。
