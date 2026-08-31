# 内置 Agent 预设扩展实施计划

[English](2026-08-20-agent-presets-expansion.md) | 中文

> **供 Agent 工作进程使用：** 必须使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans，逐项实施本计划。步骤使用复选框（`- [ ]`）跟踪。

**目标：** 保留现有四个内置 Agent 预设，并向内部 Intel macOS DeepSeek Harness 应用增加八个由用户手动选择的角色预设。

**架构：** 每个角色都是由现有名单发现的普通随附预设目录。新组装是标准组装的独立快照，携带简洁的共同工作契约、角色契约，以及下文明确列出的工具表面缩减；现有 UI、会话持久化和网关 API 保持不变。

**技术栈：** TypeScript、Vitest、Cordis YAML 组装、React locale bundle、Electron、pnpm。

---

## 文件映射

- `packages/preset/agent-presets/presets/{planner,frontend,backend,debugger,reviewer,qa,devops,research}/preset.yml`：随附展示元数据与 5–12 顺序。
- `packages/preset/agent-presets/presets/{planner,frontend,backend,debugger,reviewer,qa,devops,research}/agent.cordis.yml`：完整角色组装快照。
- `apps/cli/tests/web-agent-presets.e2e.ts`：随附名单、挂载、提示词和工具目录覆盖。
- `packages/client/ui-agent-preset/src/client/locales.ts`：全部十二个随附 id 的中英文展示文案。
- `packages/client/ui-agent-preset/tests/locales.client.spec.ts`：内置预设本地化覆盖。
- `apps/web/tests/agent-preset-selection.e2e.ts` 及其快照：扩展名单的手动选择覆盖。
- `PROJECT_CONTEXT.md`：当前名单与内部 macOS 交付状态。

### 任务 1：用失败测试锁定扩展名单

**文件：**
- 修改：`apps/cli/tests/web-agent-presets.e2e.ts`
- 修改：`packages/client/ui-agent-preset/tests/locales.client.spec.ts`

- [ ] **步骤 1：把随附名单断言改为精确的十二个 id**

使用下方有序常量，并把排序后的 id 与它的排序副本比较：

```ts
const SHIPPED_PRESET_IDS = [
  'standard', 'code', 'minimal', 'cordis',
  'planner', 'frontend', 'backend', 'debugger',
  'reviewer', 'qa', 'devops', 'research',
] as const
```

- [ ] **步骤 2：为八个新角色增加挂载矩阵**

对每个新 id，通过 `ctx.agentPresets.mount` 创建 Agent、组装系统提示词，并断言提示词包含 `Codex-style operating contract` 以及该角色的精确标记：

```ts
const ROLE_MARKERS = {
  planner: 'Role: planning',
  frontend: 'Role: frontend and UI',
  backend: 'Role: backend and API',
  debugger: 'Role: troubleshooting',
  reviewer: 'Role: code review',
  qa: 'Role: testing and QA',
  devops: 'Role: DevOps and release',
  research: 'Role: documentation and research',
} as const
```

断言每个角色都拥有 `read`、`grep`、`skill`、`plan`、`ask_user_question` 和 `web_search`。断言五个执行角色（`frontend`、`backend`、`debugger`、`qa`、`devops`）保留 `jobs`、`subagent` 和 `workflow`；断言 `planner`、`reviewer` 与 `research` 不暴露这三个工具。

- [ ] **步骤 3：把 locale 测试矩阵扩展到全部十二个随附 id**

使用精确键对 `presetPlanner*`、`presetFrontend*`、`presetBackend*`、`presetDebugger*`、`presetReviewer*`、`presetQa*`、`presetDevops*` 与 `presetResearch*` 添加八项。

- [ ] **步骤 4：运行聚焦测试并确认红灯状态**

运行：

```bash
pnpm exec vitest run packages/client/ui-agent-preset/tests/locales.client.spec.ts apps/cli/tests/web-agent-presets.e2e.ts
```

预期：由于八个目录和 locale 键尚不存在而失败。

### 任务 2：增加八个随附组装

**文件：**
- 迁移：`packages/preset/agent-presets/presets/planner/{preset.yml,agent.cordis.yml}`
- 迁移：`packages/preset/agent-presets/presets/frontend/{preset.yml,agent.cordis.yml}`
- 迁移：`packages/preset/agent-presets/presets/backend/{preset.yml,agent.cordis.yml}`
- 迁移：`packages/preset/agent-presets/presets/debugger/{preset.yml,agent.cordis.yml}`
- 迁移：`packages/preset/agent-presets/presets/reviewer/{preset.yml,agent.cordis.yml}`
- 迁移：`packages/preset/agent-presets/presets/qa/{preset.yml,agent.cordis.yml}`
- 迁移：`packages/preset/agent-presets/presets/devops/{preset.yml,agent.cordis.yml}`
- 迁移：`packages/preset/agent-presets/presets/research/{preset.yml,agent.cordis.yml}`

