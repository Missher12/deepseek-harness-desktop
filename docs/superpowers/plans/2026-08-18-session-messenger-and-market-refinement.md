# Session Messenger and Market Refinement Implementation Plan

English | [中文](2026-08-18-session-messenger-and-market-refinement.zh.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship visible cross-session relay cards, a contained resizable communication drawer with safe send and reply actions, and a stable horizontally scrolling plugin-category rail in Desktop 0.1.6.

**Architecture:** The durable `user/message` remains the only relay record. The Host coordinator owns sender validation and one-use reply authority; exact same-origin POST routes expose only bounded operator inputs and delivery results. The removable Client plugin registers one Session-header trigger plus one shell-overlay drawer, while `ui-conversation` recognizes structured messenger relay sources and presents their body without duplicating an event. The dshmarket patch keeps registry order and native horizontal scrolling.

**Tech Stack:** TypeScript, Cordis, React 18, Harness slot/runtime APIs, Node HTTP, CSS Modules, pnpm patching, Vitest, Electron Builder, GitHub Actions.

---

### Task 1: Make the relay record structured and keep reply authority Host-only

**Files:**
- Modify: `packages/extensions/session-messenger/src/envelope.ts`
- Modify: `packages/extensions/session-messenger/src/coordinator.ts`
- Modify: `packages/extensions/session-messenger/src/tools.ts`
- Modify: `packages/extensions/session-messenger/src/types.ts`
- Test: `packages/extensions/session-messenger/tests/coordinator.client.spec.ts`
- Test: `packages/extensions/session-messenger/tests/tools.client.spec.ts`

- [ ] **Step 1: Write failing structured-relay and token-privacy tests**

Add assertions that the first text block contains bounded Harness metadata, the second is the exact untrusted body, and the source carries `senderSessionId`, `deliveryId`, `mode`, and `bodyBlockIndex: 1`. Assert serialized message content does not contain `replyToken` and `reply_to_session` needs only the addressed caller plus delivery ID.

```text
expect(message.source).toMatchObject({
  kind: 'plugin', plugin: 'dsh-session-messenger', form: 'relay',
  senderSessionId: source.id, deliveryId: receipt.id, mode: 'inject', bodyBlockIndex: 1,
})
expect(message.content[1]).toEqual({ type: 'text', text: 'hello' })
expect(JSON.stringify(message)).not.toContain(String(receipt.replyToken))
```

- [ ] **Step 2: Run the focused tests and confirm RED**

Run: `pnpm exec vitest run packages/extensions/session-messenger/tests/coordinator.client.spec.ts packages/extensions/session-messenger/tests/tools.client.spec.ts`

Expected: FAIL because the current relay is one opaque text block and the reply tool requires a browser/model-visible token.

- [ ] **Step 3: Implement the structured source and receipt-bound reply adapter**

Build the frozen message with two blocks and a local source type cast that preserves the merge-extensible message source. Add `replyToDelivery(caller, { deliveryId, message, wake })`, which reads the retained receipt, obtains its internal token, and delegates to the existing serialized `reply()` path; keep the token in durable storage but remove it from model-facing text and tool parameters.

```text
content: [
  { type: 'text', text: relayMetadata(receipt) },
  { type: 'text', text: receipt.envelope.body },
],
source: {
  kind: 'plugin', plugin: 'dsh-session-messenger', form: 'relay',
  senderSessionId: receipt.sourceSessionId, deliveryId: receipt.id,
  mode: receipt.mode, bodyBlockIndex: 1,
} as UserMessage['source']
```

- [ ] **Step 4: Run the focused tests and commit**

Run: `pnpm exec vitest run packages/extensions/session-messenger/tests/coordinator.client.spec.ts packages/extensions/session-messenger/tests/tools.client.spec.ts`

Expected: PASS.

Commit: `git commit -am "feat: structure cross-session relay messages"`

### Task 2: Add exact same-origin operator routes with zero-mutation rejection

**Files:**
- Modify: `packages/extensions/session-messenger/src/http.ts`
- Modify: `packages/extensions/session-messenger/src/protocol.ts`
- Modify: `packages/extensions/session-messenger/src/target-resolver.ts`
- Modify: `packages/extensions/session-messenger/src/index.ts`
- Test: `packages/extensions/session-messenger/tests/http.client.spec.ts`
- Test: `packages/extensions/session-messenger/tests/target-resolver.client.spec.ts`

- [ ] **Step 1: Write the failing send/reply trust matrix**

Add route tests for `SEND_PATH` and `REPLY_PATH`: exact loopback Host, exact Origin, one capability header, POST-only, JSON-only, 16 KiB UTF-8 body, printable IDs, live ordinary nonblank source, ordinary target, archived/subagent/self/missing rejection, and reply ownership. Capture receipt count, inbox calls, wake calls, and session event lengths before every rejected request and assert they remain equal afterward.

```text
const before = { receipts: source.receiptEntries().length, events: target.session.events.length }
const rejected = await invoke(route(surface, SEND_PATH), validHeaders(true), JSON.stringify(body))
expect(rejected.status).toBe(409)
expect({ receipts: source.receiptEntries().length, events: target.session.events.length }).toEqual(before)
```

- [ ] **Step 2: Run the HTTP tests and confirm RED**

Run: `pnpm exec vitest run packages/extensions/session-messenger/tests/http.client.spec.ts packages/extensions/session-messenger/tests/target-resolver.client.spec.ts`

Expected: FAIL because the operator routes and source resolver do not exist.

- [ ] **Step 3: Implement source authority and bounded routes**

Resolve the displayed source only from `ctx.agents.get(SessionId(raw))`; reject archived entries, `origin: 'subagent'`, owned children, and sessions without a `turn/start`. Parse `{ sourceSessionId, targetSessionId, message, wake }` and `{ sourceSessionId, deliveryId, message, wake }` with an operator-body cap of `MAX_MESSAGE_BYTES + 2048`. Return `{ deliveryId, messageId, status, wakeRequested }` or `{ errorCode }`; never return receipts, bodies, or reply tokens.

```text
const source = resolveOrdinaryOperatorSource(ctx, body.sourceSessionId)
const result = await coordinator.deliver(source, {
  targetSessionId: body.targetSessionId,
  message: body.message,
  mode: body.wake ? 'followup' : 'inject',
})
json(res, 200, result)
```

- [ ] **Step 4: Run the HTTP tests and commit**

Run: `pnpm exec vitest run packages/extensions/session-messenger/tests/http.client.spec.ts packages/extensions/session-messenger/tests/target-resolver.client.spec.ts`

Expected: PASS, including the complete rejection no-side-effect matrix.

Commit: `git commit -am "feat: add safe session messaging routes"`

### Task 3: Render one visible Harness relay card

**Files:**
- Create target: `packages/client/ui-conversation/src/client/chat/<RelayMessageCard.tsx>`
- Create target: `packages/client/ui-conversation/src/client/chat/<RelayMessageCard.module.css>`
- Modify: `packages/client/ui-conversation/src/client/chat/MessageItem.tsx`
- Modify: `packages/client/ui-conversation/src/client/locales.ts`
- Test: `packages/client/ui-conversation/tests/chat-branch-tails.client.spec.tsx`

- [ ] **Step 1: Write failing card and fallback tests**

Render a structured messenger relay and assert the sender, exact second-block body, delivery time, copy-source action, and reply event are visible without expanding a disclosure. Render an old relay lacking `bodyBlockIndex` and a foreign relay and assert both still use `ContextInjectionRow`.

```text
expect(view.container.querySelector('[data-session-relay-card]')).not.toBeNull()
expect(screen.getByText('hello from another session')).toBeTruthy()
fireEvent.click(screen.getByRole('button', { name: 'Reply' }))
expect(onReply).toHaveBeenCalledWith(expect.objectContaining({ deliveryId: 'delivery-1' }))
```

- [ ] **Step 2: Run the conversation test and confirm RED**

Run: `pnpm exec vitest run packages/client/ui-conversation/tests/chat-branch-tails.client.spec.tsx`

Expected: FAIL because every relay still uses the collapsed context row.

- [ ] **Step 3: Implement strict recognition and the visible card**

Accept only `kind: 'plugin'`, plugin `dsh-session-messenger`, form `relay`, printable sender/delivery IDs, mode `inject|followup`, and an in-range text `bodyBlockIndex`. Render the exact body block, dispatch `dsh-session-messenger:reply` with the delivery ID, use `writeClipboard` for the sender ID, and keep metadata in a bounded native disclosure. All unreadable shapes fall back unchanged.

```text
return relay === null
  ? <ContextInjectionRow {...props} />
  : <RelayMessageCard relay={relay} time={data.time} t={t} />
```

- [ ] **Step 4: Run the conversation tests and commit**

Run: `pnpm exec vitest run packages/client/ui-conversation/tests/chat-branch-tails.client.spec.tsx packages/client/ui-conversation/tests/chat-view.client.spec.tsx`

Expected: PASS.

Commit: `git add packages/client/ui-conversation && git commit -m "feat: show cross-session relay cards"`

### Task 4: Replace the protruding footer popover with a resizable header drawer

**Files:**
- Create target: `packages/extensions/session-messenger/src/client/<MessengerUiController.ts>`
- Create target: `packages/extensions/session-messenger/src/client/<MessengerHeaderButton.tsx>`
- Create target: `packages/extensions/session-messenger/src/client/<MessengerDrawer.tsx>`
- Modify: `packages/extensions/session-messenger/src/client/index.tsx`
- Modify: `packages/extensions/session-messenger/src/client/store.ts`
- Modify: `packages/extensions/session-messenger/src/client/MessengerStatus.module.css`
- Modify: `packages/extensions/session-messenger/src/client/locales.ts`
- Modify: `packages/extensions/session-messenger/package.json`
- Test: `packages/extensions/session-messenger/tests/client.client.spec.tsx`
- Test: `packages/extensions/session-messenger/tests/loader-composition.client.spec.ts`

- [ ] **Step 1: Write failing registration, geometry, and action tests**

Assert one `conversation.session.header.utilities` trigger and one `shell.overlay` drawer, with no footer occupant. Cover badge counts, exact Session ID copying, Escape focus restoration, session-switch close, width clamp `320..560`, numeric width persistence, full-width narrow mode, listener cleanup, send and reply requests, disabled double-submit, retained failed drafts, mark-read, and reply-card event opening.

```text
expect(ctx.slots.entries('sidebar.footer.action')).toEqual([])
expect(ctx.slots.entries('conversation.session.header.utilities')).toHaveLength(1)
expect(ctx.slots.entries('shell.overlay')).toHaveLength(1)
expect(localStorage.getItem('dsh-session-messenger.drawer-width')).toBe('480')
```

- [ ] **Step 2: Run the Client tests and confirm RED**

Run: `pnpm exec vitest run packages/extensions/session-messenger/tests/client.client.spec.tsx packages/extensions/session-messenger/tests/loader-composition.client.spec.ts`

Expected: FAIL because the footer registration and fixed popover are still present.

- [ ] **Step 3: Extend the transport and add a tiny UI controller**

Add `send()` and `reply()` transport methods that use the existing capability header and abort lifetime. The controller publishes `{ openSessionId, replyDeliveryId, width }`, clamps width to `320..560`, persists only the number, and clears reply state on close or session change.

```text
async send(input, signal) {
  return operatorRequest(bootstrap.sendPath, input, signal)
}
async reply(input, signal) {
  return operatorRequest(bootstrap.replyPath, input, signal)
}
```

- [ ] **Step 4: Implement the header button and overlay drawer**

Register the header trigger with `sessionId` and the overlay with `useSessions`. The drawer shows current-session receipt rows, a target/body/wake composer, receipt-bound reply mode, bounded diagnostics, and copy/ack actions. Use a left pointer-capture handle and CSS variables for width; at `max-width: 720px` use `inset: 38px 0 0` and hide the handle. The overlay root remains click-through while the drawer opts into pointer events.

```text
ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register(headerOptions, MessengerHeaderButton))
ctx.slots.inject('shell.overlay', () => ctx.slots.register(overlayOptions, MessengerDrawer))
```

- [ ] **Step 5: Run Client, GUI, and lifecycle tests and commit**

Run: `pnpm exec vitest run packages/extensions/session-messenger/tests/client.client.spec.tsx packages/extensions/session-messenger/tests/loader-composition.client.spec.ts packages/extensions/session-messenger/tests/overlay-composition.spec.ts && pnpm run test:gui`

Expected: PASS with no footer overflow and no leaked listeners or requests.

Commit: `git add packages/extensions/session-messenger && git commit -m "feat: add session communication drawer"`

### Task 5: Keep every plugin-market category in stable horizontal order

**Files:**
- Modify through pnpm patch workspace: `node_modules/dshmarket/src/client/MarketSection.tsx`
- Modify through pnpm patch workspace: `node_modules/dshmarket/src/client/Market.module.css`
- Modify: `patches/dshmarket@1.10.1.patch`
- Modify: `scripts/dshmarket-client-layout.spec.ts`
- Modify: `scripts/dshmarket-client-artifact.spec.ts`

- [ ] **Step 1: Write failing stable-order and scroll tests**

Assert `orderedCategories(categories, active, open)` returns the registry array unchanged, all registry categories render after `All`, selection does not change DOM order or `scrollLeft`, edge buttons disable correctly, keyboard focus performs minimum scrolling, reduced motion disables smooth scrolling, and the page never gains horizontal overflow.

```text
expect(orderedCategories(['ui', 'tools', 'fun'], 'fun', false)).toEqual(['ui', 'tools', 'fun'])
expect(after.map(node => node.dataset.category)).toEqual(before.map(node => node.dataset.category))
expect(rail.scrollLeft).toBe(beforeScrollLeft)
```

- [ ] **Step 2: Run the market tests and confirm RED**

Run: `pnpm exec vitest run scripts/dshmarket-client-layout.spec.ts scripts/dshmarket-client-artifact.spec.ts`

Expected: FAIL because the selected category is currently moved to the first position.

- [ ] **Step 3: Patch dshmarket and regenerate the committed pnpm patch**

Return a shallow copy in registry order, remove selection-driven ordering, retain the native no-wrap scrollport, add left/right edge controls and fades, and call `scrollIntoView({ inline: 'nearest', block: 'nearest', behavior })` only for keyboard focus. Preserve `scrollLeft` across filter state updates. Regenerate the patch with `pnpm patch-commit <patch-directory>` so both source and bundled client artifacts stay aligned.

```text
export function orderedCategories(categories: readonly string[]): string[] {
  return [...categories]
}
```

- [ ] **Step 4: Run market and stage guards and commit**

Run: `pnpm exec vitest run scripts/dshmarket-client-layout.spec.ts scripts/dshmarket-client-artifact.spec.ts scripts/stage-desktop.spec.ts`

Expected: PASS with the current twenty-category catalog and arbitrary future counts.

Commit: `git add patches/dshmarket@1.10.1.patch scripts && git commit -m "fix: keep market categories in stable order"`

### Task 6: Update documentation and run regression gates

**Files:**
- Modify: `packages/extensions/session-messenger/README.md`
- Modify: `packages/extensions/session-messenger/README.zh.md`
- Modify: `packages/extensions/session-messenger/README.i18n.yaml`
- Modify: `packages/client/ui-conversation/README.md`
- Modify: `packages/client/ui-conversation/README.zh.md`
- Modify: `packages/client/ui-conversation/README.i18n.yaml`
- Modify: `apps/desktop/README.md`
- Modify: `apps/desktop/README.zh.md`
- Modify: `apps/desktop/README.i18n.yaml`
- Modify: `PROJECT_CONTEXT.md`

- [ ] **Step 1: Update bilingual ownership and behavior documentation**

Document the header utility, shell-overlay drawer, structured single-record relay card, Host-only reply authority, stable category rail, cleanup ownership, and unchanged install/update/rollback behavior. Record each translation pair after both sides match.

Run: `pnpm run verify-translation-pairing --write packages/extensions/session-messenger/README.md && pnpm run verify-translation-pairing --write packages/client/ui-conversation/README.md && pnpm run verify-translation-pairing --write apps/desktop/README.md`

Expected: three updated pairing records.

- [ ] **Step 2: Run focused and repository-wide verification**

Run: `pnpm exec vitest run packages/extensions/session-messenger/tests packages/client/ui-conversation/tests/chat-branch-tails.client.spec.tsx scripts/dshmarket-client-layout.spec.ts scripts/dshmarket-client-artifact.spec.ts scripts/stage-desktop.spec.ts`

Run: `pnpm run typecheck && pnpm run lint && pnpm run doc-sync && git diff --check`

Expected: all commands exit 0.

- [ ] **Step 3: Commit documentation**

Commit: `git add packages/extensions/session-messenger/README.md packages/extensions/session-messenger/README.zh.md packages/extensions/session-messenger/README.i18n.yaml packages/client/ui-conversation/README.md packages/client/ui-conversation/README.zh.md packages/client/ui-conversation/README.i18n.yaml apps/desktop/README.md apps/desktop/README.zh.md apps/desktop/README.i18n.yaml PROJECT_CONTEXT.md && git commit -m "docs: describe desktop messaging refinement"`

### Task 7: Build, install, verify, and publish Desktop 0.1.6

**Files:**
- Modify: `apps/desktop/package.json`
- Modify: `apps/desktop/tests/manifest.spec.ts`
- Modify: `apps/desktop/tests/packaged-smoke.ts`
- Modify: `apps/desktop/tests/packaged-smoke.spec.ts`
- Modify: `apps/desktop/tests/windows-packaged-smoke.spec.ts`
- Modify: `.github/workflows/desktop-windows-release.yml`

- [ ] **Step 1: Add packaged acceptance for the new surfaces**

Exercise two temporary ordinary sessions: exact send, one visible claimed card, one receipt-bound reply, one no-wake pending state, and archived/subagent rejection with unchanged receipts and events. Capture category DOM order and rail offset before and after selecting a non-leading category, resize the drawer to both clamps, restart, and confirm the saved width. Keep all tests on temporary `DSH_HOME` profiles.

```text
expect(await page.locator('[data-session-relay-card]').textContent()).toContain(body)
expect(await categoryIds(page)).toEqual(registryCategoryIds)
expect(await categoryIds(page)).toEqual(beforeSelection)
```

- [ ] **Step 2: Bump and run the Mac Intel package acceptance**

Set `apps/desktop/package.json` to `0.1.6`, build the staged app and x64 DMG, install over `/Applications/DeepSeek Harness.app` without touching `~/.dsh`, verify the new UI and random-port cleanup, then compute `stat` size and `shasum -a 256`.

Run: `pnpm run desktop:stage && pnpm --dir apps/desktop run pack:dmg`

Expected: an Intel x64 DMG whose installed app passes the packaged smoke and preserves the existing profile.

- [ ] **Step 3: Build and verify Windows x64 from the same commit**

Push the branch and run the native `windows-2025` workflow. Require real Setup installation, shortcuts, automatic launch, exact cross-session send/card/reply, stable category order, width persistence, process-tree cleanup, uninstall, and preservation of `DSH_HOME` plus Electron data.

Run: `gh workflow run desktop-windows-release.yml --ref codex/fix-slider-market-layout`

Expected: the workflow concludes `success` and publishes a Setup plus LF checksum artifact from the same commit as the Mac DMG.

- [ ] **Step 4: Publish and verify public bytes**

Merge the reviewed branch, create `desktop-v0.1.6`, upload Mac DMG, Windows Setup, and LF-only `.sha256` files, wait for every asset state to become `uploaded`, then re-download each public asset and verify exact size and SHA-256. Update the release body with both platforms and acceptance scope.

Run: `gh release view desktop-v0.1.6 --json assets,url && shasum -a 256 -c SHA256SUMS`

Expected: every public download matches the locally accepted bytes.

- [ ] **Step 5: Close only task-owned resource consumers**

Unmount task-created DMGs, stop task-owned mock/build servers and duplicate candidate app processes, remove temporary smoke profiles, and verify no task-owned ports remain. Do not terminate Codex, remote-access software, Hermes, or unrelated applications.

Run: `ps -axo pid=,ppid=,%cpu=,command= | sort -k3 -nr | head -30`

Expected: no task-owned build or smoke process remains; unrelated high-CPU processes are reported but untouched.
