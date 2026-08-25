# `dsh-lark` Remote Session Plugin Implementation Plan

English | [中文](2026-08-25-dsh-lark-remote-session-plugin.zh.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an independently installable Harness Bundle that lets one paired Feishu owner select an ordinary Harness Session with `/`, submit strictly ordered development turns, and observe/control that exact Session through safe streaming cards.

**Architecture:** A dual-face `@deepseek-ai/dsh-lark` package owns a Host transport/runtime and a Client settings section. The Host reuses `ctx.apiProxy` for session lists, mux projections, tool views, approvals, and responses; it uses the official Lark Node SDK for WebSocket ingress and cards, and a plugin-owned storage domain for owner binding, deduplication, FIFO, card revisions, and staged-file metadata. It never embeds OpenClaw or creates another Agent runtime.

**Tech Stack:** TypeScript 6, Cordis, Harness ApiProxy/Agent/Attachment/Settings/Credentials/Storage Domain APIs, `@larksuiteoapi/node-sdk`, Schemastery, React 18, Harness UI primitives, Vitest.

---

## File map

- `src/config.ts`: Schemastery settings, credential references, safe defaults.
- `src/state.ts`: versioned storage-domain records and repositories.
- `src/transport.ts`: official SDK client, WebSocket lifecycle, message/card/media operations.
- `src/identity.ts`: owner pairing and every DM/callback authorization fence.
- `src/binding.ts`: project/session lists, ordinary-session validation, binding generation.
- `src/commands.ts`: exact slash fast path and signed card actions.
- `src/inbox.ts`: durable Feishu dedupe/FIFO and Harness Message-ID reconciliation.
- `src/projection.ts`: ApiProxy mux fold for text, tools, elapsed time, usage, and approvals.
- `src/cards.ts`: single-card rendering, monotonic throttled updates, text fallback.
- `src/attachments.ts`: AttachmentStore images and private generic-file staging.
- `src/runtime.ts`: activation, pause/resume/clear, event ownership, and teardown.
- `src/http.ts`: same-origin capability bridge for the settings page.
- `src/client/*`: localized Harness settings section and controller/store.
- `tests/*.host.spec.ts`: Host behavior and integration boundaries.
- `tests/*.client.spec.tsx`: Client slot, state, and credential-write behavior.

### Task 1: Define the installable package, config, and durable state

**Files:**
- Create: `packages/extensions/lark/package.json`
- Create: `packages/extensions/lark/tsconfig.json`
- Create: `packages/extensions/lark/tsdown.config.ts`
- Create: `packages/extensions/lark/cordis.patch.yml`
- Create: `packages/extensions/lark/src/config.ts`
- Create: `packages/extensions/lark/src/state.ts`
- Create: `packages/extensions/lark/src/invariant.ts`
- Create: `packages/extensions/lark/tests/package-shape.host.spec.ts`
- Create: `packages/extensions/lark/tests/state.host.spec.ts`
- Modify: `tsconfig.host.json`
- Modify: `tsconfig.client.json`

- [ ] **Step 1: Write RED tests for package and state contracts**

Assert public package name/version, `dsh.bundle.patch`, web Client injection, one `lark` patch row, no OpenClaw dependency/import/state path, and exact v1 records for owner, binding, queue, card, callback nonce, and staged file.

```ts ignore-check
expect(manifest.name).toBe('@deepseek-ai/dsh-lark')
expect(JSON.stringify(manifest)).not.toContain('openclaw')
expect(queueRecordSchema.parse(record)).toMatchObject({ status: 'prepared', sequence: 1 })
```

- [ ] **Step 2: Confirm RED**

Run: `pnpm exec vitest run packages/extensions/lark/tests/package-shape.host.spec.ts packages/extensions/lark/tests/state.host.spec.ts`

Expected: FAIL because the package and schemas do not exist.

- [ ] **Step 3: Add the minimal package and schemas**

Use repository version `0.1.1-rc.2`, official SDK dependency `^1.64.0`, Harness workspace peers, `clientBundle()`, and `defineDomain({ name: 'dsh_lark', version: 1, ... })`. Store only credential references; never App Secret values.

```ts ignore-check
export const LARK_APP_SECRET_REF = credentialRef('DSH_LARK_APP_SECRET')
export const larkDomainSpec = defineDomain({
  name: 'dsh_lark', version: 1,
  tables: { owner: domainTable(), binding: domainTable(), inbox: domainTable(), cards: domainTable() },
})
```

- [ ] **Step 4: Run GREEN and commit**

Run: `pnpm exec vitest run packages/extensions/lark/tests/package-shape.host.spec.ts packages/extensions/lark/tests/state.host.spec.ts && pnpm run constraints`

Expected: PASS.

Commit: `feat: define dsh lark bundle state`

### Task 2: Add owner-only SDK transport and exact `/` command entry

**Files:**
- Create: `packages/extensions/lark/src/transport.ts`
- Create: `packages/extensions/lark/src/identity.ts`
- Create: `packages/extensions/lark/src/commands.ts`
- Create: `packages/extensions/lark/src/cards.ts`
- Create: `packages/extensions/lark/tests/transport.host.spec.ts`
- Create: `packages/extensions/lark/tests/commands.host.spec.ts`
- Create: `packages/extensions/lark/LICENSE`
- Create: `packages/extensions/lark/THIRD_PARTY_NOTICES.md`

- [ ] **Step 1: Write RED transport and identity tests**

Cover missing credentials, Feishu/Lark domain selection, SDK startup/forced close, self-echo rejection, private-DM-only admission, exact owner/chat checks, callback generation/nonce/expiry, duplicate message IDs, and log redaction.

- [ ] **Step 2: Write RED `/` tests**

The exact texts `/`, `/进入`, and menu action `进入项目` must call `sendProjectCard()` without `Agent.followup`, `Agent.steer`, model APIs, or session mutation. Cover `/切换`, `/解绑`, `/状态`, and `/帮助`; an unpaired user gets only a short pairing code and no project facts, while unknown slash commands receive bounded help.

```ts ignore-check
await router.message(ownerDm('/'))
expect(transport.sendProjectCard).toHaveBeenCalledOnce()
expect(agent.followup).not.toHaveBeenCalled()
```

- [ ] **Step 3: Confirm RED**

Run: `pnpm exec vitest run packages/extensions/lark/tests/transport.host.spec.ts packages/extensions/lark/tests/commands.host.spec.ts`

Expected: FAIL because transport and router are missing.

- [ ] **Step 4: Implement the minimal official-SDK transport**

Create `Client`, `EventDispatcher`, and `WSClient`; register only `im.message.receive_v1` and `card.action.trigger`; map Feishu/Lark domains; close the socket with `{ force: true }` on abort. Port only MIT-compatible host-neutral queue/flush ideas and record Lark attribution.

- [ ] **Step 5: Implement owner gates and signed card values**

Validate app ownership, sender `open_id`, `chat_type === 'p2p'`, `chat_id`, current generation, a random one-use nonce, and TTL before reading project data. Persist dedupe before acknowledging accepted input.

- [ ] **Step 6: Run GREEN and commit**

Run: `pnpm exec vitest run packages/extensions/lark/tests/transport.host.spec.ts packages/extensions/lark/tests/commands.host.spec.ts`

Expected: PASS.

Commit: `feat: add owner gated lark transport`

### Task 3: Select projects and ordinary Sessions, then persist binding

**Files:**
- Create: `packages/extensions/lark/src/binding.ts`
- Create: `packages/extensions/lark/tests/binding.host.spec.ts`
- Modify: `packages/extensions/session-messenger/src/target-resolver.ts`
- Modify: `packages/extensions/session-messenger/package.json`
- Modify: `packages/extensions/session-messenger/tests/target-resolver.client.spec.ts`

- [ ] **Step 1: Write RED resolver-promotion tests**

Export a source-free `resolveOrdinarySession(ctx, sessionId)` and `assertOrdinarySession` from session-messenger. Cover live/cold ordinary, archived, deleted, missing, subagent, cwd mismatch, and lookup failure without creating a driver directly.

- [ ] **Step 2: Write RED card-selection tests**

Use `ctx.apiProxy.workspace.list` and `ctx.apiProxy.sessions.list`; preserve workspace order; show full paths; hide archived/blank/subagent/mismatched sessions; sort running first; revalidate every action; persist exactly one owner/chat binding with incremented generation.

- [ ] **Step 3: Confirm RED**

Run: `pnpm exec vitest run packages/extensions/session-messenger/tests/target-resolver.client.spec.ts packages/extensions/lark/tests/binding.host.spec.ts`

Expected: FAIL on the new public resolver and binding controller.

- [ ] **Step 4: Implement resolver reuse and binding controller**

Mint ApiProxy `RpcId`s per list call, reject failed RPC results, join session summaries to workspace accounts, and call the promoted Typert resolver before commit. Restart recovery must compare owner, chat, canonical cwd, archive set, source, and generation.

```ts ignore-check
const target = await resolveOrdinarySession(ctx, SessionId(action.sessionId))
await bindings.replace({ ...candidate, generation: previousGeneration + 1 })
```

- [ ] **Step 5: Run GREEN and commit**

Run: `pnpm exec vitest run packages/extensions/session-messenger/tests/target-resolver.client.spec.ts packages/extensions/lark/tests/binding.host.spec.ts`

Expected: PASS.

Commit: `feat: bind lark chats to ordinary sessions`

### Task 4: Deliver strict durable FIFO turns and remote control commands

**Files:**
- Create: `packages/extensions/lark/src/inbox.ts`
- Create: `packages/extensions/lark/tests/inbox.host.spec.ts`
- Create: `packages/extensions/lark/tests/recovery.host.spec.ts`
- Modify: `packages/extensions/lark/src/commands.ts`

- [ ] **Step 1: Write RED FIFO tests**

Cover monotonic sequence, event-ID dedupe, write-ahead before ack, one consumer per binding, exact pre-created Harness Message ID, `prepared -> queued -> claimed -> terminal`, and the invariant that sequence N+1 is not submitted until N's matching turn ends.

- [ ] **Step 2: Write RED recovery and control tests**

Simulate crashes before enqueue, after inbox insertion, after claim, and after `turn/end`; recovery must reuse the same Message ID. `/插话` calls only `steer`; `/停止` cancels undispatched remote records, removes unclaimed matching IDs, and calls `cancel({ kind: 'user' }, { keepInbox: true })` without deleting other-source inbox entries.

- [ ] **Step 3: Confirm RED**

Run: `pnpm exec vitest run packages/extensions/lark/tests/inbox.host.spec.ts packages/extensions/lark/tests/recovery.host.spec.ts`

Expected: FAIL because the durable inbox is missing.

- [ ] **Step 4: Implement strict terminal-boundary delivery**

Create `UserMessage` with `source: { kind: 'plugin', plugin: 'dsh-lark' }`, persist its ID, call `Agent.followup()` once, map `agent/inbox/claimed` to a turn, and advance only on that exact turn's `turn/end`. Reconcile live inbox and session events before any retry.

- [ ] **Step 5: Run GREEN and commit**

Run: `pnpm exec vitest run packages/extensions/lark/tests/inbox.host.spec.ts packages/extensions/lark/tests/recovery.host.spec.ts`

Expected: PASS.

Commit: `feat: add durable lark session fifo`

### Task 5: Project Harness streaming output into one monotonic card

**Files:**
- Create: `packages/extensions/lark/src/projection.ts`
- Create: `packages/extensions/lark/tests/projection.host.spec.ts`
- Create: `packages/extensions/lark/tests/cards.host.spec.ts`
- Modify: `packages/extensions/lark/src/cards.ts`

- [ ] **Step 1: Write RED projection tests**

Feed real ApiProxy mux frames for `assistant/chunk`, `assistant/message`, `tool/call`, `tool/result`, `turn/end`, host tool views, usage, and approval frames. Assert hidden reasoning, system content, environment values, and raw tool arguments never enter card state.

- [ ] **Step 2: Write RED card scheduling tests**

Assert one card per turn, stable placeholder-first paint, typewriter text growth, monotonic revision, configurable throttle, reflush after concurrent updates, elapsed time, real token totals or `暂不可用`, final dedupe, and bounded text fallback after card failure.

- [ ] **Step 3: Confirm RED**

Run: `pnpm exec vitest run packages/extensions/lark/tests/projection.host.spec.ts packages/extensions/lark/tests/cards.host.spec.ts`

Expected: FAIL because projection and streaming controllers are missing.

- [ ] **Step 4: Implement mux fold and card controller**

Open `ctx.apiProxy.events.mux` with one activation abort signal; filter by current binding; fold only forward events; render Host-provided tool views; sum only Harness `TokenUsage`; schedule SDK card updates with a mutex and `needsReflush` bit.

- [ ] **Step 5: Run GREEN and commit**

Run: `pnpm exec vitest run packages/extensions/lark/tests/projection.host.spec.ts packages/extensions/lark/tests/cards.host.spec.ts`

Expected: PASS.

Commit: `feat: stream harness turns to lark cards`

### Task 6: Add attachments and single-winner approvals

**Files:**
- Create: `packages/extensions/lark/src/attachments.ts`
- Create: `packages/extensions/lark/tests/attachments.host.spec.ts`
- Create: `packages/extensions/lark/tests/approvals.host.spec.ts`
- Modify: `packages/extensions/lark/src/projection.ts`
- Modify: `packages/extensions/lark/src/commands.ts`

- [ ] **Step 1: Write RED attachment tests**

Cover owner-before-download, 30 MiB default limit, image media validation and `ctx.attachments.saveImages`, randomized generic staging under the Harness home, safe names, SHA-256, atomic publish, `0600`, no project writes, partial-failure rejection, and seven-day bounded cleanup.

- [ ] **Step 2: Write RED approval tests**

Capture `approval/requested` rpcId/approvalId from the existing mux. Feishu actions may return only `allowed-once` or `rejected`; verify owner/chat/session/generation/nonce/TTL; call `ctx.apiProxy.respond`; treat `not-pending` as already handled; ensure no second `approval/request` listener is registered.

- [ ] **Step 3: Confirm RED**

Run: `pnpm exec vitest run packages/extensions/lark/tests/attachments.host.spec.ts packages/extensions/lark/tests/approvals.host.spec.ts`

Expected: FAIL because these adapters are missing.

- [ ] **Step 4: Implement attachments and approvals**

Keep image bytes in AttachmentStore and generic files in the plugin staging root. Construct the ApiProxy `client-response` with the original rpcId and exact session/approval IDs so desktop and Feishu race on the same pending entry.

- [ ] **Step 5: Run GREEN and commit**

Run: `pnpm exec vitest run packages/extensions/lark/tests/attachments.host.spec.ts packages/extensions/lark/tests/approvals.host.spec.ts`

Expected: PASS.

Commit: `feat: add lark attachments and approvals`

### Task 7: Add the Harness settings page and lifecycle controller

**Files:**
- Create: `packages/extensions/lark/src/http.ts`
- Create: `packages/extensions/lark/src/runtime.ts`
- Create: `packages/extensions/lark/src/index.ts`
- Create: `packages/extensions/lark/src/client/index.ts`
- Create: `packages/extensions/lark/src/client/index.tsx`
- Create: `packages/extensions/lark/src/client/LarkSettingsSection.tsx`
- Create: `packages/extensions/lark/src/client/LarkSettingsSection.module.css`
- Create: `packages/extensions/lark/src/client/store.ts`
- Create: `packages/extensions/lark/src/client/locales.ts`
- Create: `packages/extensions/lark/src/client/css-modules.d.ts`
- Create: `packages/extensions/lark/tests/http.host.spec.ts`
- Create: `packages/extensions/lark/tests/runtime.host.spec.ts`
- Create: `packages/extensions/lark/tests/client.client.spec.tsx`

- [ ] **Step 1: Write RED Host lifecycle tests**

Cover same-origin random-capability routes, bounded bodies, App Secret write-only credential path, pairing code confirmation, test connection, enable/disable, paused queue after re-enable, explicit resume/clear, data clear, staged-file cleanup, redacted diagnostics, and disposer completeness.

- [ ] **Step 2: Write RED Client tests**

Assert one `settings.section` entry, localized labels, stable placeholders before data, no secret echo, credential `set` in one direction, paired/connection/binding/queue facts, disabled destructive buttons, and confirmation for clear/re-pair.

- [ ] **Step 3: Confirm RED**

Run: `pnpm exec vitest run packages/extensions/lark/tests/http.host.spec.ts packages/extensions/lark/tests/runtime.host.spec.ts packages/extensions/lark/tests/client.client.spec.tsx`

Expected: FAIL because runtime and Client surfaces are missing.

- [ ] **Step 4: Implement runtime composition and settings UI**

Register settings and credential references, inject a generation-scoped bootstrap capability, expose narrow status/actions only, and mount `settings.section` id `lark`. Disable in this order: reject ingress, abort WebSocket/mux, cancel timers, drain card flushes and state writes, then release routes/listeners.

- [ ] **Step 5: Run GREEN and commit**

Run: `pnpm exec vitest run packages/extensions/lark/tests/http.host.spec.ts packages/extensions/lark/tests/runtime.host.spec.ts packages/extensions/lark/tests/client.client.spec.tsx && pnpm run test:gui`

Expected: PASS.

Commit: `feat: add dsh lark settings lifecycle`

### Task 8: Document, package, install, and verify the complete Bundle

**Files:**
- Create: `packages/extensions/lark/README.md`
- Create: `packages/extensions/lark/README.zh.md`
- Create: `packages/extensions/lark/README.i18n.yaml`
- Modify: `packages/extensions/README.md`
- Modify: `packages/extensions/README.zh.md`
- Modify: `packages/extensions/README.i18n.yaml`
- Modify: `PROJECT_CONTEXT.md`
- Create: `packages/extensions/lark/tests/loader-composition.client.spec.ts`
- Create: `packages/extensions/lark/tests/profile-install.host.spec.ts`

- [ ] **Step 1: Write RED composition/install tests**

Assert built Host/Client/invariant exports, one removable Loader row, install transaction updates both dependency and `dsh.profile.bundles`, no Desktop default patch, disable/uninstall leaves Sessions untouched, and clean web-profile startup after removal.

- [ ] **Step 2: Confirm RED**

Run: `pnpm exec vitest run packages/extensions/lark/tests/loader-composition.client.spec.ts packages/extensions/lark/tests/profile-install.host.spec.ts`

Expected: FAIL until package exports and docs are complete.

- [ ] **Step 3: Add bilingual documentation and package verification**

Document Feishu app permissions/events, credential entry, pairing, exact `/` behavior, commands, queue semantics, offline boundary, disable/re-enable behavior, and uninstall. Record MIT attribution for the OpenClaw-Lark patterns reviewed at npm version `2026.7.16` without bundling that package.

- [ ] **Step 4: Run complete offline gates**

Run: `pnpm install --frozen-lockfile && pnpm run build && pnpm exec vitest run packages/extensions/lark packages/extensions/session-messenger/tests/target-resolver.client.spec.ts && pnpm run typecheck:contracts-ready && pnpm run lint:contracts-ready && pnpm run verify-package-invariants && pnpm run verify-cordis-config && pnpm run doc-sync && git diff --check`

Expected: every command exits `0`.

- [ ] **Step 5: Pack and run real Profile preflight**

Pack the workspace package, install the tarball into a temporary real `web` Profile, restart it, confirm settings/Host activation, disable and verify zero runtime resources, remove it, and confirm the Profile still boots. Never import credentials from OpenClaw or Hermes.

- [ ] **Step 6: Run credential-gated Feishu acceptance when configured**

With credentials entered in Harness only, pair the owner, send `/`, select project/session, send multiple turns, verify FIFO/restart, stream card/tool/time/token output, attach image/file, answer one approval, use `/插话` and `/停止`, then disable. Without user-entered credentials, report this layer as not run rather than reading another runtime's secrets.

- [ ] **Step 7: Commit final delivery**

Commit: `feat: ship dsh lark remote sessions`
