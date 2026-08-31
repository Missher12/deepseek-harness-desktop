# Built-in Agent Presets Expansion Implementation Plan

English | [中文](2026-08-20-agent-presets-expansion.zh.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the four existing built-in Agent presets and add eight manually selected, role-specific presets to the internal Intel macOS DeepSeek Harness application.

**Architecture:** Each role is a normal shipped preset directory discovered by the existing roster. New compositions are independent snapshots of the standard composition with a concise shared operating contract, a role contract, and only the tool-surface reductions explicitly listed below; the existing UI, session persistence, and gateway APIs remain unchanged.

**Tech Stack:** TypeScript, Vitest, Cordis YAML compositions, React locale bundles, Electron, pnpm.

---

## File map

- `packages/preset/agent-presets/presets/{planner,frontend,backend,debugger,reviewer,qa,devops,research}/preset.yml`: shipped display metadata and order 5–12.
- `packages/preset/agent-presets/presets/{planner,frontend,backend,debugger,reviewer,qa,devops,research}/agent.cordis.yml`: complete role composition snapshots.
- `apps/cli/tests/web-agent-presets.e2e.ts`: shipped-roster, mount, prompt, and tool-catalog coverage.
- `packages/client/ui-agent-preset/src/client/locales.ts`: English and Chinese display copy for all twelve shipped ids.
- `packages/client/ui-agent-preset/tests/locales.client.spec.ts`: built-in localization coverage.
- `apps/web/tests/agent-preset-selection.e2e.ts` and its snapshots: manual selector coverage for the expanded roster.
- `PROJECT_CONTEXT.md`: current roster and internal macOS delivery state.

### Task 1: Lock the expanded roster with failing tests

**Files:**
- Modify: `apps/cli/tests/web-agent-presets.e2e.ts`
- Modify: `packages/client/ui-agent-preset/tests/locales.client.spec.ts`

- [ ] **Step 1: Change the shipped-roster assertion to the exact twelve ids**

Use this ordered constant and compare sorted ids to its sorted copy:

```ts
const SHIPPED_PRESET_IDS = [
  'standard', 'code', 'minimal', 'cordis',
  'planner', 'frontend', 'backend', 'debugger',
  'reviewer', 'qa', 'devops', 'research',
] as const
```

- [ ] **Step 2: Add a mount matrix for the eight new roles**

For each new id, create an Agent through `ctx.agentPresets.mount`, assemble its system prompt, and assert the prompt contains `Codex-style operating contract` plus that role's exact marker:

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

Assert every role has `read`, `grep`, `skill`, `plan`, `ask_user_question`, and `web_search`. Assert the five execution roles (`frontend`, `backend`, `debugger`, `qa`, `devops`) retain `jobs`, `subagent`, and `workflow`; assert `planner`, `reviewer`, and `research` do not expose those three tools.

- [ ] **Step 3: Expand the locale test matrix to all twelve shipped ids**

Add the eight entries using the exact key pairs `presetPlanner*`, `presetFrontend*`, `presetBackend*`, `presetDebugger*`, `presetReviewer*`, `presetQa*`, `presetDevops*`, and `presetResearch*`.

- [ ] **Step 4: Run the focused tests and confirm the red state**

Run:

```bash
pnpm exec vitest run packages/client/ui-agent-preset/tests/locales.client.spec.ts apps/cli/tests/web-agent-presets.e2e.ts
```

Expected: failure because the eight directories and locale keys do not yet exist.

### Task 2: Add the eight shipped compositions

**Files:**
- Move: `packages/preset/agent-presets/presets/planner/{preset.yml,agent.cordis.yml}`
- Move: `packages/preset/agent-presets/presets/frontend/{preset.yml,agent.cordis.yml}`
- Move: `packages/preset/agent-presets/presets/backend/{preset.yml,agent.cordis.yml}`
- Move: `packages/preset/agent-presets/presets/debugger/{preset.yml,agent.cordis.yml}`
- Move: `packages/preset/agent-presets/presets/reviewer/{preset.yml,agent.cordis.yml}`
- Move: `packages/preset/agent-presets/presets/qa/{preset.yml,agent.cordis.yml}`
- Move: `packages/preset/agent-presets/presets/devops/{preset.yml,agent.cordis.yml}`
- Move: `packages/preset/agent-presets/presets/research/{preset.yml,agent.cordis.yml}`

- [ ] **Step 1: Create the metadata files**

Use orders 5–12 and these exact names and descriptions:

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

- [ ] **Step 2: Create complete composition snapshots from `standard`**

For every role, preserve the standard composition body and replace the persona with this shared prefix followed by the role contract:

```yaml
- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    text: |-
      You are a coding agent powered by the {{model}} model. Your working directory is {{cwd}}.

      Codex-style operating contract: understand the target, repository instructions, current behavior, and affected data flow before changing files. For non-trivial work, form a short plan and keep changes bounded. Prefer evidence over assumptions, preserve unrelated worktree changes, avoid destructive actions, verify in proportion to risk, and report outcomes, changed surfaces, tests, and limitations accurately.
```

Append exactly one of these complete role lines:

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

- [ ] **Step 3: Reduce the focused-role tool surface**

In `planner`, `reviewer`, and `research`, remove the entire `background jobs` section and the entire `delegation and workflows` section from the standard snapshot. In `reviewer` and `research`, also remove the `goals` section. Do not remove filesystem inspection, search, Skills, plan mode, compaction, ask-user, todo, or web search.

- [ ] **Step 4: Validate every Cordis composition**

Run:

```bash
pnpm run verify-cordis-config
```

Expected: exit 0 with no host/Agent plane overlap diagnostics.

- [ ] **Step 5: Run the CLI preset test**

Run:

```bash
pnpm exec vitest run apps/cli/tests/web-agent-presets.e2e.ts
```

Expected: all tests pass and every new role mounts successfully.

### Task 3: Localize all shipped role names

**Files:**
- Modify: `packages/client/ui-agent-preset/src/client/locales.ts`
- Test: `packages/client/ui-agent-preset/tests/locales.client.spec.ts`

- [ ] **Step 1: Add sixteen locale keys**

Add `Name` and `Description` keys for the eight ids to `AgentPresetSettingsKey`, the English bundle, the Chinese bundle, and `BUILT_IN_PRESET_KEYS`.

- [ ] **Step 2: Use exact English display copy**

Use `Planning`, `Frontend and UI`, `Backend and API`, `Troubleshooting`, `Code review`, `Testing and QA`, `DevOps and release`, and `Documentation and research`; translate the metadata descriptions faithfully rather than exposing the Chinese `preset.yml` copy in English UI.

- [ ] **Step 3: Run locale tests**

Run:

```bash
pnpm exec vitest run packages/client/ui-agent-preset/tests/locales.client.spec.ts
```

Expected: all shipped ids resolve locale copy while user and unknown system presets retain file metadata.

### Task 4: Verify manual selection and update product documentation

**Files:**
- Modify: `apps/web/tests/agent-preset-selection.e2e.ts`
- Modify: `apps/web/tests/snapshots/agent-preset-selection/menu.expected.md`
- Modify: `packages/client/ui-agent-preset/README.md`
- Modify: `packages/client/ui-agent-preset/README.zh.md`
- Modify: `packages/client/ui-agent-preset/README.i18n.yaml`
- Modify: `PROJECT_CONTEXT.md`

- [ ] **Step 1: Assert the menu contains the new roles and no automatic control**

Keep the existing manual selection flow and assert the menu snapshot contains `Planning`, `Frontend and UI`, `Code review`, and `DevOps and release`. Assert it contains no automatic-routing control.

- [ ] **Step 2: Refresh only the preset-menu golden snapshot**

Run the repository's existing `DSH_SNAPSHOT=refresh` mode for `apps/web/tests/agent-preset-selection.e2e.ts`, inspect the resulting menu snapshot, then rerun without update mode.

- [ ] **Step 3: Update bilingual package documentation and project context**

Document the twelve built-ins, manual-only selection, session lock, and the fact that role prompts are not permission enforcement. Refresh the translation-pair record with:

```bash
pnpm run verify-translation-pairing --write packages/client/ui-agent-preset/README.md
pnpm run verify-translation-pairing packages/client/ui-agent-preset/README.md
```

- [ ] **Step 4: Run the focused browser test**

Run:

```bash
pnpm exec vitest run apps/web/tests/agent-preset-selection.e2e.ts
```

Expected: the expanded manual menu, selection, locked-session label, and browser console checks pass.

### Task 5: Complete verification, package, and install

**Files:**
- Verify: all modified source, configuration, tests, and documentation
- Build: `apps/desktop/release/mac/DeepSeek Harness.app`
- Install: `/Applications/DeepSeek Harness.app`

- [ ] **Step 1: Run focused and source-wide verification**

Run:

```bash
pnpm exec vitest run packages/client/ui-agent-preset/tests apps/cli/tests/web-agent-presets.e2e.ts apps/web/tests/agent-preset-selection.e2e.ts
pnpm run verify-cordis-config
pnpm run verify-translation-pairing
pnpm run typecheck
pnpm run lint
```

Expected: every command exits 0.

- [ ] **Step 2: Build the final Intel macOS application**

Run:

```bash
pnpm run desktop:pack
```

Expected: Electron produces `apps/desktop/release/mac/DeepSeek Harness.app` with an x86_64 Mach-O executable.

- [ ] **Step 3: Run the packaged native smoke test**

Run:

```bash
pnpm exec vitest run apps/desktop/tests/packaged-smoke.spec.ts
```

Expected: the real Electron application opens, the Settings surface is usable, and the smoke test exits cleanly.

- [ ] **Step 4: Install recoverably**

Gracefully quit the running app, move the current `/Applications/DeepSeek Harness.app` to a timestamped directory under `/Users/missher/Library/Application Support/DeepSeek Harness Backups/`, copy the verified build with `ditto`, compare the executable and `app.asar` bytes, and launch the exact `/Applications` path.

- [ ] **Step 5: Verify the installed application**

Confirm the running main process path is `/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness`, open Agent presets, and verify the installed roster shows all twelve manually selectable roles. Do not upload any artifact to GitHub.
