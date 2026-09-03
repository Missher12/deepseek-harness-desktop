# Desktop 0.5.3 alpha.5 core-sync 所有权清单

[English](desktop-0.5.3-core-sync-compatibility.md) | 中文

## 精确坐标

- 已发布的 Desktop 产品树：`7384b863e88b005b3309e49a0aebb7a2ea91d4c3`。
- 用于此分支的 task-book 子节点：`6155fc78bfd4ffeef196979157bb1d82b1243bfc`。
- 在树外读取的 task-book 修订版：`6fcd393f40f0e83c6ba79925c38e28c94bebb092`。
- 官方 rc.2 比较树：位于 `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` 的 `dsh-v0.1.1-rc.2`。
- 官方导入目标：位于 `db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5` 的 `dsh-v0.1.2-alpha.5`。
- Task 2 Desktop 叠加头：`f6944b1ad34c0ed2132584ae1b623950c18813a6`。
- 产品索引预检树：`f1bafd1ca6e21d965b34a8a2cb192ce741150599`（307 条冲突消息）。
- post-alpha.5-index 模拟样本：`493be26fc5bd5588ad31412b45ea93ee4bd13ee6`（308 条冲突消息，仅使用 Task 2 头）。

Desktop 和官方仓库具有不相关的 Git 根。普通合并、空树合并或不相关历史内容合并不是可接受的内容集成机制。批准的路径是后续的树不变双亲溯源提交、精确的 alpha.5 树物化提交，然后是基于此清单逐一解决冲突的显式基语义合并。这些拓扑或物化步骤尚未在此工作树中执行。

更广泛的所有权清单将每个产品树与精确的官方 rc.2 树进行比较（禁用重命名检测），交叉更改的路径集，然后拒绝最终 Desktop 和 alpha.5 字节已匹配的路径。已发布的 Desktop 更改了 1,074 个原始路径端点，alpha.5 更改了 7,991 个原始路径端点，交集包含 443 个最终内容不同的路径。Git 重命名统计报告约 7,633 个 alpha.5 文件更改；下面保留原始端点计数，以便重命名的两侧都不会从所有权审查中消失。

Task 2 之后，确切的诊断命令是 `git merge-tree --write-tree --name-only --messages --merge-base=b150a551b8d465e31e418e1b2eaf5e79bbb7d28e f6944b1ad34c0ed2132584ae1b623950c18813a6 db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`。在 Desktop 产品索引下的两次逐字节相同运行按预期返回状态 1，未写入任何索引/工作树状态，并生成预检树 `f1bafd1ca6e21d965b34a8a2cb192ce741150599`。其 307 条冲突消息包括 242 条 `content`、56 条 `modify/delete`、8 条 `file location` 和 1 条 `directory rename split`；仅名称预演包含 306 个具体路径，因为目录拆分消息命名的是结构源前缀而非一个输出路径。

早期诊断对 Desktop 输入使用了符号 `HEAD`，生成了非权威树。`git merge-tree` 在未解决的冲突标记中持久化命令行输入拼写，因此该树包含 `<<<<<<< HEAD`，而权威树包含 `<<<<<<< f6944b1ad34c0ed2132584ae1b623950c18813a6`。对象级差异为 215 个文件和 524 次仅标签插入加上 524 次仅标签删除。因此，每个可重现性命令和后续物化步骤都必须使用上述完整不可变提交 ID，绝不使用符号引用。

翻译配对合并驱动程序也对索引敏感：`repositoryTranslationPairSource` 从当前索引读取配对清单，`gitMergeInputPaths` 将该索引与公布的合并头结合。使用已物化为 alpha.5 的跟踪树和索引、可用的 alpha.5 驱动程序运行时以及相同的不可变 Task 2 输入进行的隔离模拟生成了样本树 `493be26fc5bd5588ad31412b45ea93ee4bd13ee6`。它有 308 条消息：243 条 `content`、56 条 `modify/delete`、8 条 `file location` 和 1 条 `directory rename split`。唯一添加的冲突路径是 `.agents/notes/implemented/architecture/2026-08-12-pi-ai-route-default-input-modalities.i18n.yaml`，分类为 `generated-after-import`。此样本证明了执行清单，但不是最终的物化树：此阶段创建的清单修订提交必须成为冻结的预溯源 Desktop 叠加输入，并且必须在拓扑工作之前对该确切提交进行一次模拟，而不创建自引用的后续提交来记录其生成的树哈希。

## 处置方式

- `take-upstream`：精确导入 alpha.5 路径。官方应用程序、核心、测试、文档和工具结构拥有它。
- `retain-desktop-extension`：精确保留已发布的 Desktop 路径。这包括不拥有官方包图或共享测试拓扑的 Desktop 专属应用程序和平台特定边界。
- `reimplement-on-alpha5-seam`：首先导入 alpha.5 包/布局真相，然后通过聚焦测试恢复所需的 Desktop 行为。不整体复制旧的 rc.2 文件。
- `generated-after-import`：使用仓库生成器或快照/配对工作流程从已解析的源重新生成；不要手动选择任一生成的副本。

预期的执行状态冲突消息处置：`take-upstream` 18 条，`retain-desktop-extension` 1 条，`reimplement-on-alpha5-seam` 205 条，`generated-after-import` 84 条（共 308 条）。产品索引预检是相同的清单，但没有那一条索引敏感的配对外围文件，共 307 条消息。更广泛的 443 路径最终字节重叠清单分类为：`take-upstream` 40 条，`retain-desktop-extension` 5 条，`reimplement-on-alpha5-seam` 281 条，`generated-after-import` 117 条。

## Task 2 升级 RED 基线

确切命令是 `pnpm vitest run packages/session/session-projection-cache/tests/desktop-upgrade-fixtures.spec.ts packages/boot/app-boot/tests/profile.spec.ts apps/desktop/tests/packaged-smoke-helpers.spec.ts --config vitest.config.ts`。在未更改的 Desktop 产品行为上运行了 44 个测试：41 个现有配置档案和打包助手契约通过，而三个新的升级 fixture 按预期失败。这些失败证明 rc.2 整体单元标题尚未迁移到 alpha.5 每条记录文件中，alpha.3 每条记录标题尚未读取，无效派生记录尚未备份和跳过。这三种情况在导入和实现 alpha.5 会话接缝之前保持 RED；它们不仅仅是因为 fixture 文件和不受影响的 41 个测试有效就被声称 GREEN。

## 预期执行状态冲突清单

post-alpha.5-index 模拟中的每条冲突消息在下面都有一行。文件位置行记录 Desktop 源和 Git 建议的 alpha.5 目标；唯一的目录拆分行记录其结构源前缀。冻结的 post-manifest 叠加必须在拓扑工作开始之前重现这 308 个路径/类型/处置集合。

