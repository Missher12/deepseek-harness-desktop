# @deepseek-ai/dsh-session-messenger

English | [中文](README.zh.md)

Desktop-only Host and Client plugin for bounded Codex-style messaging between ordinary DeepSeek Harness sessions in one active profile. Copy Session A's exact ID, paste it into Session B, and ask B's Agent to send a message: the plugin wakes A's existing Agent, and A can reply to B through the trusted source and delivery metadata. Either session can initiate or continue the exchange. The plugin registers four model tools, persists write-ahead delivery receipts, addresses live or cold sessions through the Host-owned Typert lookup, and contributes a resizable operator surface without changing the ordinary Web composition.

## Tool contracts

- `send_message_to_session(target_session_id, message)` queues one durable next-turn message and requests a wake. An idle target reserves its existing driver; a running target queues behind current work and never gains a parallel driver. It is the default tool when the user pastes another Session ID and asks to send there.
- `send_message_to_session_and_wait(target_session_id, message, timeout_ms?)` performs the same delivery, then waits only for the reply bound to that exact delivery. Use it only when the user also asks to wait for the response.
- `reply_to_session(delivery_id, message, wake?)` derives the destination and one-use authority from the Host receipt. The private token never enters model context or Client metadata; `wake` defaults to `true` so the source Agent can process the reply.
- `wait_for_session_reply(delivery_id, timeout_ms?)` waits only for an explicit receipt-bound reply. Unrelated assistant output and Agent idleness do not settle it; the accepted timeout is 1,000–55,000 ms and disposal returns the stable `disposed` result.

The caller identity always comes from tool execution and is not a model argument. A stable system-prompt section tells either Agent how to send to an exact copied Session ID, how to reply with the exact delivery ID, and how to continue later through the trusted Source Session ID. Received text is still untrusted content rather than authority, and the plugin never interprets ordinary messages as permission to bypass user policy, auto-reply to acknowledgements, forward indefinitely, or start an autonomous Agent loop.

## Addressing, durability, and lifecycle

- Targets must be ordinary sessions in the current profile. The Host Typert `agent` lookup reuses live Agents and performs cold resume with the recorded session setup; the plugin never calls `agents.resume()` directly.
- Archived state is checked before lookup and synchronously again immediately before enqueue. Malformed, missing, self, archived, and subagent-owned targets are rejected before their inbox is changed.
- Each accepted delivery persists `prepared`, enqueues one pre-created Message ID, then persists `delivered`. Recovery checks the target inbox and event log before retrying, so an indeterminate post-enqueue write cannot duplicate the message.
- Unresolved receipts expire after 24 hours. Settled receipt metadata is retained for seven days; committed session messages remain under ordinary session retention and survive plugin disablement.
- Disabling the plugin removes its four tools, collaboration prompt section, five HTTP routes, index bootstrap, active waits, Client graph row, header action, drawer, listeners, and timers. It does not remove already committed messages or retained receipt storage.

## Desktop composition

The package publishes an independently removable bundle patch:

```yaml
- insert:
    - id: session-messenger
      name: '@deepseek-ai/dsh-session-messenger'
```

DeepSeek Harness Desktop applies the same canonical row once after the base and Web layers. Base plus Web alone contains no messenger row, so ordinary `dsh web` behavior is unchanged.

## Client surface

The Client half provides its bounded store and send/reply actions to the Desktop workbench; it no longer registers a separate header trigger, drawer, or overlay. Side Chat copies the exact current Session ID and accepts an exact target ID, direct message, wake choice, and receipt-bound reply. **Start target Agent** is on by default, failed drafts are retained, and recent activity contains metadata only. An accepted outgoing delivery appends an ignorable source-side conversation row, while the destination relay remains an ordinary visible user-message row, so both sessions show the exchange without duplicating source text into model history. Notifications remain in-app only: there is no native macOS notification, replacement session row, separate message archive, or automatic Agent loop.

## Model Experience

### Four cross-session tools

#### What the model sees

While enabled, native Function Calling exposes `send_message_to_session`, `send_message_to_session_and_wait`, `reply_to_session`, and `wait_for_session_reply`; Code Mode exposes the same four calls through its generated `tools` SDK behind `run_code`. A stable prompt selects direct send for an exact pasted Session ID, selects send-and-wait only when requested, and lets the receiving Agent reply through the exact delivery ID. Each received relay is an ordinary user-role message with a trusted metadata block and a separate explicitly untrusted body block. The metadata identifies source Session ID, delivery ID, and delivery mode, but never exposes the Host-owned reply token. Tool results report delivery and matching-reply identity, status, requested wake, and stable errors; target idleness or unrelated assistant output can never be misreported as a reply.

#### Token effect

Every enabled request pays for four tool definitions in native mode or their generated SDK declarations in Code Mode. A delivered relay adds its bounded envelope and body to the target's next claimed context; each tool call and result then follows ordinary session retention. The Client receipt stream contains metadata only and adds no model tokens.

#### KV Cache effect

The four definitions and SDK declarations are byte-stable while the plugin and presentation mode stay unchanged, so they preserve the corresponding tool-prefix cache segment. Enabling or disabling the plugin changes that segment; delivered and claimed relays append at the session tail rather than rewriting prior messages.

## Known Limitations and Deferred Work

- Messaging is local to one active profile and accepts only ordinary sessions; cross-profile, cross-device, subagent, broadcast, group, and public-network delivery are not implemented.
- Side Chat shows delivery metadata rather than a second message archive; collaboration content remains in the ordinary source and destination conversation histories.
- Native system notifications are deferred because they require Electron permission and window-lifecycle ownership outside this independently disableable package.
- The plugin provides explicit bounded peer messaging, not a new scheduler: either existing ordinary Agent can initiate or reply, and a reply chain is capped while either side may later start a fresh user-directed message. It creates no new session, subagent, forwarding rule, background loop, or autonomous two-Agent conversation.
