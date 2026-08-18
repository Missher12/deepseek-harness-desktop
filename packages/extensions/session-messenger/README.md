# @deepseek-ai/dsh-session-messenger

English | [中文](README.zh.md)

Desktop-only Host and Client plugin for bounded communication between ordinary DeepSeek Harness sessions in one active profile. It registers four model tools, persists write-ahead delivery receipts, addresses live or cold sessions through the Host-owned Typert lookup, renders received relays as visible conversation cards, and contributes a resizable in-app composer without changing the ordinary Web composition.

## Tool contracts

- `send_message_to_session(target_session_id, message)` injects a durable next-step message and never wakes the target. A cold target may be resumed into an addressable in-memory Agent, but this path makes no model request and starts no driver.
- `followup_session(target_session_id, message)` queues an ordinary next-turn follow-up and requests a wake. An idle target reserves its existing driver; a running target queues behind current work and never gains a parallel driver.
- `reply_to_session(delivery_id, message, wake?)` derives the destination and one-use authority from the Host receipt. The private token never enters model context or Client metadata; `wake` defaults to `false`.
- `wait_for_session_reply(delivery_id, timeout_ms?)` waits only for an explicit receipt-bound reply. Unrelated assistant output and Agent idleness do not settle it; the accepted timeout is 1,000–55,000 ms and disposal returns the stable `disposed` result.

The caller identity always comes from tool execution and is not a model argument. Received text is untrusted content rather than authority, and the plugin never interprets ordinary messages as instructions to reply, forward, or start an automatic Agent loop.

## Addressing, durability, and lifecycle

- Targets must be ordinary sessions in the current profile. The Host Typert `agent` lookup reuses live Agents and performs cold resume with the recorded session setup; the plugin never calls `agents.resume()` directly.
- Archived state is checked before lookup and synchronously again immediately before enqueue. Malformed, missing, self, archived, and subagent-owned targets are rejected before their inbox is changed.
- Each accepted delivery persists `prepared`, enqueues one pre-created Message ID, then persists `delivered`. Recovery checks the target inbox and event log before retrying, so an indeterminate post-enqueue write cannot duplicate the message.
- Unresolved receipts expire after 24 hours. Settled receipt metadata is retained for seven days; committed session messages remain under ordinary session retention and survive plugin disablement.
- Disabling the plugin removes its four tools, five HTTP routes, index bootstrap, active waits, Client graph row, header action, drawer, listeners, and timers. It does not remove already committed messages or retained receipt storage.

## Desktop composition

The package publishes an independently removable bundle patch:

```yaml
- insert:
    - id: session-messenger
      name: '@deepseek-ai/dsh-session-messenger'
```

DeepSeek Harness Desktop applies the same canonical row once after the base and Web layers. Base plus Web alone contains no messenger row, so ordinary `dsh web` behavior is unchanged.

## Client surface

The Client half registers one `conversation.session.header.utilities` trigger and one `shell.overlay` drawer. The trigger shows unread state without changing header geometry. The 320–560 px drawer remembers its width, becomes full-width on narrow screens, copies the exact current Session ID, composes send or receipt-bound reply requests, keeps failed drafts, and shows metadata-only recent activity. Incoming plugin-sourced relays render as conversation cards with source Session ID, delivery ID, body, copy, and reply actions; older or foreign context injection keeps the ordinary fallback renderer. Notifications are in-app only: there is no native macOS/Windows notification, replacement session row, separate message-body inbox, or automatic Agent loop.

## Model Experience

### Four cross-session tools

#### What the model sees

While enabled, native Function Calling exposes `send_message_to_session`, `followup_session`, `reply_to_session`, and `wait_for_session_reply`; Code Mode exposes the same four calls through its generated `tools` SDK behind `run_code`. Each received relay is an ordinary user-role message with a trusted metadata block and a separate explicitly untrusted body block. The metadata identifies source Session ID, delivery ID, and delivery mode, but never exposes the Host-owned reply token. Tool results report delivery identity, status, requested wake, and stable errors, but never claim that a target read or answered a message.

#### Token effect

Every enabled request pays for four tool definitions in native mode or their generated SDK declarations in Code Mode. A delivered relay adds its bounded envelope and body to the target's next claimed context; each tool call and result then follows ordinary session retention. The Client receipt stream contains metadata only and adds no model tokens.

#### KV Cache effect

The four definitions and SDK declarations are byte-stable while the plugin and presentation mode stay unchanged, so they preserve the corresponding tool-prefix cache segment. Enabling or disabling the plugin changes that segment; delivered and claimed relays append at the session tail rather than rewriting prior messages.

## Known Limitations and Deferred Work

- Messaging is local to one active profile and accepts only ordinary sessions; cross-profile, cross-device, subagent, broadcast, group, and public-network delivery are not implemented.
- The drawer shows delivery metadata rather than a second message archive; message content remains in the destination conversation where it is rendered as a relay card.
- Native system notifications are deferred because they require Electron permission and window-lifecycle ownership outside this independently disableable package.
- The plugin provides explicit tools, not autonomous coordination: no automatic reply, forwarding rule, background Agent loop, or unbounded two-Agent conversation is created.