| 路径或结构前缀 | 冲突类型 | 处置方式 |
|---|---|---|
| `.agents/notes/implemented/architecture/2026-08-05-profile-plugin-bundles.i18n.yaml` | `content` | `generated-after-import` |
| `.agents/notes/implemented/architecture/2026-08-12-pi-ai-route-default-input-modalities.i18n.yaml` | `content` | `generated-after-import` |
| `.agents/notes/implemented/feature/2026-08-11-workspace-sidebar-order-and-folding.i18n.yaml` | `content` | `generated-after-import` |
| `.agents/notes/implemented/feature/2026-08-11-workspace-sidebar-order-and-folding.md` | `content` | `take-upstream` |
| `.agents/notes/implemented/feature/2026-08-11-workspace-sidebar-order-and-folding.zh.md` | `content` | `take-upstream` |
| `.github/workflows/ci.yml` | `content` | `reimplement-on-alpha5-seam` |
| `.github/workflows/e2e.yml` | `content` | `reimplement-on-alpha5-seam` |
| `README.i18n.yaml` | `content` | `generated-after-import` |
| `THIRD_PARTY_NOTICES.md` | `content` | `generated-after-import` |
| `apps/cli/src/profile-boot.ts` | `content` | `reimplement-on-alpha5-seam` |
| `apps/cli/tests/web-agent-presets.e2e.ts` | `content` | `take-upstream` |
| `apps/web/tests/built-boot.expected.e2e.ts` | `content` | `reimplement-on-alpha5-seam` |
| `apps/web/tests/command-image-envelope.expected.e2e.ts` | `content` | `reimplement-on-alpha5-seam` |
| `apps/web/tests/expected/agent-preset-selection/menu.expected.md` | `content` | `generated-after-import` |
| `apps/web/tests/expected/goal-command-presentation/ui.expected.md` | `content` | `generated-after-import` |
| `apps/web/tests/expected/markdown-cjk-strong/ui.expected.md` | `content` | `generated-after-import` |
| `apps/web/tests/expected/markdown-images/ui.expected.md` | `content` | `generated-after-import` |
| `apps/web/tests/expected/markdown-inline-code-links/ui.expected.md` | `content` | `generated-after-import` |
| `apps/web/tests/expected/math-rendering/ui.expected.md` | `content` | `generated-after-import` |
| `apps/web/tests/expected/reference-composer/order.expected.md` | `content` | `generated-after-import` |
| `apps/web/tests/expected/skill-user-invoke/ui-expanded.expected.md` | `content` | `generated-after-import` |
| `apps/web/tests/expected/stats-paged-history/ui.expected.md` | `content` | `generated-after-import` |
| `apps/web/tests/expected/steer-all/mid-steer.expected.md` | `content` | `generated-after-import` |
| `apps/web/tests/expected/steer-all/settled-expanded.expected.md` | `content` | `generated-after-import` |
| `apps/web/tests/lifecycle-chrome.e2e.ts` | `content` | `reimplement-on-alpha5-seam` |
| `apps/web/tests/plan-review.e2e.ts` | `content` | `reimplement-on-alpha5-seam` |
| `apps/web/tests/snapshots/skill-tool-row/ui.expected.md` | `modify/delete` | `generated-after-import` |
| `apps/web/tests/support.ts` | `content` | `reimplement-on-alpha5-seam` |
| `docs/capability-seams.i18n.yaml` | `content` | `generated-after-import` |
| `docs/capability-seams.md` | `content` | `take-upstream` |
| `docs/capability-seams.zh.md` | `content` | `take-upstream` |
| `docs/config-catalog.i18n.yaml` | `content` | `generated-after-import` |
| `docs/config-catalog.md` | `content` | `generated-after-import` |
| `docs/config-catalog.zh.md` | `content` | `generated-after-import` |
| `docs/event-producer-consumer.i18n.yaml` | `content` | `generated-after-import` |
| `docs/event-producer-consumer.md` | `content` | `generated-after-import` |
| `docs/event-producer-consumer.zh.md` | `content` | `generated-after-import` |
| `docs/module-graph.i18n.yaml` | `content` | `generated-after-import` |
| `docs/module-graph.md` | `content` | `generated-after-import` |
| `docs/module-graph.zh.md` | `content` | `generated-after-import` |
| `docs/persistence-catalog.i18n.yaml` | `content` | `generated-after-import` |
| `docs/persistence-catalog.md` | `content` | `generated-after-import` |
| `docs/persistence-catalog.zh.md` | `content` | `generated-after-import` |
| `docs/subsystems/extensions.i18n.yaml` | `content` | `generated-after-import` |
| `docs/subsystems/extensions.md` | `content` | `generated-after-import` |
| `docs/subsystems/extensions.zh.md` | `content` | `generated-after-import` |
| `docs/subsystems/llm-streaming.i18n.yaml` | `content` | `generated-after-import` |
| `docs/subsystems/llm-streaming.md` | `content` | `generated-after-import` |
| `docs/subsystems/llm-streaming.zh.md` | `content` | `generated-after-import` |
| `docs/subsystems/session.i18n.yaml` | `content` | `generated-after-import` |
| `docs/subsystems/session.md` | `content` | `generated-after-import` |
| `docs/subsystems/session.zh.md` | `content` | `generated-after-import` |
| `examples/headless-agent/tests/fixtures/deepseek-defaults.cordis.yml` | `modify/delete` | `take-upstream` |
| `knip.json` | `modify/delete` | `reimplement-on-alpha5-seam` |
| `package.json` | `content` | `reimplement-on-alpha5-seam` |
| `packages/api/remotes/package.json` | `content` | `reimplement-on-alpha5-seam` |
| `packages/api/remotes/src/agent-lookup.ts` | `modify/delete` | `reimplement-on-alpha5-seam` |
| `packages/api/remotes/src/client/index.ts` | `content` | `reimplement-on-alpha5-seam` |
| `packages/api/remotes/tests/agent-lookup.spec.ts` | `modify/delete` | `reimplement-on-alpha5-seam` |
| `packages/api/session-controller/src/client/sessions/queue-mirror.ts` | `content` | `reimplement-on-alpha5-seam` |
| `packages/api/session-controller/src/client/sessions/service.ts` | `content` | `reimplement-on-alpha5-seam` |
| `packages/host/apiproxy/tests/api-proxy-history.spec.ts -> packages/api/session-controller/tests/api-proxy-history.spec.ts` | `file location` | `reimplement-on-alpha5-seam` |
| `packages/host/apiproxy/tests/api-proxy-renderer-attachments.spec.ts -> packages/api/session-controller/tests/api-proxy-renderer-attachments.spec.ts` | `file location` | `reimplement-on-alpha5-seam` |
| `packages/api/session-controller/tests/manager.client.spec.ts` | `content` | `reimplement-on-alpha5-seam` |
| `packages/host/apiproxy/tests/personalization-document-atomic.spec.ts -> packages/api/session-controller/tests/personalization-document-atomic.spec.ts` | `file location` | `reimplement-on-alpha5-seam` |
| `packages/host/apiproxy/tests/personalization-document.spec.ts -> packages/api/session-controller/tests/personalization-document.spec.ts` | `file location` | `reimplement-on-alpha5-seam` |
| `packages/api/session-controller/tests/queue-store.client.spec.ts` | `content` | `reimplement-on-alpha5-seam` |
| `packages/api/session-controller/tests/session-models.host.spec.ts` | `content` | `reimplement-on-alpha5-seam` |
| `packages/attachment/attachment-local/README.i18n.yaml` | `content` | `generated-after-import` |
| `packages/attachment/attachment-local/README.md` | `content` | `reimplement-on-alpha5-seam` |
| `packages/attachment/attachment-local/README.zh.md` | `content` | `reimplement-on-alpha5-seam` |
| `packages/attachment/attachment-local/package.json` | `content` | `reimplement-on-alpha5-seam` |
| `packages/attachment/attachment-local/src/index.ts` | `content` | `reimplement-on-alpha5-seam` |
| `packages/attachment/attachment-local/src/invariant.ts` | `modify/delete` | `reimplement-on-alpha5-seam` |
| `packages/attachment/attachment-local/src/store.ts` | `content` | `reimplement-on-alpha5-seam` |
| `packages/attachment/attachment/src/admission.ts` | `content` | `reimplement-on-alpha5-seam` |
| `packages/attachment/attachment/src/index.ts` | `content` | `reimplement-on-alpha5-seam` |
| `packages/attachment/attachment/tests/admission.spec.ts` | `content` | `reimplement-on-alpha5-seam` |
| `packages/boot/app-boot/README.i18n.yaml` | `content` | `generated-after-import` |
| `packages/boot/app-boot/README.md` | `content` | `reimplement-on-alpha5-seam` |
| `packages/boot/app-boot/README.zh.md` | `content` | `reimplement-on-alpha5-seam` |
| `packages/boot/app-boot/src/index.ts` | `content` | `reimplement-on-alpha5-seam` |
| `packages/boot/app-boot/src/profile.ts` | `content` | `reimplement-on-alpha5-seam` |
| `packages/boot/app-boot/tests/profile.spec.ts` | `content` | `reimplement-on-alpha5-seam` |
| `packages/bundle/web-app/cordis.patch.yml` | `content` | `reimplement-on-alpha5-seam` |
| `packages/bundle/web-app/package.json` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/connection/README.i18n.yaml` | `content` | `generated-after-import` |
| `packages/client/connection/README.md` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/connection/README.zh.md` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/connection/package.json` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/connection/src/client/api.ts` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/connection/src/client/fixture.ts` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/connection/src/client/index.ts` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/connection/src/index.ts` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/connection/tests/fake-api.client.ts` | `modify/delete` | `reimplement-on-alpha5-seam` |
| `packages/client/connection/tests/fixture.client.spec.ts` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/connection/tests/node-half.host.spec.ts` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/runtime/README.md` | `modify/delete` | `reimplement-on-alpha5-seam` |
| `packages/client/runtime/README.zh.md` | `modify/delete` | `reimplement-on-alpha5-seam` |
| `packages/client/runtime/src/client/contract/session.ts` | `modify/delete` | `reimplement-on-alpha5-seam` |
| `packages/client/runtime/src/client/contract/sessions-port.ts` | `modify/delete` | `reimplement-on-alpha5-seam` |
| `packages/client/runtime/src/client/contract/workspaces.ts` | `modify/delete` | `reimplement-on-alpha5-seam` |
| `packages/client/runtime/src/client/index.ts` | `modify/delete` | `reimplement-on-alpha5-seam` |
| `packages/client/runtime/src/client/sessions/assistant-timing.ts` | `modify/delete` | `reimplement-on-alpha5-seam` |
| `packages/client/runtime/src/client/sessions/session.ts` | `modify/delete` | `reimplement-on-alpha5-seam` |
| `packages/client/runtime/src/client/workspaces/manager.ts` | `modify/delete` | `reimplement-on-alpha5-seam` |
| `packages/client/runtime/src/client/workspaces/service.ts` | `modify/delete` | `reimplement-on-alpha5-seam` |
| `packages/client/runtime/tests/fake-api.client.ts` | `modify/delete` | `reimplement-on-alpha5-seam` |
| `packages/client/runtime/tests/session.client.spec.ts` | `modify/delete` | `reimplement-on-alpha5-seam` |
| `packages/client/runtime/tests/workspaces-service.client.spec.ts` | `modify/delete` | `reimplement-on-alpha5-seam` |
| `packages/client/tsdown.client.ts` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-agent-preset/README.i18n.yaml` | `content` | `generated-after-import` |
| `packages/client/ui-agent-preset/README.md` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-agent-preset/README.zh.md` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-agent-preset/src/client/locales.ts` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-attachment/src/MessageImage.tsx` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-attachment/src/client/MessageImages.tsx` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-chat/README.i18n.yaml` | `content` | `generated-after-import` |
| `packages/client/ui-chat/src/client/chat/ChatView.module.css` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-chat/src/client/chat/MessageItem.tsx` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-conversation/src/client/chat/PromptRail.tsx -> packages/client/ui-chat/src/client/chat/PromptRail.tsx` | `file location` | `take-upstream` |
| `packages/client/ui-chat/src/client/chat/ReasoningRow.module.css` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-chat/src/client/chat/ReasoningRow.tsx` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-conversation/src/client/chat/RelayNodeView.module.css -> packages/client/ui-chat/src/client/chat/RelayNodeView.module.css` | `file location` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-conversation/src/client/chat/RelayNodeView.tsx -> packages/client/ui-chat/src/client/chat/RelayNodeView.tsx` | `file location` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-chat/src/client/chat/StatsLine.tsx` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-conversation/src/client/chat/usage-money.ts -> packages/client/ui-chat/src/client/chat/usage-money.ts` | `file location` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-chat/src/client/conversation-nodes/message.ts` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-chat/src/client/conversation-nodes/tool.ts` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-chat/src/client/model/tool-call-tree.ts` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-chat/tests/chat-branch-tails.client.spec.tsx` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-chat/tests/chat-stats.client.spec.tsx` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-chat/tests/reasoning-row.client.spec.tsx` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-conversation/README.i18n.yaml` | `content` | `generated-after-import` |
| `packages/client/ui-conversation/README.md` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-conversation/README.zh.md` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-conversation/package.json` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-conversation/src/client/apply.ts` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-conversation/src/client/chat/ChatNodeSeat.tsx` | `modify/delete` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-conversation/src/client/chat/ChatView.tsx` | `modify/delete` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-conversation/src/client/contract/records.ts` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-conversation/src/client/contract/slots.ts` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-conversation/src/client/index.ts` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-conversation/src/client/locales.ts` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-conversation/src/client/service.ts` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-conversation/src/client/skeleton/ApprovalPanel.module.css` | `modify/delete` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-conversation/src/client/skeleton/ApprovalPanel.tsx` | `modify/delete` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-conversation/src/client/skeleton/ConversationRoot.tsx` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-conversation/src/client/skeleton/EmptyHero.tsx` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-conversation/src/client/skeleton/InputBar.tsx` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-conversation/tests/apply-inject.client.spec.tsx` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-conversation/tests/chat-apply.client.spec.tsx` | `modify/delete` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-conversation/tests/chat-view.client.spec.tsx` | `modify/delete` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-conversation/tests/input-bar.client.spec.tsx` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-conversation/tests/input-matrix.client.spec.tsx` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-conversation/tests/service-orchestration.client.spec.ts` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-conversation/tests/skeleton.client.spec.tsx` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-input-trigger/README.i18n.yaml` | `content` | `generated-after-import` |
| `packages/client/ui-input-trigger/README.md` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-input-trigger/README.zh.md` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-input-trigger/src/client/MenuView.module.css` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-input-trigger/src/client/MenuView.tsx` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-input-trigger/src/client/controller.ts` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-input-trigger/src/client/index.ts` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-input-trigger/src/client/slots.ts` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-input-trigger/tests/menu-view.client.spec.tsx` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-layout/src/client/AppFrame.tsx` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-layout/src/client/DocumentTitle.tsx` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-layout/tests/document-title.client.spec.tsx` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-model-selection/tests/model-select.client.spec.tsx` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-primitives/tests/icons.client.spec.tsx` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-settings-general/src/client/SettingsRoot.module.css` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-settings-general/src/client/SettingsRoot.tsx` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-settings-general/tests/settings-root.client.spec.tsx` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-settings-models/README.i18n.yaml` | `content` | `generated-after-import` |
| `packages/client/ui-settings-models/README.md` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-settings-models/README.zh.md` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-settings-models/tests/provider-form.client.spec.tsx` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-sidebar/README.i18n.yaml` | `content` | `generated-after-import` |
| `packages/client/ui-sidebar/README.md` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-sidebar/README.zh.md` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-sidebar/src/client/SidebarRoot.tsx` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-sidebar/tests/__snapshots__/sidebar-snapshot.client.spec.tsx.snap` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-sidebar/tests/sidebar-root.client.spec.tsx` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-trajectory/package.json` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-trajectory/src/client/trajectory-message-definitions.ts` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-trajectory/src/client/trajectory-tool-definition.ts` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-workspace/src/client/index.ts` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-workspace/src/client/rows/Rows.tsx` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-workspace/src/client/rows/WorkspaceBrowser.tsx` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-workspace/tests/rows.client.spec.tsx` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-workspace/tests/workspace-picker.client.spec.tsx` | `content` | `reimplement-on-alpha5-seam` |
| `packages/client/web/tests/boot.client.spec.ts` | `content` | `reimplement-on-alpha5-seam` |
| `packages/core/session/src/index.ts` | `content` | `reimplement-on-alpha5-seam` |
| `packages/core/session/src/known-event-types.ts` | `content` | `reimplement-on-alpha5-seam` |
| `packages/extensions/cordis-client-runner/src/client/slot-catalog.ts` | `content` | `reimplement-on-alpha5-seam` |
| `packages/extensions/tool-cordis/src/api-catalog.ts` | `content` | `reimplement-on-alpha5-seam` |
| `packages/host/apiproxy/README.md` | `modify/delete` | `reimplement-on-alpha5-seam` |
| `packages/host/apiproxy/README.zh.md` | `modify/delete` | `reimplement-on-alpha5-seam` |
| `packages/host/apiproxy/package.json` | `modify/delete` | `reimplement-on-alpha5-seam` |
| `packages/host/apiproxy/src/api-proxy.ts` | `modify/delete` | `reimplement-on-alpha5-seam` |
| `packages/host/apiproxy/src/api/events.ts` | `modify/delete` | `reimplement-on-alpha5-seam` |
| `packages/host/apiproxy/src/api/index.ts` | `modify/delete` | `reimplement-on-alpha5-seam` |
| `packages/host/apiproxy/src/api/llm.schema.ts` | `modify/delete` | `reimplement-on-alpha5-seam` |
| `packages/host/apiproxy/src/api/llm.ts` | `modify/delete` | `reimplement-on-alpha5-seam` |
| `packages/host/apiproxy/src/api/rpc-map.ts` | `modify/delete` | `reimplement-on-alpha5-seam` |
| `packages/host/apiproxy/src/api/rpc.schema.ts` | `modify/delete` | `reimplement-on-alpha5-seam` |
| `packages/host/apiproxy/src/api/rpc.ts` | `modify/delete` | `reimplement-on-alpha5-seam` |
| `packages/host/apiproxy/src/api/sessions.schema.ts` | `modify/delete` | `reimplement-on-alpha5-seam` |
| `packages/host/apiproxy/src/api/sessions.ts` | `modify/delete` | `reimplement-on-alpha5-seam` |
| `packages/host/apiproxy/src/api/settings.schema.ts` | `modify/delete` | `reimplement-on-alpha5-seam` |
| `packages/host/apiproxy/src/api/settings.ts` | `modify/delete` | `reimplement-on-alpha5-seam` |
| `packages/host/apiproxy/src/api/workspace.schema.ts` | `modify/delete` | `reimplement-on-alpha5-seam` |
| `packages/host/apiproxy/src/api/workspace.ts` | `modify/delete` | `reimplement-on-alpha5-seam` |
| `packages/host/apiproxy/src/fetch/client.ts` | `modify/delete` | `reimplement-on-alpha5-seam` |
| `packages/host/apiproxy/src/fetch/handler.ts` | `modify/delete` | `reimplement-on-alpha5-seam` |
| `packages/host/apiproxy/tests/api-proxy-config.spec.ts` | `modify/delete` | `reimplement-on-alpha5-seam` |
| `packages/host/apiproxy/tests/api-proxy-projections.spec.ts` | `modify/delete` | `reimplement-on-alpha5-seam` |
| `packages/host/apiproxy/tests/api-proxy-view.spec.ts` | `modify/delete` | `reimplement-on-alpha5-seam` |
| `packages/host/apiproxy/tests/api-proxy-workspace.spec.ts` | `modify/delete` | `reimplement-on-alpha5-seam` |
| `packages/host/apiproxy/tests/client-handler.spec.ts` | `modify/delete` | `reimplement-on-alpha5-seam` |
| `packages/host/apiproxy/tests/fetch-carrier.spec.ts` | `modify/delete` | `reimplement-on-alpha5-seam` |
| `packages/host/apiproxy/tests/rpc-schemas.spec.ts` | `modify/delete` | `reimplement-on-alpha5-seam` |
| `packages/host/directory-picker-native/src/win32-dialog-bindings.ts` | `content` | `retain-desktop-extension` |
| `packages/llm/llm-deepseek/src/index.ts` | `content` | `reimplement-on-alpha5-seam` |
| `packages/llm/llm-pi-ai/README.i18n.yaml` | `content` | `generated-after-import` |
| `packages/llm/llm-pi-ai/README.md` | `content` | `reimplement-on-alpha5-seam` |
| `packages/llm/llm-pi-ai/README.zh.md` | `content` | `reimplement-on-alpha5-seam` |
| `packages/llm/llm-pi-ai/src/discovery.ts` | `content` | `reimplement-on-alpha5-seam` |
| `packages/llm/llm/README.i18n.yaml` | `content` | `generated-after-import` |
| `packages/llm/llm/README.md` | `content` | `reimplement-on-alpha5-seam` |
| `packages/llm/llm/README.zh.md` | `content` | `reimplement-on-alpha5-seam` |
| `packages/llm/llm/src/content.ts` | `content` | `reimplement-on-alpha5-seam` |
| `packages/llm/llm/src/types.ts` | `content` | `reimplement-on-alpha5-seam` |
| `packages/llm/llm/tests/content.spec.ts` | `content` | `reimplement-on-alpha5-seam` |
| `packages/llm/llm/tests/service.spec.ts` | `content` | `reimplement-on-alpha5-seam` |
| `packages/llm/token-meter/README.i18n.yaml` | `content` | `generated-after-import` |
| `packages/llm/token-meter/README.md` | `content` | `reimplement-on-alpha5-seam` |
| `packages/llm/token-meter/README.zh.md` | `content` | `reimplement-on-alpha5-seam` |
| `packages/llm/token-meter/src/index.ts` | `content` | `reimplement-on-alpha5-seam` |
| `packages/llm/token-meter/tests/token-usage-projection.spec.ts` | `content` | `reimplement-on-alpha5-seam` |
| `packages/session/session-persistence-jsonl/README.i18n.yaml` | `content` | `generated-after-import` |
| `packages/session/session-persistence-jsonl/README.md` | `content` | `reimplement-on-alpha5-seam` |
| `packages/session/session-persistence-jsonl/README.zh.md` | `content` | `reimplement-on-alpha5-seam` |
| `packages/session/session-persistence-sqlite/src/index.ts` | `modify/delete` | `reimplement-on-alpha5-seam` |
| `packages/session/session-persistence-sqlite/src/sql.ts` | `modify/delete` | `reimplement-on-alpha5-seam` |
| `packages/session/session-persistence-sqlite/src/store.ts` | `modify/delete` | `reimplement-on-alpha5-seam` |
| `packages/session/session-persistence-sqlite/tests/sqlite.spec.ts` | `modify/delete` | `reimplement-on-alpha5-seam` |
| `packages/session/session-persistence/README.i18n.yaml` | `content` | `generated-after-import` |
| `packages/session/session-persistence/README.md` | `content` | `reimplement-on-alpha5-seam` |
| `packages/session/session-persistence/README.zh.md` | `content` | `reimplement-on-alpha5-seam` |
| `packages/session/session-persistence/tests/persistence.spec.ts` | `content` | `reimplement-on-alpha5-seam` |
| `packages/shell/tool-pwsh-persistent/tests/loader-composition.spec.ts` | `content` | `take-upstream` |
| `packages/terminal/terminal-bash/src/index.ts` | `content` | `take-upstream` |
| `packages/terminal/terminal-bash/src/session.ts` | `content` | `take-upstream` |
| `packages/terminal/terminal-bash/tests/session.spec.ts` | `content` | `take-upstream` |
| `packages/test-support/client-runtime/src/fixtures.ts` | `content` | `take-upstream` |
| `packages/test-support/client-runtime/src/sessions.ts` | `content` | `take-upstream` |
| `packages/test-support/client-runtime/src/workspaces.ts` | `content` | `take-upstream` |
| `packages/test-support/client-runtime/tests/runtime.client.spec.tsx` | `content` | `take-upstream` |
| `packages/test-support/session-snapshot/tests/harness.spec.ts` | `content` | `reimplement-on-alpha5-seam` |
| `packages/util/crypto/README.i18n.yaml` | `content` | `generated-after-import` |
| `packages/workspace/workspace/README.i18n.yaml` | `content` | `generated-after-import` |
| `packages/workspace/workspace/README.md` | `content` | `reimplement-on-alpha5-seam` |
| `packages/workspace/workspace/README.zh.md` | `content` | `reimplement-on-alpha5-seam` |
| `pnpm-lock.yaml` | `content` | `generated-after-import` |
| `pnpm-workspace.yaml` | `content` | `reimplement-on-alpha5-seam` |
| `scripts/check-workspace-constraints.ts` | `content` | `reimplement-on-alpha5-seam` |
| `scripts/ci-workflow.spec.ts` | `content` | `reimplement-on-alpha5-seam` |
| `scripts/client-bundle-purity.spec.ts` | `content` | `reimplement-on-alpha5-seam` |
| `scripts/gen-cordis-catalog.ts` | `content` | `take-upstream` |
| `scripts/gen-doc-graphs.ts` | `content` | `take-upstream` |
| `scripts/release/families.ts` | `content` | `reimplement-on-alpha5-seam` |
| `scripts/run-gates.spec.ts` | `content` | `reimplement-on-alpha5-seam` |
| `scripts/run-gates.ts` | `content` | `reimplement-on-alpha5-seam` |
| `scripts/snapshots/translation-prompt-v4/request-response.expected.json` | `content` | `generated-after-import` |
| `scripts/verify-package-readme-model-experience.ts` | `content` | `reimplement-on-alpha5-seam` |
| `snapshots/session/persistent-pwsh-tool-turn/session.jsonl` | `content` | `generated-after-import` |
| `snapshots/web/bash-abort-row/ui.expected.md` | `content` | `generated-after-import` |
| `snapshots/web/cordis-tool-round/ui.expected.md` | `content` | `generated-after-import` |
| `snapshots/web/feedback-command/ack-expanded.expected.md` | `content` | `generated-after-import` |
| `snapshots/web/fresh-round-trip/ui-expanded.expected.md` | `content` | `generated-after-import` |
| `snapshots/web/goal-multi-turn-actions/ui-expanded.expected.md` | `content` | `generated-after-import` |
| `snapshots/web/lifecycle-chrome/hero.expected.md` | `content` | `generated-after-import` |
| `snapshots/web/lifecycle-chrome/plan-active.expected.md` | `content` | `generated-after-import` |
| `snapshots/web/lifecycle-chrome/reloaded-expanded.expected.md` | `content` | `generated-after-import` |
| `snapshots/web/live-interactions/cancel.expected.md` | `content` | `generated-after-import` |
| `snapshots/web/live-interactions/error-auth.expected.md` | `content` | `generated-after-import` |
| `snapshots/web/live-interactions/loading.expected.md` | `content` | `generated-after-import` |
| `snapshots/web/live-interactions/retry-exhausted.expected.md` | `content` | `generated-after-import` |
| `snapshots/web/live-interactions/retry-expanded.expected.md` | `content` | `generated-after-import` |
| `snapshots/web/message-actions/ui.expected.md` | `content` | `generated-after-import` |
| `snapshots/web/plan-review/approved-expanded.expected.md` | `content` | `generated-after-import` |
| `snapshots/web/ptc-round/ui.expected.md` | `content` | `generated-after-import` |
| `snapshots/web/question-composer/answered-expanded.expected.md` | `content` | `generated-after-import` |
| `snapshots/web/queue-actions/preserved.expected.md` | `content` | `generated-after-import` |
| `snapshots/web/seeded-history/command-row.expected.md` | `content` | `generated-after-import` |
| `snapshots/web/seeded-history/feedback-row.expected.md` | `content` | `generated-after-import` |
| `snapshots/web/seeded-history/ui-expanded.expected.md` | `content` | `generated-after-import` |
| `snapshots/web/steering/settled-expanded.expected.md` | `content` | `generated-after-import` |
| `snapshots/web/subagent-conversation/ui-expanded.expected.md` | `content` | `generated-after-import` |
| `snapshots/web/turn-tail-actions/focused.expected.md` | `content` | `generated-after-import` |
| `snapshots/web/turn-tail-actions/running.expected.md` | `content` | `generated-after-import` |
| `snapshots/web/web-search-round/ui.expected.md` | `content` | `generated-after-import` |
| `tsconfig.base.json` | `content` | `reimplement-on-alpha5-seam` |
| `tsconfig.host.json` | `content` | `reimplement-on-alpha5-seam` |
| `vendor/README.md` | `content` | `take-upstream` |
| `packages/host/apiproxy/src/**` | `directory rename split` | `reimplement-on-alpha5-seam` |

