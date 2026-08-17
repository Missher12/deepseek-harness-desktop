# Cross-Session Agent Messaging Plugin Implementation Plan

English | [中文](2026-08-17-cross-session-agent-messaging-plugin.zh.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one ordinary Harness session send, wake, reply to, and explicitly wait on another ordinary session by Session ID, with durable receipts and a compact in-app notification entry.

**Architecture:** Add one dual-face `@deepseek-ai/dsh-session-messenger` package. Its Host half uses the ApiProxy-configured Typert `agent` lookup, a `storageDomain` receipt table, four global tools, and exact same-origin snapshot/ack/SSE routes; its Client half occupies only `sidebar.footer.action`. Delivery is write-ahead and identified by a pre-created Message ID, while waits resolve only from receipt-bound replies.

**Tech Stack:** TypeScript, Cordis, Harness Agent/Tools/Typert/Storage Domain APIs, React 18, SSE over streaming fetch, Harness UI primitives, Vitest.

---

### Task 1: Scaffold the dual-face package and durable receipt schema

**Files:**
- Create: `packages/extensions/session-messenger/package.json`
- Create: `packages/extensions/session-messenger/tsconfig.json`
- Create: `packages/extensions/session-messenger/tsdown.config.ts`
- Create: `packages/extensions/session-messenger/cordis.patch.yml`
- Create: `packages/extensions/session-messenger/src/invariant.ts`
- Create: `packages/extensions/session-messenger/src/spec.ts`
- Create: `packages/extensions/session-messenger/src/types.ts`
- Create: `packages/extensions/session-messenger/tests/spec.client.spec.ts`
- Modify: `tsconfig.host.json`
- Modify: `tsconfig.client.json`

- [ ] **Step 1: Write the failing durable-boundary tests**

Test status discrimination, 16 KiB UTF-8 enforcement, 24-hour expiry, hop `0..8`, unresolved relay-envelope presence, and settled-record body removal.

```ts ignore-check
expect(receiptSchema.safeParse({ ...prepared, envelope: undefined }).success).toBe(false)
expect(receiptSchema.parse(delivered)).not.toHaveProperty('envelope')
```

- [ ] **Step 2: Run the test and confirm RED**

Run: `pnpm exec vitest run packages/extensions/session-messenger/tests/spec.client.spec.ts`

Expected: FAIL because the package and schema do not exist.

- [ ] **Step 3: Define one versioned domain and package build**

Declare `session_messenger` version `1`, table `receipts`, and a record union whose `prepared` and `delivery-recovery-pending` members require the bounded relay envelope. The package exports `.`, `./invariant`, `./client`, and `./cordis.patch.yml`, declares `dsh.bundle.patch` and `dsh.client.platform: web`, and uses `clientBundle()` for Host and Client artifacts.

```ts ignore-check
export const sessionMessengerDomainSpec = defineDomain({
  name: 'session_messenger',
  version: 1,
  tables: { receipts: domainTable<DeliveryId, Receipt>(receiptSchema) },
})
```

- [ ] **Step 4: Run schema and workspace checks**

Run: `pnpm exec vitest run packages/extensions/session-messenger/tests/spec.client.spec.ts && pnpm run constraints`

Expected: PASS.

- [ ] **Step 5: Commit the package boundary**

```bash
git add packages/extensions/session-messenger tsconfig.host.json tsconfig.client.json
git commit -m "feat: define session messenger receipts"
```

### Task 2: Resolve ordinary targets through Harness policy

**Files:**
- Create: `packages/extensions/session-messenger/src/target-resolver.ts`
- Create: `packages/extensions/session-messenger/tests/target-resolver.client.spec.ts`

- [ ] **Step 1: Write the failing rejection matrix**

Cover malformed, self, archived-before-lookup, missing, deleted, live subagent, cold subagent, and archived-after-lookup targets. Assert all rejection branches create no receipt, inbox event, wake, or model request. Cover a live ordinary Agent and a cold ordinary session restored with its recorded preset.

```ts ignore-check
await expect(resolveOrdinaryTarget(ctx, caller, raw)).rejects.toMatchObject({ code: 'target-archived' })
expect(agentLookup.resolve).not.toHaveBeenCalled()
```

- [ ] **Step 2: Run the test and confirm RED**

Run: `pnpm exec vitest run packages/extensions/session-messenger/tests/target-resolver.client.spec.ts`

Expected: FAIL because `resolveOrdinaryTarget` is missing.

- [ ] **Step 3: Implement exact policy reuse**

Validate non-empty printable Session IDs with a 256-byte cap, reject `caller.id`, check `workspaceRegistry.archivedSessionIds`, call `ctx.typert.lookups.get('agent')?.resolve(SessionId(raw))`, normalize `TypertLookupFailure`, and recheck the archive set immediately before returning the Agent. Never call `ctx.agents.resume()`.

```ts ignore-check
const lookup = ctx.typert.lookups.get('agent')
if (lookup === undefined) throw messengerError('target-lookup-unavailable')
const target = await lookup.resolve(SessionId(raw)) as Agent | undefined
```

- [ ] **Step 4: Run resolver tests**

Run: `pnpm exec vitest run packages/extensions/session-messenger/tests/target-resolver.client.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit target resolution**

```bash
git add packages/extensions/session-messenger/src/target-resolver.ts packages/extensions/session-messenger/tests/target-resolver.client.spec.ts
git commit -m "feat: resolve safe ordinary session targets"
```

### Task 3: Implement write-ahead delivery and crash recovery

**Files:**
- Create: `packages/extensions/session-messenger/src/envelope.ts`
- Create: `packages/extensions/session-messenger/src/receipt-store.ts`
- Create: `packages/extensions/session-messenger/src/coordinator.ts`
- Create: `packages/extensions/session-messenger/tests/coordinator.client.spec.ts`
- Create: `packages/extensions/session-messenger/tests/recovery.client.spec.ts`

- [ ] **Step 1: Write failing no-wake and wake delivery tests**

Test `inject()` for live idle/running/cold targets, `followup()` for idle/running targets, FIFO, one driver, exact Message ID, `prepared -> delivered`, and handled enqueue rejection becoming terminal before return.

```ts ignore-check
expect(target.inject).toHaveBeenCalledWith(expect.objectContaining({ id: receipt.messageId }))
expect(target.followup).not.toHaveBeenCalled()
expect(await store.get(receipt.id)).toMatchObject({ status: 'delivered' })
```

- [ ] **Step 2: Write failing crash-window tests**

Simulate death after `prepared`, after enqueue, and during delivered-status write. Recovery must rebuild the original frozen `UserMessage` with `freezeMessage()` and `MessageId(receipt.messageId)`, search live inbox/session events and cold persistence for that exact ID first, and never enqueue the same ID twice. Do not use `createUserMessage()`, because it would generate a different ID during recovery.

- [ ] **Step 3: Run the tests and confirm RED**

Run: `pnpm exec vitest run packages/extensions/session-messenger/tests/coordinator.client.spec.ts packages/extensions/session-messenger/tests/recovery.client.spec.ts`

Expected: FAIL because delivery coordination is missing.

- [ ] **Step 4: Implement the write-ahead coordinator**

Open `sessionMessengerDomainSpec` through `ctx.storageDomain.open()`, and close the domain through the plugin effect disposer. Pre-create the exact message ID, persist its full unresolved envelope, perform a third archive check after the awaited `prepared` write and immediately before enqueue, synchronously enqueue with `inject` or `followup`, then replace the receipt with a delivered record that omits the body. If that third check fails, settle the prepared receipt as rejected rather than leaving recoverable work. If the post-enqueue store write is indeterminate, persist or return `delivery-recovery-pending`. Subscribe to exact inbox inserted, claimed, and discarded events plus Agent failure/cancellation boundaries to update non-reply status by Message ID. Rate-limit each source to 30 deliveries per rolling minute, cap unresolved receipts at 256, expire unresolved receipts after 24 hours, and compact settled metadata after seven days at startup and on one bounded timer.

```ts ignore-check
await receipts.put(prepared)
await assertTargetStillOrdinaryAndUnarchived(target.id)
target[mode === 'send' ? 'inject' : 'followup'](message)
await receipts.put(toDelivered(prepared))
```

- [ ] **Step 5: Run coordinator tests**

Run: `pnpm exec vitest run packages/extensions/session-messenger/tests/coordinator.client.spec.ts packages/extensions/session-messenger/tests/recovery.client.spec.ts`

Expected: PASS.

- [ ] **Step 6: Commit the delivery engine**

```bash
git add packages/extensions/session-messenger/src/envelope.ts packages/extensions/session-messenger/src/receipt-store.ts packages/extensions/session-messenger/src/coordinator.ts packages/extensions/session-messenger/tests/coordinator.client.spec.ts packages/extensions/session-messenger/tests/recovery.client.spec.ts
git commit -m "feat: add durable cross-session delivery"
```

### Task 4: Register send, follow-up, reply, and explicit wait tools

**Files:**
- Create: `packages/extensions/session-messenger/src/tools.ts`
- Create: `packages/extensions/session-messenger/src/waits.ts`
- Create: `packages/extensions/session-messenger/src/index.ts`
- Create: `packages/extensions/session-messenger/tests/tools.client.spec.ts`
- Create: `packages/extensions/session-messenger/tests/reply-wait.client.spec.ts`

- [ ] **Step 1: Write failing tool-registration and sender tests**

Assert exactly four global names, canonical output schemas, caller identity from `exec.agent`, stable missing-caller rejection, no sender argument, send versus follow-up mode, and tool collision failure before store mutation.

- [ ] **Step 2: Write failing reply and wait tests**

Cover wrong caller, forged/expired/consumed tokens, hop 8, default non-waking reply, explicit waking reply, one-use token consumption, reply-arrival race, timeout `1_000..55_000`, default `30_000`, tool timeout `60_000`, forwarded `exec.signal`, dispose, and unrelated assistant output. Spy on `whenIdle()` and assert zero calls.

```ts ignore-check
expect(waitTool.timeoutMs).toBe(60_000)
expect(agent.whenIdle).not.toHaveBeenCalled()
```

- [ ] **Step 3: Run the tests and confirm RED**

Run: `pnpm exec vitest run packages/extensions/session-messenger/tests/tools.client.spec.ts packages/extensions/session-messenger/tests/reply-wait.client.spec.ts`

Expected: FAIL because the tools are not registered.

- [ ] **Step 4: Implement all four `defineTool` definitions**

Register through `ctx.tools.register()`. Render concise text and return JSON-safe values with `deliveryId`, `messageId`, `status`, `wakeRequested`, and stable error codes. `reply_to_session` must bind the caller to the target side of the original receipt and derive its destination from the receipt. `wait_for_session_reply` subscribes to coordinator settlement only and races timeout, abort, and plugin disposal.

- [ ] **Step 5: Run tool tests**

Run: `pnpm exec vitest run packages/extensions/session-messenger/tests/tools.client.spec.ts packages/extensions/session-messenger/tests/reply-wait.client.spec.ts`

Expected: PASS.

- [ ] **Step 6: Commit the tools**

```bash
git add packages/extensions/session-messenger/src/tools.ts packages/extensions/session-messenger/src/waits.ts packages/extensions/session-messenger/src/index.ts packages/extensions/session-messenger/tests/tools.client.spec.ts packages/extensions/session-messenger/tests/reply-wait.client.spec.ts
git commit -m "feat: add cross-session messaging tools"
```

### Task 5: Add authenticated notification routes and footer UI

**Files:**
- Create: `packages/extensions/session-messenger/src/http.ts`
- Create: `packages/extensions/session-messenger/src/events.ts`
- Create: `packages/extensions/session-messenger/src/client/index.tsx`
- Create: `packages/extensions/session-messenger/src/client/MessengerStatus.tsx`
- Create: `packages/extensions/session-messenger/src/client/MessengerStatus.module.css`
- Create: `packages/extensions/session-messenger/src/client/store.ts`
- Create: `packages/extensions/session-messenger/src/client/locales.ts`
- Create: `packages/extensions/session-messenger/src/client/css-modules.d.ts`
- Create: `packages/extensions/session-messenger/tests/http.client.spec.ts`
- Create: `packages/extensions/session-messenger/tests/client.client.spec.tsx`

- [ ] **Step 1: Write failing HTTP trust and reconnect tests**

Cover exact Host and Origin on mutation/stream requests, cross-site rejection, missing/wrong capability, no ACAO header, 4 KiB ack bound, bounded SSE clients, metadata-only frames, monotonic event IDs, Last-Event-ID replay, authoritative snapshot, and disposal of routes/connections. Snapshot and event-stream requests must use POST so real same-origin Chromium supplies Origin reliably.

- [ ] **Step 2: Write failing Client slot tests**

Assert only `sidebar.footer.action` is registered; current Session ID copying uses `writeClipboard`; false clipboard results never show success; unread/pending/error use text plus icons; ack clears notification state but not receipts or session messages.

- [ ] **Step 3: Run the tests and confirm RED**

Run: `pnpm exec vitest run packages/extensions/session-messenger/tests/http.client.spec.ts packages/extensions/session-messenger/tests/client.client.spec.tsx`

Expected: FAIL because notification surfaces are missing.

- [ ] **Step 4: Implement routes and streaming-fetch SSE**

Register exact POST snapshot, ack, and event-stream routes below `/plugins/dsh-session-messenger`. Inject an escaped per-generation capability into index HTML. The Client uses POST `fetch` with a capability header and parses SSE frames, avoiding a token in the URL; reconnect begins from snapshot and deduplicates by event ID. Do not require a custom Origin on GET/EventSource, because Chromium may omit it and scripts cannot set that forbidden header.

- [ ] **Step 5: Implement the compact Harness footer entry**

Use Harness primitives and only `--dsw-*` variables. Show status, unread count, recent error, and “copy current Session ID”; do not show message bodies or replace session rows. Add keyboard, `aria-live`, 200% zoom, and reduced-motion coverage.

- [ ] **Step 6: Run HTTP and Client tests**

Run: `pnpm exec vitest run packages/extensions/session-messenger/tests/http.client.spec.ts packages/extensions/session-messenger/tests/client.client.spec.tsx && pnpm run test:gui`

Expected: PASS.

- [ ] **Step 7: Commit notifications**

```bash
git add packages/extensions/session-messenger/src/http.ts packages/extensions/session-messenger/src/events.ts packages/extensions/session-messenger/src/client packages/extensions/session-messenger/tests/http.client.spec.ts packages/extensions/session-messenger/tests/client.client.spec.tsx
git commit -m "feat: add session message notifications"
```

### Task 6: Mount, document, and accept the plugin in Desktop

**Files:**
- Create: `packages/extensions/session-messenger/README.md`
- Create: `packages/extensions/session-messenger/README.zh.md`
- Create: `packages/extensions/session-messenger/README.i18n.yaml`
- Modify: `apps/desktop/package.json`
- Modify: `apps/desktop/desktop.cordis.patch.yml`
- Modify: `scripts/stage-desktop.ts`
- Modify: `scripts/stage-desktop.spec.ts`
- Modify: `PROJECT_CONTEXT.md`
- Create: `.agents/notes/proposed/feature/2026-08-17-cross-session-agent-messaging-plugin.md`
- Create: `.agents/notes/proposed/feature/2026-08-17-cross-session-agent-messaging-plugin.zh.md`
- Create: `.agents/notes/proposed/feature/2026-08-17-cross-session-agent-messaging-plugin.i18n.yaml`

- [ ] **Step 1: Add failing assembled-profile tests**

Assert one Desktop Loader row, all Host/Client artifacts staged, all four tools visible in native and code modes, three routes present, and every contribution absent after disablement. Ordinary Web composition must remain unchanged.

- [ ] **Step 2: Run the assembled tests and confirm RED**

Run: `pnpm exec vitest run packages/extensions/session-messenger/tests/loader-composition.client.spec.ts scripts/stage-desktop.spec.ts apps/desktop/tests/manifest.spec.ts`

Expected: FAIL on missing Desktop integration.

- [ ] **Step 3: Wire and document the plugin**

Add the workspace dependency and one `session-messenger` patch row. Extend staging for `lib/index.js`, `lib/client.js`, and package metadata. Document no-wake semantics, cold in-memory resume, archive race boundary, receipt retention, no native notifications, and the four exact tool contracts.

- [ ] **Step 4: Run full plugin and repository gates**

Run: `pnpm install && pnpm run build && pnpm exec vitest run packages/extensions/session-messenger scripts/stage-desktop.spec.ts apps/desktop/tests/manifest.spec.ts && pnpm run typecheck && pnpm run lint && pnpm run verify-package-invariants && pnpm run verify-cordis-config && pnpm run doc-sync && git diff --check`

Expected: every command exits `0`.

- [ ] **Step 5: Run real two-session Mac acceptance**

In a temporary `DSH_HOME`, create two ordinary sessions. Copy A's exact Session ID, send A→B without wake and prove B has no model request; send a follow-up and prove one driver; reply B→A and resolve an explicit wait. Restart and verify receipt recovery, then prove self, archived, missing, and subagent targets leave logs, inboxes, runtime status, and receipts unchanged. Disable the plugin and verify tools, routes, waits, and footer entry disappear while committed session messages remain.

- [ ] **Step 6: Commit Desktop integration**

```bash
git add apps/desktop scripts PROJECT_CONTEXT.md packages/extensions/session-messenger .agents/notes/proposed/feature/2026-08-17-cross-session-agent-messaging-plugin*
git commit -m "feat: integrate session messenger plugin"
```