- [ ] **步骤 1：创建元数据文件**

使用 5–12 顺序以及这些精确名称和描述：

```ts
const roles = [
  ['planner', 5, '方案规划', '澄清目标、检查证据、比较方案，并在实现前交付可执行计划。'],
  ['frontend', 6, '前端与 UI', '构建精致界面，覆盖响应式布局、无障碍、交互状态和视觉验证。'],
  ['backend', 7, '后端与 API', '处理 API、数据模型、持久化、兼容性、安全边界和集成测试。'],
  ['debugger', 8, '故障排查', '先复现并隔离根因，再执行最小且获得授权的修复。'],
  ['reviewer', 9, '代码审查', '从正确性、回归、安全和测试完整性审查代码，按严重性报告问题。'],
  ['qa', 10, '测试与 QA', '设计基于风险的测试、复现用户流程，并区分环境失败与产品缺陷。'],
  ['devops', 11, 'DevOps 与发布', '负责构建、打包、CI、部署预检、回滚规划和产物验证。'],
  ['research', 12, '文档与研究', '阅读代码和资料、综合结论、维护精确文档，并明确标注不确定性。'],
] as const
```

- [ ] **步骤 2：从 `standard` 创建完整组装快照**

每个角色保留标准组装正文，并把 persona 替换为下方共同前缀，随后接角色契约：

```yaml
- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    text: |-
      You are a coding agent powered by the {{model}} model. Your working directory is {{cwd}}.

      Codex-style operating contract: understand the target, repository instructions, current behavior, and affected data flow before changing files. For non-trivial work, form a short plan and keep changes bounded. Prefer evidence over assumptions, preserve unrelated worktree changes, avoid destructive actions, verify in proportion to risk, and report outcomes, changed surfaces, tests, and limitations accurately.
```

精确追加下列一条完整角色行：

```text
Role: planning. Clarify intent, inspect relevant evidence, compare viable approaches, and deliver an executable plan before implementation. Default to analysis; do not modify project files unless the user explicitly overrides this role boundary.
Role: frontend and UI. Build polished user interfaces. Treat responsive geometry, accessibility, keyboard behavior, loading and error states, theme compatibility, and visual verification as acceptance requirements.
Role: backend and API. Design and implement APIs, data models, persistence, compatibility, security boundaries, and focused integration tests. Protect existing data and prefer forward-compatible changes.
Role: troubleshooting. Reproduce the failure first, isolate root cause, separate evidence from inference, and diagnose before editing. Apply the smallest authorized fix and add a regression test.
Role: code review. Review code and behavior for correctness, regressions, security, maintainability, and missing tests. Lead with actionable findings ordered by severity. Default to review only and do not modify files unless explicitly asked.
Role: testing and QA. Build a risk-based test matrix, reproduce real user flows, capture evidence, and separate environment failures from product defects. Do not silently repair product code during a report-only request.
Role: DevOps and release. Handle local builds, packaging, CI diagnosis, deployment preflight, rollback planning, and artifact verification. Production writes, publication, credential use, and destructive actions require explicit authorization.
Role: documentation and research. Read code and authoritative sources, synthesize precise conclusions, preserve citations and uncertainty, and keep documentation consistent with observed behavior. Default to analysis and documentation; do not change product code unless explicitly asked.
```

- [ ] **步骤 3：缩减聚焦角色的工具表面**

在 `planner`、`reviewer` 和 `research` 中，移除标准快照的整个 `background jobs` 分区以及整个 `delegation and workflows` 分区。在 `reviewer` 和 `research` 中继续移除 `goals` 分区。不得移除文件系统检查、搜索、Skills、计划模式、压缩、询问用户、todo 或网页搜索。

- [ ] **步骤 4：验证每个 Cordis 组装**

运行：

```bash
pnpm run verify-cordis-config
```

预期：退出码为 0，并且没有 Host/Agent 平面重叠诊断。

- [ ] **步骤 5：运行 CLI 预设测试**

运行：

```bash
pnpm exec vitest run apps/cli/tests/web-agent-presets.e2e.ts
```

预期：所有测试通过，每个新角色都能成功挂载。

### 任务 3：本地化全部随附角色名称