## 必需的所有权矩阵

| 领域 | 所有权和导入规则 |
|---|---|
| `apps/web/src/**` | `take-upstream`；alpha.5 应用程序结构具有权威性。 |
| `apps/web/tests/**/*.ts` | 每个重叠的测试源都是 `reimplement-on-alpha5-seam`：从 alpha.5  harness 和测试拓扑开始，然后恢复下面列出的 Desktop 附件、官方 TurnNavigator、Workbench、审批和已安装生命周期契约。快照输出保持 `generated-after-import`。 |
| `apps/cli/**` | `take-upstream`，除了 `src/profile-boot.ts`，其打包的 Desktop 启动契约为 `reimplement-on-alpha5-seam`。 |
| `packages/client/**` | 首先导入 alpha.5 包拆分和官方 Turn outline/TurnNavigator；然后在那些接缝上重新实现渲染器附件隐私、Desktop 槽位、侧边栏、设置和 Workbench 集成。 |
| `packages/host/apiproxy/**` 和 `packages/api/session-controller/**` | 导入 alpha.5 API/session-controller 布局，然后在那里重新实现 Desktop 投影和私有传输边界；不要将已移除的 apiproxy 布局保留为第二个权威。 |
| `packages/session/**` | 导入 alpha.5 持久化/投影所有权，然后使用源 JSONL、Session ID、标题、工作区和标记保存重新实现 rc.2/alpha.3 升级恢复。 |
| `packages/boot/app-boot/**` | 导入 alpha.5 启动 API，然后重新实现严格的旧模块回退恢复和打包配置档案组合。 |
| `packages/llm/**` 和 `packages/attachment/**` | 导入 alpha.5 核心行为，然后重新实现有界文档准入、投影、核算和渲染器隐私，而不削弱限制。 |
| `packages/extensions/**` | 导入官方扩展接缝；单独保留 Desktop 专属扩展包并防止重复的核心组合。 |
| `apps/desktop/**` | `retain-desktop-extension`；它没有争议，仍然是唯一的 Desktop 应用程序、更新程序、暂存、打包、Native Messaging 和 macOS 生命周期所有者。 |
| `packages/extensions/desktop-workbench/**` | `retain-desktop-extension`；在导入后重新绑定其依赖项，但保持一个固定的 Workbench 表面。 |
| `apps/desktop-managed-memory/**`、`apps/desktop-managed-evolution/**`、`packages/brain/missher-brain/**` 和 `packages/client/ui-settings-brain/**` | `retain-desktop-extension`；仅迁移导入/组合并按字节保留用户标记。 |
| 浏览器/计算机控制扩展包 | `retain-desktop-extension`；在此 core-sync 阶段只允许兼容性导入。BrowserSkill 不在范围内。 |
| 提示导航 | 移除或保持未挂载 rc.2 `PromptRail`；alpha.5 Turn outline/TurnNavigator 是唯一的运行时导航权威。 |
| `scripts/stage-desktop.ts`、update-manifest 工具、Electron 构建文件和 Desktop 资源 | `retain-desktop-extension`；后续暂存测试证明它们包含 alpha.5 运行时和所有 Desktop 私有扩展。 |
| 共享的 `.github/workflows/ci.yml` 和 `.github/workflows/e2e.yml` | `reimplement-on-alpha5-seam`；从 alpha.5 包图和测试拓扑开始，然后恢复每个 Desktop 静态、构建、快照、暂存、打包和生命周期门控。仅限 Windows 的工作流程和 PowerShell 所有权仍属于 Windows 任务。 |
| 锁文件、声明、配对外围文件、生成的子系统页面和快照 | `generated-after-import`；仓库生成器拥有最终字节。 |

