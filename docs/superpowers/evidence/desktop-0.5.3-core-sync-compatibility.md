# Desktop 0.5.3 alpha.5 core-sync ownership manifest

## Exact coordinates

- Released Desktop product tree: `7384b863e88b005b3309e49a0aebb7a2ea91d4c3`.
- Task-book child used for this branch: `6155fc78bfd4ffeef196979157bb1d82b1243bfc`.
- Task-book revision read out-of-tree: `727335c8e67902f06b6eb4b8f0fd699d7bb3b722`.
- Official rc.2 comparison tree: `dsh-v0.1.1-rc.2` at `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`.
- Official import target: `dsh-v0.1.2-alpha.5` at `db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`.
- Task 2 Desktop overlay head: `f6944b1ad34c0ed2132584ae1b623950c18813a6`.
- Explicit-base merged tree (diagnostic only): `d6620128d10d05cd0f7aae178c4df0b121f6d67f`.

The Desktop and official repositories have unrelated Git roots. A normal merge, empty-tree merge, or unrelated-history content merge is not an accepted content-integration mechanism. The approved route is a later tree-invariant two-parent provenance commit, an exact alpha.5 tree materialization commit, then an explicit-base semantic merge whose conflicts are resolved one by one under this manifest. None of those topology or materialization steps has been executed in this worktree yet.

The broader ownership inventory compares each product tree against the exact official rc.2 tree with rename detection disabled, intersects the changed path sets, and then rejects paths whose final Desktop and alpha.5 bytes already match. The released Desktop changes 1,074 raw path endpoints, alpha.5 changes 7,991 raw path endpoints, and the intersection contains 443 paths whose final contents differ. Git rename accounting reports about 7,633 alpha.5 file changes; the raw endpoint count is retained below so neither side of a rename disappears from ownership review.

After Task 2, the exact diagnostic command was `git merge-tree --write-tree --name-only --messages --merge-base=b150a551b8d465e31e418e1b2eaf5e79bbb7d28e f6944b1ad34c0ed2132584ae1b623950c18813a6 db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`. It returned status 1 as expected, wrote no index/worktree state, and produced the tree recorded above. Its 307 conflict messages comprise 242 `content`, 56 `modify/delete`, eight `file location`, and one `directory rename split`; the name-only prelude contains 306 concrete paths because the directory-split message names a structural source prefix instead of one output path.

## Dispositions

- `take-upstream`: import the alpha.5 path exactly. Official application, core, test, documentation, and tool structure owns it.
- `retain-desktop-extension`: retain the released Desktop path exactly. This includes existing platform workflow and native Windows-owned boundaries that this Mac task must not edit.
- `reimplement-on-alpha5-seam`: first import the alpha.5 package/layout truth, then restore only the required Desktop behavior through focused tests. The old rc.2 file is not copied wholesale.
- `generated-after-import`: regenerate from resolved source with the repository generators or snapshot/pairing workflow; do not choose either generated copy by hand.

Explicit-base conflict-message dispositions: `take-upstream` 23, `retain-desktop-extension` 3, `reimplement-on-alpha5-seam` 198, `generated-after-import` 83 (307 total). The broader 443-path final-byte overlap inventory remains classified as `take-upstream` 57, `retain-desktop-extension` 7, `reimplement-on-alpha5-seam` 262, `generated-after-import` 117.

## Explicit-base conflict inventory

Every conflict message from the post-Task-2 explicit-base run has one row below. File-location rows record both the Desktop source and Git-suggested alpha.5 destination; the one directory-split row records its structural source prefix.

| Path or structural prefix | Conflict type | Disposition |
|---|---|---|
| `.agents/notes/implemented/architecture/2026-08-05-profile-plugin-bundles.i18n.yaml` | `content` | `generated-after-import` |
| `.agents/notes/implemented/feature/2026-08-11-workspace-sidebar-order-and-folding.i18n.yaml` | `content` | `generated-after-import` |
| `.agents/notes/implemented/feature/2026-08-11-workspace-sidebar-order-and-folding.md` | `content` | `take-upstream` |
| `.agents/notes/implemented/feature/2026-08-11-workspace-sidebar-order-and-folding.zh.md` | `content` | `take-upstream` |
| `.github/workflows/ci.yml` | `content` | `retain-desktop-extension` |
| `.github/workflows/e2e.yml` | `content` | `retain-desktop-extension` |
| `README.i18n.yaml` | `content` | `generated-after-import` |
| `THIRD_PARTY_NOTICES.md` | `content` | `generated-after-import` |
| `apps/cli/src/profile-boot.ts` | `content` | `reimplement-on-alpha5-seam` |
| `apps/cli/tests/web-agent-presets.e2e.ts` | `content` | `take-upstream` |
| `apps/web/tests/built-boot.expected.e2e.ts` | `content` | `take-upstream` |
| `apps/web/tests/command-image-envelope.expected.e2e.ts` | `content` | `take-upstream` |
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
| `apps/web/tests/lifecycle-chrome.e2e.ts` | `content` | `take-upstream` |
| `apps/web/tests/plan-review.e2e.ts` | `content` | `take-upstream` |
| `apps/web/tests/snapshots/skill-tool-row/ui.expected.md` | `modify/delete` | `generated-after-import` |
| `apps/web/tests/support.ts` | `content` | `take-upstream` |
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