**文件：**
- 修改：`packages/client/ui-agent-preset/src/client/locales.ts`
- 测试：`packages/client/ui-agent-preset/tests/locales.client.spec.ts`

- [ ] **步骤 1：增加十六个 locale 键**

为八个 id 的 `Name` 和 `Description` 增加键，并加入 `AgentPresetSettingsKey`、英文 bundle、中文 bundle 和 `BUILT_IN_PRESET_KEYS`。

- [ ] **步骤 2：使用精确英文展示文案**

使用 `Planning`、`Frontend and UI`、`Backend and API`、`Troubleshooting`、`Code review`、`Testing and QA`、`DevOps and release` 与 `Documentation and research`；忠实翻译元数据描述，不在英文界面暴露 `preset.yml` 的中文文案。

- [ ] **步骤 3：运行 locale 测试**

运行：

```bash
pnpm exec vitest run packages/client/ui-agent-preset/tests/locales.client.spec.ts
```

预期：全部随附 id 都解析 locale 文案，而用户预设和未知系统预设仍使用文件元数据。

### 任务 4：验证手动选择并更新产品文档

**文件：**
- 修改：`apps/web/tests/agent-preset-selection.e2e.ts`
- 修改：`apps/web/tests/snapshots/agent-preset-selection/menu.expected.md`
- 修改：`packages/client/ui-agent-preset/README.md`
- 修改：`packages/client/ui-agent-preset/README.zh.md`
- 修改：`packages/client/ui-agent-preset/README.i18n.yaml`
- 修改：`PROJECT_CONTEXT.md`

- [ ] **步骤 1：断言菜单包含新角色且没有自动控件**

保留现有手动选择流程，并断言菜单快照包含 `Planning`、`Frontend and UI`、`Code review` 与 `DevOps and release`。断言其中没有自动路由控件。

- [ ] **步骤 2：只刷新预设菜单黄金快照**

以仓库已有的 `DSH_SNAPSHOT=refresh` 模式运行 `apps/web/tests/agent-preset-selection.e2e.ts`，检查生成的菜单快照，然后在不带更新模式时重新运行。

- [ ] **步骤 3：更新双语包文档和项目上下文**

记录十二个内置预设、仅手动选择、会话锁定，以及角色提示词不是权限强制。使用下方命令刷新翻译配对记录：

```bash
pnpm run verify-translation-pairing --write packages/client/ui-agent-preset/README.md
pnpm run verify-translation-pairing packages/client/ui-agent-preset/README.md
```

- [ ] **步骤 4：运行聚焦浏览器测试**

运行：

```bash
pnpm exec vitest run apps/web/tests/agent-preset-selection.e2e.ts
```

预期：扩展后的手动菜单、选择、锁定会话标签和浏览器控制台检查全部通过。

### 任务 5：完成验证、打包与安装

**文件：**
- 验证：全部修改过的源码、配置、测试和文档
- 构建：`apps/desktop/release/mac/DeepSeek Harness.app`
- 安装：`/Applications/DeepSeek Harness.app`

- [ ] **步骤 1：运行聚焦与源码范围验证**

运行：

```bash
pnpm exec vitest run packages/client/ui-agent-preset/tests apps/cli/tests/web-agent-presets.e2e.ts apps/web/tests/agent-preset-selection.e2e.ts
pnpm run verify-cordis-config
pnpm run verify-translation-pairing
pnpm run typecheck
pnpm run lint
```

预期：每条命令退出码均为 0。

- [ ] **步骤 2：构建最终 Intel macOS 应用**

运行：

```bash
pnpm run desktop:pack
```

预期：Electron 生成 `apps/desktop/release/mac/DeepSeek Harness.app`，其可执行文件为 x86_64 Mach-O。

- [ ] **步骤 3：运行打包后原生冒烟测试**

运行：

```bash
pnpm exec vitest run apps/desktop/tests/packaged-smoke.spec.ts
```

预期：真实 Electron 应用打开，设置表层可用，且冒烟测试干净退出。

- [ ] **步骤 4：可恢复地安装**

正常退出运行中的应用，把当前 `/Applications/DeepSeek Harness.app` 移动到 `/Users/missher/Library/Application Support/DeepSeek Harness Backups/` 下带时间戳的目录，使用 `ditto` 复制已验证构建，比较可执行文件和 `app.asar` 字节，并启动确切的 `/Applications` 路径。

- [ ] **步骤 5：验证已安装应用**

确认主进程运行路径是 `/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness`，打开 Agent 预设，并验证已安装名单显示全部十二个可手动选择的角色。不得向 GitHub 上传任何产物。