## Web 测试契约协调

每个重叠的 Web 测试源都是接缝而不是精确的上游副本。官方 alpha.5 文件名、harness 和测试结构是起点；然后使用聚焦断言恢复下面的 Desktop delta。已移除的上游测试文件不会作为并行套件复活：其仍然必需的契约移动到相应的 alpha.5 测试中。

| 测试源 | 必须在 alpha.5 结构上保留的 Desktop 契约 |
|---|---|
| `apps/web/tests/agent-preset-selection.e2e.ts` | 管理的 Desktop 预设组和官方 alpha.5 选择/目录行为。 |
| `apps/web/tests/approval-composer.e2e.ts` | 允许一次加上当前 Session 全访问命令排序、禁用的待处理操作和官方审批渲染。 |
| `apps/web/tests/built-boot.snapshot.ts` / `built-boot.expected.e2e.ts` | 构建的应用程序启动、打包模块解析和 alpha.5 重命名的预期测试结构。 |
| `apps/web/tests/chat-scroll-contract.e2e.ts` | Desktop 对话布局内的官方 TurnNavigator 滚动/聚焦行为。 |
| `apps/web/tests/command-image-envelope.snapshot.ts` / `command-image-envelope.expected.e2e.ts` | 图像和文档附件信封、有界渲染器投影和 alpha.5 重命名的预期测试结构。 |
| `apps/web/tests/hmr-live.e2e.ts` | 官方 HMR 生命周期，同时保留 Desktop 表面标记和桥接隔离。 |
| `apps/web/tests/image-display.snapshot.ts` | 必需的图像/文档显示和隐私断言必须移动到 alpha.5 替换中，而不是保留已删除的旧套件。 |
| `apps/web/tests/lifecycle-chrome.e2e.ts` | 已安装/构建的生命周期加上附件、TurnNavigator、固定 Workbench、权限、Memory & Learning 和 Desktop 表面断言。 |
| `apps/web/tests/models-settings.e2e.ts` | 带有 Desktop 提供者和推理努力设置的官方模型目录。 |
| `apps/web/tests/onboarding-deepseek-config.e2e.ts` | 带有 Desktop DeepSeek 提供者引导契约的官方入职流程。 |
| `apps/web/tests/plan-review.e2e.ts` | 带有 Desktop 审批状态和当前 Session 权限隔离的官方计划审查。 |
| `apps/web/tests/queue-actions.e2e.ts` | 队列语义加上稳定的 Desktop composer/sidebar/Workbench 几何结构和键盘行为。 |
| `apps/web/tests/reference-composer.e2e.ts` | 官方参考选择器加上 Desktop 文件、文件夹、Sessions、Goal/Plan 声明和动态安装的 skills/plugins。 |
| `apps/web/tests/scaffold.ts` | Alpha.5 fixture API 加上 Desktop 表面、已安装生命周期、模型、工作区、附件和权限种子。 |
| `apps/web/tests/steering.e2e.ts` | 官方 steering 事件顺序加上 Desktop question/approval composer 收敛。 |
| `apps/web/tests/support.ts` | Alpha.5 runner 实用程序加上有界的 Desktop 启动、fixture、视口和快照稳定化助手。 |
| `apps/web/tests/workspace-management.e2e.ts` | 现有的 Project/Session 树、当前空白 session 处理、长标签布局和工作区持久化。 |