## Required ownership matrix

| Area | Ownership and import rule |
|---|---|
| `apps/web/**` | `take-upstream`; alpha.5 application and expected-test layout are authoritative. Snapshot outputs are `generated-after-import`. |
| `apps/cli/**` | `take-upstream`, except `src/profile-boot.ts`, whose packaged Desktop boot contract is `reimplement-on-alpha5-seam`. |
| `packages/client/**` | Import alpha.5 package splits and official Turn outline/TurnNavigator first; reimplement renderer attachment privacy, Desktop slots, sidebar, settings, and Workbench integration on those seams. |
| `packages/host/apiproxy/**` and `packages/api/session-controller/**` | Import the alpha.5 API/session-controller layout, then reimplement Desktop projections and private transport boundaries there; do not retain the removed apiproxy layout as a second authority. |
| `packages/session/**` | Import alpha.5 persistence/projection ownership, then reimplement rc.2/alpha.3 upgrade recovery with source JSONL, Session ID, title, workspace, and marker preservation. |
| `packages/boot/app-boot/**` | Import alpha.5 boot APIs, then reimplement strict legacy module-fallback recovery and packaged profile composition. |
| `packages/llm/**` and `packages/attachment/**` | Import alpha.5 core behavior, then reimplement bounded document admission, projection, accounting, and renderer privacy without weakening limits. |
| `packages/extensions/**` | Import official extension seams; preserve Desktop-only extension packages separately and prevent duplicate core composition. |
| `apps/desktop/**` | `retain-desktop-extension`; it is uncontested and remains the only Desktop app, updater, staging, packaging, Native Messaging, and macOS lifecycle owner. |
| `packages/extensions/desktop-workbench/**` | `retain-desktop-extension`; rebind its dependencies after import, but keep one fixed Workbench surface. |
| `apps/desktop-managed-memory/**`, `apps/desktop-managed-evolution/**`, `packages/brain/missher-brain/**`, and `packages/client/ui-settings-brain/**` | `retain-desktop-extension`; migrate imports/composition only and preserve user markers byte for byte. |
| Browser/computer control extension packages | `retain-desktop-extension`; only compatibility imports are allowed in this core-sync stage. BrowserSkill is out of scope. |
| Prompt navigation | Remove or leave unmounted the rc.2 `PromptRail`; alpha.5 Turn outline/TurnNavigator is the sole runtime navigation authority. |
| `scripts/stage-desktop.ts`, update-manifest tooling, Electron builder files, and Desktop assets | `retain-desktop-extension`; later staging tests prove they include the alpha.5 runtime and all Desktop private extensions. |
| Lockfile, notices, paired sidecars, generated subsystem pages, and snapshots | `generated-after-import`; repository generators own the final bytes. |

## Broader final-byte overlap inventory

| Path | Disposition |
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
| `.github/workflows/ci.yml` | `retain-desktop-extension` |
| `.github/workflows/e2e.yml` | `retain-desktop-extension` |
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
| `apps/web/tests/agent-preset-selection.e2e.ts` | `take-upstream` |
| `apps/web/tests/approval-composer.e2e.ts` | `take-upstream` |
| `apps/web/tests/built-boot.snapshot.ts` | `take-upstream` |
| `apps/web/tests/chat-scroll-contract.e2e.ts` | `take-upstream` |
| `apps/web/tests/command-image-envelope.snapshot.ts` | `take-upstream` |
| `apps/web/tests/hmr-live.e2e.ts` | `take-upstream` |
| `apps/web/tests/image-display.snapshot.ts` | `take-upstream` |
| `apps/web/tests/lifecycle-chrome.e2e.ts` | `take-upstream` |
| `apps/web/tests/models-settings.e2e.ts` | `take-upstream` |
| `apps/web/tests/onboarding-deepseek-config.e2e.ts` | `take-upstream` |
| `apps/web/tests/plan-review.e2e.ts` | `take-upstream` |
| `apps/web/tests/queue-actions.e2e.ts` | `take-upstream` |
| `apps/web/tests/reference-composer.e2e.ts` | `take-upstream` |
| `apps/web/tests/scaffold.ts` | `take-upstream` |
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
| `apps/web/tests/steering.e2e.ts` | `take-upstream` |
| `apps/web/tests/support.ts` | `take-upstream` |
| `apps/web/tests/workspace-management.e2e.ts` | `take-upstream` |
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

## Import checkpoints

1. Add the alpha.5 commit as a tree-invariant provenance parent only after the commander authorizes that step; verify the tree before and after is identical.
2. Import every `take-upstream` path in bounded batches and record each batch path list and focused test result.
3. For every `reimplement-on-alpha5-seam` path, begin from alpha.5 bytes/layout and add the smallest Desktop behavior needed by the upgrade fixtures and existing contracts.
4. Keep every `retain-desktop-extension` path byte-identical unless a later, explicitly owned compatibility commit must update only its dependency seam.
5. Regenerate every `generated-after-import` path after source and package composition are resolved.
6. Prove the old Session title/JSONL/workspace and Memory/Evolution/Brain markers are unchanged by SHA-256, then run host/client typecheck, focused tests, Desktop staging, and isolated Intel packaged smoke.
