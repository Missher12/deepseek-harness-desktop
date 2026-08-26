# `dsh-lark` Stream Coalescing Implementation Plan

English | [中文](2026-08-26-dsh-lark-stream-coalescing.zh.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace per-chunk serialized Feishu card writes with latest-state coalescing, keep final delivery prompt, and remove unused cross-package Session resolver changes.

**Architecture:** `TurnCardStream` owns one latest projection, one timer, and one in-flight write. Non-final calls schedule without waiting; a final call cancels the timer and drains the latest state after at most one existing request. The change remains inside the removable Lark Bundle except for deleting unused `session-messenger` additions.

**Tech Stack:** TypeScript, Cordis, Vitest fake timers, Feishu `im.message.patch`, pnpm workspace tooling.

---

### Task 1: Record the approved design

**Files:**
- Create: `docs/superpowers/specs/2026-08-26-dsh-lark-stream-coalescing-design.md`
- Create: `docs/superpowers/specs/2026-08-26-dsh-lark-stream-coalescing-design.zh.md`
- Create: `docs/superpowers/specs/2026-08-26-dsh-lark-stream-coalescing-design.i18n.yaml`

- [ ] **Step 1: Confirm the design covers the measured failure**

Require the spec to state the current 100-chunk/101-write/35-second reproduction, the `im.message.patch` rate-limit constraint, latest-state coalescing, final priority, shutdown cancellation, fallback behavior, and the exact package-isolation boundary.

- [ ] **Step 2: Record and verify the bilingual pair**

Run:

```bash
pnpm run verify-translation-pairing --write docs/superpowers/specs/2026-08-26-dsh-lark-stream-coalescing-design.md
pnpm run verify-translation-pairing docs/superpowers/specs/2026-08-26-dsh-lark-stream-coalescing-design.md
```

Expected: one record written and the named pair reported consistent.

### Task 2: Add failing scheduler tests

**Files:**
- Modify: `packages/extensions/lark/tests/cards.host.spec.ts`

- [ ] **Step 1: Replace sequential-write expectations with burst coalescing**

Use Vitest fake timers and submit several updates without advancing time:

```ts
import { expect, vi } from 'vitest'

interface Stream {
  update(next: unknown, final?: boolean): Promise<void>
}

interface Controller {
  open(chatId: string, initial: unknown): Promise<Stream>
}

type StateFactory = (text: string, status?: 'placeholder' | 'streaming' | 'completed') => unknown

async function verifyBurst(
  controller: Controller,
  updateCard: ReturnType<typeof vi.fn>,
  state: StateFactory,
): Promise<void> {
  vi.useFakeTimers()
  vi.setSystemTime(1_000)
  const stream = await controller.open('oc_dm', state('', 'placeholder'))
  await stream.update(state('H'))
  await stream.update(state('He'))
  await stream.update(state('Hello'))
  expect(updateCard).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(100)
  expect(updateCard).toHaveBeenCalledOnce()
  expect(JSON.stringify(updateCard.mock.calls[0]![1])).toContain('Hello')
}

void verifyBurst
```

- [ ] **Step 2: Prove final priority behind one in-flight request**

Hold the first write open, submit newer text and a terminal state, then release it:

```ts
import { expect, vi } from 'vitest'

interface Stream {
  update(next: unknown, final?: boolean): Promise<void>
}

type StateFactory = (text: string, status?: 'streaming' | 'completed') => unknown
type CreateStream = (updateCard: ReturnType<typeof vi.fn>) => Promise<Stream>

async function verifyFinalPriority(createStream: CreateStream, state: StateFactory): Promise<void> {
let releaseFirst!: () => void
const updateCard = vi.fn()
  .mockImplementationOnce(() => new Promise<void>(resolve => { releaseFirst = resolve }))
  .mockResolvedValue(undefined)
const stream = await createStream(updateCard)
await stream.update(state('A'))
await vi.advanceTimersByTimeAsync(100)
await stream.update(state('AB'))
const final = stream.update(state('ABC', 'completed'), true)
expect(updateCard).toHaveBeenCalledTimes(1)
releaseFirst()
await final
expect(updateCard).toHaveBeenCalledTimes(2)
expect(JSON.stringify(updateCard.mock.calls[1]![1])).toContain('ABC')
}

void verifyFinalPriority
```

- [ ] **Step 3: Pin lifecycle and failure behavior**

Add tests that `stop()` cancels a pending timer, shrinking text stays ignored, equal-text runtime revisions remain accepted, and one failed card request emits at most one bounded fallback even when later updates arrive.

- [ ] **Step 4: Run the focused test and observe RED**

Run:

```bash
pnpm exec vitest run packages/extensions/lark/tests/cards.host.spec.ts
```

Expected: the new coalescing/final-priority tests fail because the current promise tail performs one write per update and exposes no `stop()` method.

### Task 3: Implement the latest-state scheduler

**Files:**
- Modify: `packages/extensions/lark/src/cards.ts`
- Modify: `packages/extensions/lark/src/index.ts`
- Modify: `packages/extensions/lark/src/config.ts`

- [ ] **Step 1: Replace the promise tail with explicit owned state**

`TurnCardStream` must hold these fields and no queue of projection revisions:

```ts
interface TurnProjectionState {}

class TurnCardStreamState {
  private current!: TurnProjectionState
  private lastFlush = 0
  private failed = false
  private stopped = false
  private dirty = false
  private finalRequested = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private inFlight: Promise<void> | undefined
  private finalPromise: Promise<void> | undefined
  private resolveFinal: (() => void) | undefined
}
```

Extend resolved options with injectable timer functions while retaining the injectable clock:

```ts
interface StreamingCardTimerOptions {
  setTimer?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void
}
```

- [ ] **Step 2: Make non-final updates coalesce**

`update(next, false)` validates the monotonic prefix, clones `next` into `current`, marks `dirty`, calls a non-blocking `pump()`, and returns `Promise.resolve()`. `pump()` starts no work when stopped, failed, already in flight, or already timed; otherwise it writes now when the throttle window is open or arms one timer for the remaining interval.

- [ ] **Step 3: Make final updates drain immediately**

`update(next, true)` marks `finalRequested`, cancels the timer, creates one final promise, and calls `pump()`. `pump()` bypasses throttling for final state. Its completion callback performs an immediate second write when state changed during the one in-flight request, then resolves the final promise only after no dirty state remains.

- [ ] **Step 4: Contain failure and own shutdown**

On the first `updateCard` rejection, set `failed`, cancel the timer, and attempt one bounded `sendText` from the latest state. Swallow only that bounded fallback failure so it cannot terminate the shared mux. Implement:

```ts
class StoppableTurnCardStream {
  private stopped = false
  private dirty = false

  stop(): void {
    this.stopped = true
    this.dirty = false
    this.cancelTimer()
    this.settleFinal()
  }

  private cancelTimer(): void {}
  private settleFinal(): void {}
}
```

In `mux.stop`, call `active.stream.stop()` for every active turn before `activeTurns.clear()`.

- [ ] **Step 5: Run focused tests and observe GREEN**

Run:

```bash
pnpm exec vitest run packages/extensions/lark/tests/cards.host.spec.ts
```

Expected: all card tests pass with no unhandled rejection; burst updates produce bounded writes and the final card is the latest state.

### Task 4: Tighten plugin isolation and document the shipped decision

**Files:**
- Modify: `packages/extensions/session-messenger/src/target-resolver.ts`
- Modify: `packages/extensions/session-messenger/tests/target-resolver.client.spec.ts`
- Modify: `packages/extensions/lark/README.md`
- Modify: `packages/extensions/lark/README.zh.md`
- Modify: `packages/extensions/lark/README.i18n.yaml`
- Modify: `packages/extensions/lark/LICENSE`
- Modify: `PROJECT_CONTEXT.md`
- Create: `.agents/notes/implemented/bug-fix/2026-08-26-lark-stream-coalescing.md`
- Create: `.agents/notes/implemented/bug-fix/2026-08-26-lark-stream-coalescing.zh.md`
- Create: `.agents/notes/implemented/bug-fix/2026-08-26-lark-stream-coalescing.i18n.yaml`

- [ ] **Step 1: Remove unused cross-package additions**

Delete only `assertOrdinarySession()`, `resolveOrdinarySession()`, their imports/tests, and restore `resolveOrdinaryTargetForSource()` to its merge-base implementation. Keep Lark's use of the existing public resolver and retain all package registration required by the installable Bundle.

- [ ] **Step 2: Update package behavior and attribution**

README text must state that intermediate projections coalesce within the configurable interval, terminal state bypasses a pending timer, and disabling cancels timers. Replace “serialized card-flush patterns” with “coalescing card-flush scheduler” in the bilingual README and third-party notice.

- [ ] **Step 3: Record the decision and project status**

The implemented Agent Note must include `Problem`, `Decision`, `Alternatives considered`, `Verification`, and `Consequences`, including the rate-limit trade-off and the negative guarantee that Harness core and Session persistence are unchanged. Update the Lark paragraph in `PROJECT_CONTEXT.md` to identify latest-state coalescing and final priority.

- [ ] **Step 4: Record bilingual pairs**

Run:

```bash
pnpm run verify-translation-pairing --write packages/extensions/lark/README.md
pnpm run verify-translation-pairing --write .agents/notes/implemented/bug-fix/2026-08-26-lark-stream-coalescing.md
pnpm run verify-translation-pairing --write docs/superpowers/plans/2026-08-26-dsh-lark-stream-coalescing.md
```

Expected: all three records are written and scoped pairing checks pass.

- [ ] **Step 5: Commit the source fix**

Run:

```bash
git add packages/extensions/lark packages/extensions/session-messenger/src/target-resolver.ts packages/extensions/session-messenger/tests/target-resolver.client.spec.ts docs/superpowers .agents/notes/implemented/bug-fix PROJECT_CONTEXT.md
git commit -m "fix(lark): coalesce streamed card updates"
```

Expected: one commit containing the scheduler, focused tests, isolation cleanup, and current documentation.

### Task 5: Verify, install, and push

**Files:**
- Create: `artifacts/deepseek-ai-dsh-lark-0.1.1-rc.2-coalesced-20260826.tgz`

- [ ] **Step 1: Run proportional source checks**

Run:

```bash
pnpm exec vitest run packages/extensions/lark/tests packages/extensions/session-messenger/tests/target-resolver.client.spec.ts
pnpm run typecheck
pnpm --filter @deepseek-ai/dsh-lark bundle
pnpm run doc-sync
git diff --check
```

Expected: all relevant tests, typecheck, package build, documentation gates, and whitespace checks pass.

- [ ] **Step 2: Pack a uniquely named artifact and verify its bytes**

Pack the package, rename the tarball with the short commit suffix, calculate SHA-256, inspect the archive entry list, and ensure no credential or live state file is present.

- [ ] **Step 3: Refresh only the removable live Profile bundle**

Preserve the existing `~/.dsh/profiles/web` credentials, pairing, binding, and queue state. Install the unique absolute tarball path with `dsh plugin --profile web add`, restart Harness, then verify enabled/connected/paired/bound status, queue depth, installed package version, and installed package hash without printing identifiers or secrets.

- [ ] **Step 4: Push Git**

Run:

```bash
git push origin codex/dsh-lark-desktop-compat
```

Expected: the remote branch advances to the verified commit without modifying another worktree or Desktop core bundle.