## 更广泛的最终字节重叠清单

| 路径 | 处置方式 |
|---|---|
| `.agents/notes/implemented/architecture/2026-08-05-profile-plugin-bundles.i18n.yaml` | `generated-after-import` |
| `.agents/notes/implemented/architecture/2026-08-05-profile-plugin-bundles.md` | `take-upstream` |
| `.agents/notes/implemented/architecture/2026-08-05-profile-plugin-bundles.zh.md` | `take-upstream` |
| `.agents/notes/implemented/architecture/2026-08-12-pi-ai-route-default-input-modalities.i18n.yaml` | `generated-after-import` |
| `.agents/notes/implemented/architecture/2026-08-12-pi-ai-route-default-input-modalities.md` | `take-upstream` |
| `.agents/notes/implemented/architecture/2026-08-12-pi-ai-route-default-input-modalities.zh.md` | `take-upstream` |
| `.agents/notes/implemented/feature/2026-08-11-workspace-sidebar-order-and-folding.i18n.yaml` | `generated-after-import` |
| `.agents/notes/implemented/feature/2026-08-11-workspace-sidebar-order-and-folding.md` | `take-upstream` |
| `.agents/notes/implemented/feature/2026-08-11-workspace-sidebar-order-and-folding.zh.md` | `take-upstream` |
| `.github/workflows/build-exe-for-python-sdk.yml` | `retain-desktop-extension` |
| `.github/workflows/ci.yml` | `reimplement-on-alpha5-seam` |
| `.github/workflows/e2e.yml` | `reimplement-on-alpha5-seam` |
| `.gitignore` | `reimplement-on-alpha5-seam` |
| `README.i18n.yaml` | `generated-after-import` |
| `README.md` | `take-upstream` |
| `README.zh.md` | `take-upstream` |
| `THIRD_PARTY_NOTICES.md` | `generated-after-import` |
| `apps/cli/src/bin.ts` | `take-upstream` |
| `apps/cli/src/plugin.ts` | `take-upstream` |
| `apps/cli/src/profile-boot.ts` | `reimplement-on-alpha5-seam` |
| `apps/cli/tests/web-agent-presets.e2e.ts` | `take-upstream` |
| `apps/web/src/main.ts` | `take-upstream` |
| `apps/web/tests/agent-preset-selection.e2e.ts` | `reimplement-on-alpha5-seam` |
| `apps/web/tests/approval-composer.e2e.ts` | `reimplement-on-alpha5-seam` |
| `apps/web/tests/built-boot.snapshot.ts` | `reimplement-on-alpha5-seam` |
| `apps/web/tests/chat-scroll-contract.e2e.ts` | `reimplement-on-alpha5-seam` |
| `apps/web/tests/command-image-envelope.snapshot.ts` | `reimplement-on-alpha5-seam` |
| `apps/web/tests/hmr-live.e2e.ts` | `reimplement-on-alpha5-seam` |
| `apps/web/tests/image-display.snapshot.ts` | `reimplement-on-alpha5-seam` |
| `apps/web/tests/lifecycle-chrome.e2e.ts` | `reimplement-on-alpha5-seam` |
| `apps/web/tests/models-settings.e2e.ts` | `reimplement-on-alpha5-seam` |
| `apps/web/tests/onboarding-deepseek-config.e2e.ts` | `reimplement-on-alpha5-seam` |
| `apps/web/tests/plan-review.e2e.ts` | `reimplement-on-alpha5-seam` |
| `apps/web/tests/queue-actions.e2e.ts` | `reimplement-on-alpha5-seam` |
| `apps/web/tests/reference-composer.e2e.ts` | `reimplement-on-alpha5-seam` |
| `apps/web/tests/scaffold.ts` | `reimplement-on-alpha5-seam` |
| `apps/web/tests/snapshots/agent-preset-authoring/created.expected.md` | `generated-after-import` |
| `apps/web/tests/snapshots/agent-preset-authoring/damaged.expected.md` | `generated-after-import` |
| `apps/web/tests/snapshots/agent-preset-authoring/section.expected.md` | `generated-after-import` |
| `apps/web/tests/snapshots/agent-preset-selection/menu.expected.md` | `generated-after-import` |
| `apps/web/tests/snapshots/approval-composer/ui.expected.md` | `generated-after-import` |
| `apps/web/tests/snapshots/bash-abort-row/ui.expected.md` | `generated-after-import` |
| `apps/web/tests/snapshots/code-mode-round/ui.expected.md` | `generated-after-import` |
| `apps/web/tests/snapshots/cordis-tool-round/ui.expected.md` | `generated-after-import` |
| `apps/web/tests/snapshots/feedback-command/ack.expected.md` | `generated-after-import` |
| `apps/web/tests/snapshots/fresh-round-trip/ui.expected.md` | `generated-after-import` |
| `apps/web/tests/snapshots/goal-command-presentation/ui.expected.md` | `generated-after-import` |
| `apps/web/tests/snapshots/goal-multi-turn-actions/ui.expected.md` | `generated-after-import` |
| `apps/web/tests/snapshots/lifecycle-chrome/command-menu.expected.md` | `generated-after-import` |
| `apps/web/tests/snapshots/lifecycle-chrome/hero.expected.md` | `generated-after-import` |
| `apps/web/tests/snapshots/lifecycle-chrome/plan-active.expected.md` | `generated-after-import` |
| `apps/web/tests/snapshots/lifecycle-chrome/reloaded.expected.md` | `generated-after-import` |
| `apps/web/tests/snapshots/live-interactions/cancel.expected.md` | `generated-after-import` |
| `apps/web/tests/snapshots/live-interactions/error-auth.expected.md` | `generated-after-import` |
| `apps/web/tests/snapshots/live-interactions/loading.expected.md` | `generated-after-import` |
| `apps/web/tests/snapshots/live-interactions/retry-exhausted.expected.md` | `generated-after-import` |
| `apps/web/tests/snapshots/live-interactions/retry.expected.md` | `generated-after-import` |
| `apps/web/tests/snapshots/markdown-cjk-strong/ui.expected.md` | `generated-after-import` |
| `apps/web/tests/snapshots/markdown-images/ui.expected.md` | `generated-after-import` |
| `apps/web/tests/snapshots/markdown-inline-code-links/ui.expected.md` | `generated-after-import` |
| `apps/web/tests/snapshots/math-rendering/ui.expected.md` | `generated-after-import` |
| `apps/web/tests/snapshots/message-actions/ui.expected.md` | `generated-after-import` |
| `apps/web/tests/snapshots/models-settings/configured.expected.md` | `generated-after-import` |
| `apps/web/tests/snapshots/models-settings/declared-edit.expected.md` | `generated-after-import` |
| `apps/web/tests/snapshots/models-settings/declared.expected.md` | `generated-after-import` |
| `apps/web/tests/snapshots/models-settings/empty.expected.md` | `generated-after-import` |
| `apps/web/tests/snapshots/onboarding-deepseek-config/models.expected.md` | `generated-after-import` |
| `apps/web/tests/snapshots/onboarding-usable-provider/dismissed.expected.md` | `generated-after-import` |
| `apps/web/tests/snapshots/plan-review/approved.expected.md` | `generated-after-import` |
| `apps/web/tests/snapshots/plugin-config/section.expected.md` | `generated-after-import` |
| `apps/web/tests/snapshots/question-composer/answered.expected.md` | `generated-after-import` |
| `apps/web/tests/snapshots/queue-actions/collapsed.expected.md` | `generated-after-import` |
| `apps/web/tests/snapshots/queue-actions/editing.expected.md` | `generated-after-import` |
| `apps/web/tests/snapshots/queue-actions/layout.expected.md` | `generated-after-import` |
| `apps/web/tests/snapshots/queue-actions/preserved.expected.md` | `generated-after-import` |
| `apps/web/tests/snapshots/queue-actions/ui.expected.md` | `generated-after-import` |
| `apps/web/tests/snapshots/reference-composer/order.expected.md` | `generated-after-import` |
| `apps/web/tests/snapshots/seeded-history/command-row.expected.md` | `generated-after-import` |
| `apps/web/tests/snapshots/seeded-history/feedback-row.expected.md` | `generated-after-import` |
| `apps/web/tests/snapshots/seeded-history/ui.expected.md` | `generated-after-import` |
| `apps/web/tests/snapshots/settings-chrome/dialog-en.expected.md` | `generated-after-import` |
| `apps/web/tests/snapshots/settings-chrome/dialog.expected.md` | `generated-after-import` |
| `apps/web/tests/snapshots/skill-tool-row/ui.expected.md` | `generated-after-import` |
| `apps/web/tests/snapshots/skill-user-invoke/ui.expected.md` | `generated-after-import` |
| `apps/web/tests/snapshots/stats-paged-history/ui.expected.md` | `generated-after-import` |
| `apps/web/tests/snapshots/steer-all/mid-steer.expected.md` | `generated-after-import` |
| `apps/web/tests/snapshots/steer-all/settled.expected.md` | `generated-after-import` |
| `apps/web/tests/snapshots/steering/settled.expected.md` | `generated-after-import` |
| `apps/web/tests/snapshots/subagent-conversation/ui.expected.md` | `generated-after-import` |
| `apps/web/tests/snapshots/subagent-interrupt/offline-composer.expected.md` | `generated-after-import` |
| `apps/web/tests/snapshots/turn-tail-actions/running.expected.md` | `generated-after-import` |
| `apps/web/tests/snapshots/turn-tail-actions/settled.expected.md` | `generated-after-import` |
| `apps/web/tests/snapshots/web-search-round/ui.expected.md` | `generated-after-import` |
| `apps/web/tests/steering.e2e.ts` | `reimplement-on-alpha5-seam` |
| `apps/web/tests/support.ts` | `reimplement-on-alpha5-seam` |
| `apps/web/tests/workspace-management.e2e.ts` | `reimplement-on-alpha5-seam` |
| `apps/web/vite.config.ts` | `take-upstream` |
| `docs/capability-seams.i18n.yaml` | `generated-after-import` |
| `docs/capability-seams.md` | `take-upstream` |
| `docs/capability-seams.zh.md` | `take-upstream` |
| `docs/config-catalog.i18n.yaml` | `generated-after-import` |
| `docs/config-catalog.md` | `generated-after-import` |
| `docs/config-catalog.zh.md` | `generated-after-import` |
| `docs/event-producer-consumer.i18n.yaml` | `generated-after-import` |
| `docs/event-producer-consumer.md` | `generated-after-import` |
| `docs/event-producer-consumer.zh.md` | `generated-after-import` |
| `docs/module-graph.i18n.yaml` | `generated-after-import` |
| `docs/module-graph.md` | `generated-after-import` |
| `docs/module-graph.zh.md` | `generated-after-import` |
| `docs/persistence-catalog.i18n.yaml` | `generated-after-import` |
| `docs/persistence-catalog.md` | `generated-after-import` |
| `docs/persistence-catalog.zh.md` | `generated-after-import` |
| `docs/subsystems/attachment.i18n.yaml` | `generated-after-import` |
| `docs/subsystems/attachment.md` | `generated-after-import` |
| `docs/subsystems/attachment.zh.md` | `generated-after-import` |
| `docs/subsystems/extensions.i18n.yaml` | `generated-after-import` |
| `docs/subsystems/extensions.md` | `generated-after-import` |
| `docs/subsystems/extensions.zh.md` | `generated-after-import` |
| `docs/subsystems/llm-streaming.i18n.yaml` | `generated-after-import` |
| `docs/subsystems/llm-streaming.md` | `generated-after-import` |
| `docs/subsystems/llm-streaming.zh.md` | `generated-after-import` |
| `docs/subsystems/persistence.i18n.yaml` | `generated-after-import` |
| `docs/subsystems/persistence.md` | `generated-after-import` |
| `docs/subsystems/persistence.zh.md` | `generated-after-import` |
| `docs/subsystems/session.i18n.yaml` | `generated-after-import` |
| `docs/subsystems/session.md` | `generated-after-import` |
| `docs/subsystems/session.zh.md` | `generated-after-import` |
| `docs/subsystems/web-server.i18n.yaml` | `generated-after-import` |
| `docs/subsystems/web-server.md` | `generated-after-import` |
| `docs/subsystems/web-server.zh.md` | `generated-after-import` |
| `docs/subsystems/workspace.i18n.yaml` | `generated-after-import` |
| `docs/subsystems/workspace.md` | `generated-after-import` |
| `docs/subsystems/workspace.zh.md` | `generated-after-import` |
| `examples/acp-agent/tests/snapshots/persistent-pwsh-tool-turn/session.jsonl` | `generated-after-import` |
| `examples/acp-agent/tests/snapshots/pwsh-tool-turn/tool-schemas.expected.json` | `generated-after-import` |
| `examples/headless-agent/tests/fixtures/deepseek-defaults.cordis.yml` | `take-upstream` |
| `examples/headless-agent/tests/headless.snapshot.ts` | `take-upstream` |
| `knip.json` | `reimplement-on-alpha5-seam` |
| `package.json` | `reimplement-on-alpha5-seam` |
| `packages/api/remotes/package.json` | `reimplement-on-alpha5-seam` |
| `packages/api/remotes/src/agent-lookup.ts` | `reimplement-on-alpha5-seam` |
| `packages/api/remotes/src/client/index.ts` | `reimplement-on-alpha5-seam` |
| `packages/api/remotes/tests/agent-lookup.spec.ts` | `reimplement-on-alpha5-seam` |
| `packages/api/remotes/tsconfig.client.json` | `reimplement-on-alpha5-seam` |
| `packages/attachment/attachment-local/README.i18n.yaml` | `generated-after-import` |
| `packages/attachment/attachment-local/README.md` | `reimplement-on-alpha5-seam` |
| `packages/attachment/attachment-local/README.zh.md` | `reimplement-on-alpha5-seam` |
| `packages/attachment/attachment-local/package.json` | `reimplement-on-alpha5-seam` |
| `packages/attachment/attachment-local/src/index.ts` | `reimplement-on-alpha5-seam` |
| `packages/attachment/attachment-local/src/invariant.ts` | `reimplement-on-alpha5-seam` |
| `packages/attachment/attachment-local/src/store.ts` | `reimplement-on-alpha5-seam` |
| `packages/attachment/attachment-local/tests/index.spec.ts` | `reimplement-on-alpha5-seam` |
| `packages/attachment/attachment-local/tests/store.spec.ts` | `reimplement-on-alpha5-seam` |
| `packages/attachment/attachment/src/admission.ts` | `reimplement-on-alpha5-seam` |
| `packages/attachment/attachment/src/index.ts` | `reimplement-on-alpha5-seam` |
| `packages/attachment/attachment/src/types.ts` | `reimplement-on-alpha5-seam` |
| `packages/attachment/attachment/tests/admission.spec.ts` | `reimplement-on-alpha5-seam` |
| `packages/attachment/attachment/tests/index.spec.ts` | `reimplement-on-alpha5-seam` |
| `packages/boot/app-boot/README.i18n.yaml` | `generated-after-import` |
| `packages/boot/app-boot/README.md` | `reimplement-on-alpha5-seam` |
| `packages/boot/app-boot/README.zh.md` | `reimplement-on-alpha5-seam` |
| `packages/boot/app-boot/src/index.ts` | `reimplement-on-alpha5-seam` |
| `packages/boot/app-boot/src/profile.ts` | `reimplement-on-alpha5-seam` |
| `packages/boot/app-boot/tests/app-boot.spec.ts` | `reimplement-on-alpha5-seam` |
| `packages/boot/app-boot/tests/profile.spec.ts` | `reimplement-on-alpha5-seam` |
| `packages/boot/app-boot/tests/user-patches.spec.ts` | `reimplement-on-alpha5-seam` |
| `packages/bundle/web-app/cordis.patch.yml` | `reimplement-on-alpha5-seam` |
| `packages/bundle/web-app/package.json` | `reimplement-on-alpha5-seam` |
| `packages/client/connection/README.i18n.yaml` | `generated-after-import` |
| `packages/client/connection/README.md` | `reimplement-on-alpha5-seam` |
| `packages/client/connection/README.zh.md` | `reimplement-on-alpha5-seam` |
| `packages/client/connection/package.json` | `reimplement-on-alpha5-seam` |
| `packages/client/connection/src/client/api.ts` | `reimplement-on-alpha5-seam` |
| `packages/client/connection/src/client/fixture.ts` | `reimplement-on-alpha5-seam` |
| `packages/client/connection/src/client/index.ts` | `reimplement-on-alpha5-seam` |
| `packages/client/connection/src/http-bridge.ts` | `reimplement-on-alpha5-seam` |
| `packages/client/connection/src/index.ts` | `reimplement-on-alpha5-seam` |
| `packages/client/connection/tests/fake-api.client.ts` | `reimplement-on-alpha5-seam` |
| `packages/client/connection/tests/fixture.client.spec.ts` | `reimplement-on-alpha5-seam` |
| `packages/client/connection/tests/node-half.host.spec.ts` | `reimplement-on-alpha5-seam` |
| `packages/client/runtime/README.i18n.yaml` | `generated-after-import` |
| `packages/client/runtime/README.md` | `reimplement-on-alpha5-seam` |
| `packages/client/runtime/README.zh.md` | `reimplement-on-alpha5-seam` |
| `packages/client/runtime/src/client/contract/session.ts` | `reimplement-on-alpha5-seam` |
| `packages/client/runtime/src/client/contract/sessions-port.ts` | `reimplement-on-alpha5-seam` |
| `packages/client/runtime/src/client/contract/sessions.ts` | `reimplement-on-alpha5-seam` |
| `packages/client/runtime/src/client/contract/workspaces.ts` | `reimplement-on-alpha5-seam` |
| `packages/client/runtime/src/client/index.ts` | `reimplement-on-alpha5-seam` |
| `packages/client/runtime/src/client/sessions/assistant-timing.ts` | `reimplement-on-alpha5-seam` |
| `packages/client/runtime/src/client/sessions/conversation.ts` | `reimplement-on-alpha5-seam` |
| `packages/client/runtime/src/client/sessions/manager.ts` | `reimplement-on-alpha5-seam` |
| `packages/client/runtime/src/client/sessions/queue-mirror.ts` | `reimplement-on-alpha5-seam` |
| `packages/client/runtime/src/client/sessions/service.ts` | `reimplement-on-alpha5-seam` |
| `packages/client/runtime/src/client/sessions/session.ts` | `reimplement-on-alpha5-seam` |
| `packages/client/runtime/src/client/sessions/tool-call-tree.ts` | `reimplement-on-alpha5-seam` |
| `packages/client/runtime/src/client/workspaces/manager.ts` | `reimplement-on-alpha5-seam` |
| `packages/client/runtime/src/client/workspaces/service.ts` | `reimplement-on-alpha5-seam` |
| `packages/client/runtime/tests/fake-api.client.ts` | `reimplement-on-alpha5-seam` |
| `packages/client/runtime/tests/manager.client.spec.ts` | `reimplement-on-alpha5-seam` |
| `packages/client/runtime/tests/queue-store.client.spec.ts` | `reimplement-on-alpha5-seam` |
| `packages/client/runtime/tests/session.client.spec.ts` | `reimplement-on-alpha5-seam` |
| `packages/client/runtime/tests/sessions-service.client.spec.ts` | `reimplement-on-alpha5-seam` |
| `packages/client/runtime/tests/workspaces-service.client.spec.ts` | `reimplement-on-alpha5-seam` |
| `packages/client/tsdown.client.ts` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-agent-preset/README.i18n.yaml` | `generated-after-import` |
| `packages/client/ui-agent-preset/README.md` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-agent-preset/README.zh.md` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-agent-preset/src/client/AgentPresetSection.module.css` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-agent-preset/src/client/locales.ts` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-agent-preset/tests/locales.client.spec.ts` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-attachment/src/MessageImage.tsx` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-attachment/src/client/MessageImages.tsx` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-attachment/tests/attachment-rail.client.spec.tsx` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-attachment/tests/message-image.client.spec.tsx` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-conversation/README.i18n.yaml` | `generated-after-import` |
| `packages/client/ui-conversation/README.md` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-conversation/README.zh.md` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-conversation/package.json` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-conversation/src/client/apply.ts` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-conversation/src/client/chat/ChatNodeSeat.tsx` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-conversation/src/client/chat/ChatView.module.css` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-conversation/src/client/chat/ChatView.tsx` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-conversation/src/client/chat/MessageItem.tsx` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-conversation/src/client/chat/ReasoningRow.module.css` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-conversation/src/client/chat/ReasoningRow.tsx` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-conversation/src/client/chat/StatsLine.module.css` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-conversation/src/client/chat/StatsLine.tsx` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-conversation/src/client/contract/slots.ts` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-conversation/src/client/conversation-nodes/message.ts` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-conversation/src/client/conversation-nodes/tool.ts` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-conversation/src/client/image-labels.ts` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-conversation/src/client/index.ts` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-conversation/src/client/locales.ts` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-conversation/src/client/service.ts` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-conversation/src/client/skeleton/ApprovalPanel.module.css` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-conversation/src/client/skeleton/ApprovalPanel.tsx` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-conversation/src/client/skeleton/ConversationRoot.tsx` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-conversation/src/client/skeleton/EmptyHero.tsx` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-conversation/src/client/skeleton/InputBar.module.css` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-conversation/src/client/skeleton/InputBar.tsx` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-conversation/tests/apply-inject.client.spec.tsx` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-conversation/tests/chat-apply.client.spec.tsx` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-conversation/tests/chat-branch-tails.client.spec.tsx` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-conversation/tests/chat-stats.client.spec.tsx` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-conversation/tests/chat-view.client.spec.tsx` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-conversation/tests/input-bar.client.spec.tsx` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-conversation/tests/input-matrix.client.spec.tsx` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-conversation/tests/input-scenarios.client.spec.tsx` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-conversation/tests/reasoning-row.client.spec.tsx` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-conversation/tests/service-orchestration.client.spec.ts` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-conversation/tests/skeleton.client.spec.tsx` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-input-trigger/README.i18n.yaml` | `generated-after-import` |
| `packages/client/ui-input-trigger/README.md` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-input-trigger/README.zh.md` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-input-trigger/src/client/MenuView.module.css` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-input-trigger/src/client/MenuView.tsx` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-input-trigger/src/client/controller.ts` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-input-trigger/src/client/index.ts` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-input-trigger/src/client/slots.ts` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-input-trigger/src/types.ts` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-input-trigger/tests/menu-view.client.spec.tsx` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-input-trigger/tests/service.client.spec.ts` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-layout/src/client/AppFrame.module.css` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-layout/src/client/AppFrame.tsx` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-layout/src/client/index.ts` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-layout/src/client/stores.ts` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-layout/tests/app-frame.client.spec.tsx` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-layout/tests/apply.client.spec.ts` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-layout/tests/service.client.spec.ts` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-model-selection/tests/model-select.client.spec.tsx` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-primitives/src/icons/index.tsx` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-primitives/tests/code-block.client.spec.tsx` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-primitives/tests/icons.client.spec.tsx` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-renderer/src/client/DocumentTitle.tsx` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-renderer/tests/document-title.client.spec.tsx` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-settings-general/src/client/SettingsRoot.module.css` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-settings-general/src/client/SettingsRoot.tsx` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-settings-general/tests/settings-root.client.spec.tsx` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-settings-models/README.i18n.yaml` | `generated-after-import` |
| `packages/client/ui-settings-models/README.md` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-settings-models/README.zh.md` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-settings-models/src/client/CustomProviderCard.tsx` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-settings-models/src/client/ModelListEditor.tsx` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-settings-models/src/client/ProviderEditor.tsx` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-settings-models/src/client/locales.ts` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-settings-models/tests/provider-form.client.spec.tsx` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-settings-plugins/src/client/PluginsSettingsSection.module.css` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-sidebar/README.i18n.yaml` | `generated-after-import` |
| `packages/client/ui-sidebar/README.md` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-sidebar/README.zh.md` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-sidebar/src/client/SidebarRoot.module.css` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-sidebar/src/client/SidebarRoot.tsx` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-sidebar/tests/__snapshots__/sidebar-snapshot.client.spec.tsx.snap` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-sidebar/tests/sidebar-root.client.spec.tsx` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-subagent/tests/conversation-ui.client.spec.tsx` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-trajectory/package.json` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-trajectory/src/client/trajectory-message-definitions.ts` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-trajectory/src/client/trajectory-tool-definition.ts` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-workspace/src/client/WorkspaceBrowser.module.css` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-workspace/src/client/WorkspaceBrowser.tsx` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-workspace/src/client/WorkspacePicker.tsx` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-workspace/src/client/contract/slots.ts` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-workspace/src/client/index.ts` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-workspace/src/client/locales.ts` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-workspace/src/client/rows/Rows.module.css` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-workspace/src/client/rows/Rows.tsx` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-workspace/tests/browser-styles.client.spec.ts` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-workspace/tests/rows.client.spec.tsx` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-workspace/tests/workspace-browser.client.spec.tsx` | `reimplement-on-alpha5-seam` |
| `packages/client/ui-workspace/tests/workspace-picker.client.spec.tsx` | `reimplement-on-alpha5-seam` |
| `packages/client/web/src/boot-page.module.css` | `reimplement-on-alpha5-seam` |
| `packages/client/web/src/boot.ts` | `reimplement-on-alpha5-seam` |
| `packages/client/web/tests/boot.client.spec.ts` | `reimplement-on-alpha5-seam` |
| `packages/core/session/src/index.ts` | `reimplement-on-alpha5-seam` |
| `packages/core/session/src/known-event-types.ts` | `reimplement-on-alpha5-seam` |
| `packages/core/session/src/types.ts` | `reimplement-on-alpha5-seam` |
| `packages/extensions/cordis-client-runner/src/client/slot-catalog.ts` | `reimplement-on-alpha5-seam` |
| `packages/extensions/tool-cordis/src/api-catalog.ts` | `reimplement-on-alpha5-seam` |
| `packages/host/apiproxy/README.i18n.yaml` | `generated-after-import` |
| `packages/host/apiproxy/README.md` | `reimplement-on-alpha5-seam` |
| `packages/host/apiproxy/README.zh.md` | `reimplement-on-alpha5-seam` |
| `packages/host/apiproxy/package.json` | `reimplement-on-alpha5-seam` |
| `packages/host/apiproxy/src/api-proxy.ts` | `reimplement-on-alpha5-seam` |
| `packages/host/apiproxy/src/api/events.ts` | `reimplement-on-alpha5-seam` |
| `packages/host/apiproxy/src/api/index.ts` | `reimplement-on-alpha5-seam` |
| `packages/host/apiproxy/src/api/llm.schema.ts` | `reimplement-on-alpha5-seam` |
| `packages/host/apiproxy/src/api/llm.ts` | `reimplement-on-alpha5-seam` |
| `packages/host/apiproxy/src/api/rpc-map.ts` | `reimplement-on-alpha5-seam` |
| `packages/host/apiproxy/src/api/rpc.schema.ts` | `reimplement-on-alpha5-seam` |
| `packages/host/apiproxy/src/api/rpc.ts` | `reimplement-on-alpha5-seam` |
| `packages/host/apiproxy/src/api/sessions.schema.ts` | `reimplement-on-alpha5-seam` |
| `packages/host/apiproxy/src/api/sessions.ts` | `reimplement-on-alpha5-seam` |
| `packages/host/apiproxy/src/api/settings.schema.ts` | `reimplement-on-alpha5-seam` |
| `packages/host/apiproxy/src/api/settings.ts` | `reimplement-on-alpha5-seam` |
| `packages/host/apiproxy/src/api/workspace.schema.ts` | `reimplement-on-alpha5-seam` |
| `packages/host/apiproxy/src/api/workspace.ts` | `reimplement-on-alpha5-seam` |
| `packages/host/apiproxy/src/fetch/client.ts` | `reimplement-on-alpha5-seam` |
| `packages/host/apiproxy/src/fetch/handler.ts` | `reimplement-on-alpha5-seam` |
| `packages/host/apiproxy/tests/api-proxy-cold.spec.ts` | `reimplement-on-alpha5-seam` |
| `packages/host/apiproxy/tests/api-proxy-config.spec.ts` | `reimplement-on-alpha5-seam` |
| `packages/host/apiproxy/tests/api-proxy-models.spec.ts` | `reimplement-on-alpha5-seam` |
| `packages/host/apiproxy/tests/api-proxy-projections.spec.ts` | `reimplement-on-alpha5-seam` |
| `packages/host/apiproxy/tests/api-proxy-search.spec.ts` | `reimplement-on-alpha5-seam` |
| `packages/host/apiproxy/tests/api-proxy-view.spec.ts` | `reimplement-on-alpha5-seam` |
| `packages/host/apiproxy/tests/api-proxy-workspace.spec.ts` | `reimplement-on-alpha5-seam` |
| `packages/host/apiproxy/tests/client-handler.spec.ts` | `reimplement-on-alpha5-seam` |
| `packages/host/apiproxy/tests/fetch-carrier.spec.ts` | `reimplement-on-alpha5-seam` |
| `packages/host/apiproxy/tests/rpc-schemas.spec.ts` | `reimplement-on-alpha5-seam` |
| `packages/host/directory-picker-native/src/win32-dialog-bindings.ts` | `retain-desktop-extension` |
| `packages/host/directory-picker-native/tests/win32-dialog-bindings.spec.ts` | `retain-desktop-extension` |
| `packages/host/webserver/src/index.ts` | `reimplement-on-alpha5-seam` |
| `packages/host/webserver/tests/webserver.spec.ts` | `reimplement-on-alpha5-seam` |
| `packages/interaction/permission-presets/tests/projection.spec.ts` | `reimplement-on-alpha5-seam` |
| `packages/llm/llm-deepseek/src/index.ts` | `reimplement-on-alpha5-seam` |
| `packages/llm/llm-deepseek/tests/dynamic-config.spec.ts` | `reimplement-on-alpha5-seam` |
| `packages/llm/llm-deepseek/tests/loader-composition.spec.ts` | `reimplement-on-alpha5-seam` |
| `packages/llm/llm-pi-ai/README.i18n.yaml` | `generated-after-import` |
| `packages/llm/llm-pi-ai/README.md` | `reimplement-on-alpha5-seam` |
| `packages/llm/llm-pi-ai/README.zh.md` | `reimplement-on-alpha5-seam` |
| `packages/llm/llm-pi-ai/src/discovery.ts` | `reimplement-on-alpha5-seam` |
| `packages/llm/llm-pi-ai/tests/discovery.spec.ts` | `reimplement-on-alpha5-seam` |
| `packages/llm/llm/README.i18n.yaml` | `generated-after-import` |
| `packages/llm/llm/README.md` | `reimplement-on-alpha5-seam` |
| `packages/llm/llm/README.zh.md` | `reimplement-on-alpha5-seam` |
| `packages/llm/llm/src/content.ts` | `reimplement-on-alpha5-seam` |
| `packages/llm/llm/src/index.ts` | `reimplement-on-alpha5-seam` |
| `packages/llm/llm/src/types.ts` | `reimplement-on-alpha5-seam` |
| `packages/llm/llm/tests/content.spec.ts` | `reimplement-on-alpha5-seam` |
| `packages/llm/llm/tests/service.spec.ts` | `reimplement-on-alpha5-seam` |
| `packages/llm/llm/tests/topology.spec.ts` | `reimplement-on-alpha5-seam` |
| `packages/llm/token-meter/README.i18n.yaml` | `generated-after-import` |
| `packages/llm/token-meter/README.md` | `reimplement-on-alpha5-seam` |
| `packages/llm/token-meter/README.zh.md` | `reimplement-on-alpha5-seam` |
| `packages/llm/token-meter/src/estimate.ts` | `reimplement-on-alpha5-seam` |
| `packages/llm/token-meter/src/index.ts` | `reimplement-on-alpha5-seam` |
| `packages/llm/token-meter/src/types.ts` | `reimplement-on-alpha5-seam` |
| `packages/llm/token-meter/src/usage-projection.ts` | `reimplement-on-alpha5-seam` |
| `packages/llm/token-meter/tests/token-meter.spec.ts` | `reimplement-on-alpha5-seam` |
| `packages/llm/token-meter/tests/token-usage-projection.spec.ts` | `reimplement-on-alpha5-seam` |
| `packages/session/session-persistence-jsonl/README.i18n.yaml` | `generated-after-import` |
| `packages/session/session-persistence-jsonl/README.md` | `reimplement-on-alpha5-seam` |
| `packages/session/session-persistence-jsonl/README.zh.md` | `reimplement-on-alpha5-seam` |
| `packages/session/session-persistence-jsonl/src/index.ts` | `reimplement-on-alpha5-seam` |
| `packages/session/session-persistence-sqlite/src/index.ts` | `reimplement-on-alpha5-seam` |
| `packages/session/session-persistence-sqlite/src/sql.ts` | `reimplement-on-alpha5-seam` |
| `packages/session/session-persistence-sqlite/src/store.ts` | `reimplement-on-alpha5-seam` |
| `packages/session/session-persistence-sqlite/tests/sqlite.spec.ts` | `reimplement-on-alpha5-seam` |
| `packages/session/session-persistence/README.i18n.yaml` | `generated-after-import` |
| `packages/session/session-persistence/README.md` | `reimplement-on-alpha5-seam` |
| `packages/session/session-persistence/README.zh.md` | `reimplement-on-alpha5-seam` |
| `packages/session/session-persistence/src/coordinator.ts` | `reimplement-on-alpha5-seam` |
| `packages/session/session-persistence/src/index.ts` | `reimplement-on-alpha5-seam` |
| `packages/session/session-persistence/src/preparations.ts` | `reimplement-on-alpha5-seam` |
| `packages/session/session-persistence/tests/coordinator-contract.ts` | `reimplement-on-alpha5-seam` |
| `packages/session/session-persistence/tests/persistence.spec.ts` | `reimplement-on-alpha5-seam` |
| `packages/session/session-persistence/tests/preparations.spec.ts` | `reimplement-on-alpha5-seam` |
| `packages/shell/tool-pwsh-persistent/tests/loader-composition.spec.ts` | `take-upstream` |
| `packages/shell/tool-pwsh-persistent/tests/tools.spec.ts` | `take-upstream` |
| `packages/subagent/subagent-claude-code/tests/real-product.spec.ts` | `take-upstream` |
| `packages/subagent/subagent-codex/tests/real-product.spec.ts` | `take-upstream` |
| `packages/terminal/terminal-bash/src/index.ts` | `take-upstream` |
| `packages/terminal/terminal-bash/src/session.ts` | `take-upstream` |
| `packages/terminal/terminal-bash/tests/index.spec.ts` | `take-upstream` |
| `packages/terminal/terminal-bash/tests/local.spec.ts` | `take-upstream` |
| `packages/terminal/terminal-bash/tests/session.spec.ts` | `take-upstream` |
| `packages/test-support/acp-snapshot/src/harness.ts` | `take-upstream` |
| `packages/test-support/acp-snapshot/tests/fixtures/fake-acp-agent.ts` | `take-upstream` |
| `packages/test-support/acp-snapshot/tests/harness.spec.ts` | `take-upstream` |
| `packages/test-support/client-runtime/src/fixtures.ts` | `take-upstream` |
| `packages/test-support/client-runtime/src/sessions.ts` | `take-upstream` |
| `packages/test-support/client-runtime/src/workspaces.ts` | `take-upstream` |
| `packages/test-support/client-runtime/tests/runtime.client.spec.tsx` | `take-upstream` |
| `packages/workspace/workspace/README.i18n.yaml` | `generated-after-import` |
| `packages/workspace/workspace/README.md` | `reimplement-on-alpha5-seam` |
| `packages/workspace/workspace/README.zh.md` | `reimplement-on-alpha5-seam` |
| `packages/workspace/workspace/tests/workspace.spec.ts` | `reimplement-on-alpha5-seam` |
| `pnpm-lock.yaml` | `generated-after-import` |
| `pnpm-workspace.yaml` | `reimplement-on-alpha5-seam` |
| `scripts/build-exe-for-python-sdk.ts` | `retain-desktop-extension` |
| `scripts/check-workspace-constraints.ts` | `reimplement-on-alpha5-seam` |
| `scripts/ci-workflow.spec.ts` | `reimplement-on-alpha5-seam` |
| `scripts/client-build-environment.client.spec.ts` | `reimplement-on-alpha5-seam` |
| `scripts/client-build-environment.ts` | `reimplement-on-alpha5-seam` |
| `scripts/client-bundle-purity.spec.ts` | `reimplement-on-alpha5-seam` |
| `scripts/gen-cordis-catalog.ts` | `take-upstream` |
| `scripts/gen-doc-graphs.ts` | `take-upstream` |
| `scripts/gen-third-party-notices.spec.ts` | `take-upstream` |
| `scripts/gen-third-party-notices.ts` | `take-upstream` |
| `scripts/oxlint-contract.spec.ts` | `take-upstream` |
| `scripts/release/families.spec.ts` | `reimplement-on-alpha5-seam` |
| `scripts/release/families.ts` | `reimplement-on-alpha5-seam` |
| `scripts/rescope-vendor.ts` | `reimplement-on-alpha5-seam` |
| `scripts/run-gates.spec.ts` | `reimplement-on-alpha5-seam` |
| `scripts/run-gates.ts` | `reimplement-on-alpha5-seam` |
| `scripts/snapshots/translation-prompt-v4/request-response.expected.json` | `generated-after-import` |
| `scripts/type-equiv.manifest.json` | `generated-after-import` |
| `scripts/verify-package-readme-model-experience.ts` | `reimplement-on-alpha5-seam` |
| `scripts/wine-windows-gates.sh` | `retain-desktop-extension` |
| `tsconfig.base.json` | `reimplement-on-alpha5-seam` |
| `tsconfig.client.json` | `reimplement-on-alpha5-seam` |
| `tsconfig.host.json` | `reimplement-on-alpha5-seam` |
| `vendor/README.md` | `take-upstream` |
| `website/package.json` | `take-upstream` |

