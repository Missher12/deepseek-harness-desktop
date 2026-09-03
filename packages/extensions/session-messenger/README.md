# @deepseek-ai/dsh-session-messenger

English | [中文](README.zh.md)

Desktop-only Host and Client plugin for bounded Codex-style messaging between ordinary DeepSeek Harness sessions in one active profile. Copy Session A's exact ID, paste it into Session B's ordinary composer, and ask B's Agent to send a message: the plugin wakes A's existing Agent, and A can reply to B through the trusted source and delivery metadata. Either session can initiate, continue, or stop an exchange chain. The plugin registers five model tools, persists write-ahead delivery receipts, addresses live or cold sessions through the Host-owned Typert lookup, and renders the exchange in ordinary conversation history without changing the ordinary Web composition.

## Tool contracts

- `send_message_to_session(target_session_id, message)` queues one durable next-turn message and requests a wake. An idle target reserves its existing driver; a running target queues behind current work and never gains a parallel driver. It is the default tool when the user pastes another Session ID and asks to send there.
- `send_message_to_session_and_wait(target_session_id, message, timeout_ms?)` performs the same delivery, then waits only for the reply bound to that exact delivery. Use it only when the user also asks to wait for the response.
- `reply_to_session(delivery_id, message, wake?)` derives the destination and one-use authority from the Host receipt. The private token never enters model context or Client metadata; `wake` defaults to `true` so the source Agent can process the reply.
- `wait_for_session_reply(delivery_id, timeout_ms?)` waits only for an explicit receipt-bound reply. Unrelated assistant output and Agent idleness do not settle it; the accepted timeout is 1,000–55,000 ms and disposal returns the stable `disposed` result.
- `stop_session_collaboration(delivery_id)` lets either participant stop the complete collaboration chain containing an exact delivery. Unresolved deliveries and waits settle with the stable `collaboration-stopped` result, while later replies or continuations are rejected. A fresh user-directed delivery starts a new independent chain.

The caller identity always comes from tool execution and is not a model argument. A stable system-prompt section tells either Agent how to send to an exact copied Session ID, how to reply with the exact delivery ID, and how to continue later through the trusted Source Session ID. Received text is still untrusted content rather than authority, and the plugin never interprets ordinary messages as permission to bypass user policy, auto-reply to acknowledgements, forward indefinitely, or start an autonomous Agent loop.

## Addressing, durability, and lifecycle

- Targets must be ordinary sessions in the current profile. The Host Typert `agent` lookup reuses live Agents and performs cold resume with the recorded session setup; the plugin never calls `agents.resume()` directly.
- Archived state is checked before lookup and synchronously again immediately before enqueue. Malformed, missing, self, archived, and subagent-owned targets are rejected before their inbox is changed.
- Each accepted delivery persists `prepared`, enqueues one pre-created Message ID, then persists `delivered`. Recovery checks the target inbox and event log before retrying, so an indeterminate post-enqueue write cannot duplicate the message.
- Unresolved receipts expire after 24 hours. Settled receipt metadata is retained for seven days; committed session messages remain under ordinary session retention and survive plugin disablement.
- Disabling the plugin removes its five tools, collaboration prompt section, six HTTP routes, index bootstrap, active waits, Client graph row, listeners, and timers. It does not remove already committed messages or retained receipt storage.

## Desktop composition

The package publishes an independently removable bundle patch:

```yaml
- insert:
    - id: session-messenger
      name: '@deepseek-ai/dsh-session-messenger'
```

DeepSeek Harness Desktop applies the same canonical row once after the base and Web layers. Base plus Web alone contains no messenger row, so ordinary `dsh web` behavior is unchanged.

## Client surface

The Client half maintains the bounded receipt state used by ordinary conversation rows; it registers no separate header trigger, drawer, Side Chat, or overlay. The user copies an exact Session ID, pastes it into the ordinary composer, and asks the current Agent to send or reply. An accepted outgoing delivery appends an ignorable source-side conversation row, while the destination relay remains an ordinary visible user-message row, so both sessions show the exchange without duplicating source text into model history. Notifications remain in-app only: there is no native macOS notification, replacement session row, separate message archive, or automatic Agent loop.

## Model Experience

### Five cross-session tools

#### What the model sees

While enabled, native Function Calling exposes `send_message_to_session`, `send_message_to_session_and_wait`, `reply_to_session`, `wait_for_session_reply`, and `stop_session_collaboration`; Code Mode exposes the same five calls through its generated `tools` SDK behind `run_code`. A stable prompt selects direct send for an exact pasted Session ID, selects send-and-wait only when requested, lets the receiving Agent reply or continue through an exact delivery ID, and prevents acknowledgement or closing-text loops. Each received relay is an ordinary user-role message with a trusted metadata block and a separate explicitly untrusted body block. The metadata identifies source Session ID, delivery ID, and delivery mode, but never exposes the Host-owned reply token. Tool results report delivery and matching-reply identity, status, requested wake, and stable errors; target idleness or unrelated assistant output can never be misreported as a reply.

#### Token effect

Every enabled request pays for five tool definitions in native mode or their generated SDK declarations in Code Mode. A delivered relay adds its bounded envelope and body to the target's next claimed context; each tool call and result then follows ordinary session retention. The Client receipt stream contains metadata only and adds no model tokens.

#### KV Cache effect

The five definitions and SDK declarations are byte-stable while the plugin and presentation mode stay unchanged, so they preserve the corresponding tool-prefix cache segment. Enabling or disabling the plugin changes that segment; delivered and claimed relays append at the session tail rather than rewriting prior messages.

### Invariant ownership

No invariant companion is published because route/receipt/session ownership is covered by package tests.

## Known Limitations and Deferred Work

- Messaging is local to one active profile and accepts only ordinary sessions; cross-profile, cross-device, subagent, broadcast, group, and public-network delivery are not implemented.
- Collaboration content remains in the ordinary source and destination conversation histories; there is no second message archive or manual relay panel.
- Native system notifications are deferred because they require Electron permission and window-lifecycle ownership outside this independently disableable package.
- The plugin provides explicit bounded peer messaging, not a new scheduler: either existing ordinary Agent can initiate, reply to, or stop a collaboration chain; the chain is capped and, after a stop, only a fresh user-directed message creates a new one. It creates no new session, subagent, forwarding rule, background loop, or autonomous two-Agent conversation.