## 导入检查点

1. 提交此清单修订而不更改生产文件。将该新的完整提交 ID 冻结为唯一的 `desktop_overlay_head`；它在每个后续的 merge-tree 命令中取代早期的 Task 2 提交，以便语义叠加恢复此清单和升级 fixture。
2. 在任何拓扑提交之前，使用隔离的临时工作树，并将索引都物化为 alpha.5 跟踪树，同时仅公开已安装的依赖运行时。要求 `node --import tsx/esm scripts/merge-translation-pairing.ts --probe` 在那里通过，然后使用完整的不可变 `desktop_overlay_head`、rc.2 基 `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` 和 alpha.5 `db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5` 运行显式基合并。在提交之外记录生成的树哈希和 308 路径/类型集。不要仅仅为了插入该哈希而修改或创建另一个预溯源提交，因为这样做会改变叠加输入并使证据自引用。缺少驱动程序运行时或 312 消息回退结果是硬失败。
3. 在该隔离重新计算后停止，直到指挥官明确授权拓扑工作。当前阶段不属于任何溯源合并、生产工作树 `read-tree` 或生产树突变。
4. 获得授权后，创建一个树不变的双亲溯源提交，以冻结的 Desktop 叠加历史作为第一父节点，以精确的 alpha.5 提交作为第二父节点。验证其树与其第一父节点逐字节相同。`ours` 合并策略仅允许用于此祖先链接，绝不用于内容选择。
5. 在干净的工作树中，物化并提交完整的 alpha.5 跟踪树。验证暂存树和提交树都等于 `db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5^{tree}`。这个精确树检查点（而不是逐路径导入）保证上游添加和删除是完整的。
6. 从物化后的 alpha.5 索引，重新运行驱动程序 `--probe`，然后使用相同的冻结 `desktop_overlay_head` 重复显式基命令。要求确切的树哈希、所有 308 个路径和所有冲突类型与步骤 2 中的隔离检查点匹配；如果运行时不可用、计数变为 312 或任何路径不同，则失败关闭。只有那时才能用 `read-tree` 加载该验证过的树。
7. 逐个解决所有 308 条冲突消息。为 `take-upstream` 保留合并的 alpha.5 内容，为 `retain-desktop-extension` 保留自动叠加的 Desktop 内容，并从 alpha.5 契约实现每个 `reimplement-on-alpha5-seam` 路径，而不整体复制 rc.2 文件。在提交之前拒绝所有剩余的冲突标记。在此清单的最终冲突解决版本中记录验证的执行树哈希；其合并输入仍然是已经冻结的预溯源叠加 SHA，因此不会引入递归。
8. 在重新生成输出之前协调共享 CI 和 Web 测试。运行 `scripts/ci-workflow.spec.ts` 加上 `.github/workflows/ci.yml` 和 `.github/workflows/e2e.yml` 的 alpha.5 包/运行门测试。运行上面列出的聚焦 Web 源，包括 `approval-composer.e2e.ts`、`command-image-envelope.expected.e2e.ts`、`chat-scroll-contract.e2e.ts`、`lifecycle-chrome.e2e.ts`、`plan-review.e2e.ts`、`queue-actions.e2e.ts`、`reference-composer.e2e.ts` 和 `workspace-management.e2e.ts`，以便附件、TurnNavigator、Workbench、审批和已安装生命周期保持明确的契约。
9. 保持每个 `retain-desktop-extension` 路径逐字节不变，除非后来的、明确拥有的兼容性提交仅更新其 alpha.5 依赖接缝。仅在源和包组合解决后才重新生成每个 `generated-after-import` 路径。
10. 使三个 Task 2 升级 fixture 变为 GREEN，同时通过 SHA-256 证明旧 Session 标题、源 JSONL、工作区和 Memory/Evolution/Brain 标记未更改。然后运行主机/客户端类型检查、完整的聚焦矩阵、Desktop 暂存和隔离的 Intel 打包冒烟测试。
