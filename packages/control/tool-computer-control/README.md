# @deepseek-ai/dsh-tool-computer-control

English | [中文](README.zh.md)

This optional Consumer exposes Desktop-owned native Computer Use through exactly twelve closed tools: status, list, snapshot, focus, click, double-click, drag, type, key, scroll, wait, and Stop. It registers no model tools unless `ctx.computerControl` exists, so ordinary CLI and Web behavior remains unchanged.

## Contract

The model never supplies a session, lease, approval, request ID, deadline, process handle, or generic native command. The Consumer derives the official session, acquires one provider-authored lease for the exact app/window pairs returned by `computer_list`, and carries forward only provider-authored snapshot revisions. Stop accepts no arguments, acquires no lease, and is approval-free.

Semantic refs are preferred. Screenshot coordinates are accepted only on the exact active route that supports image input. `computer_snapshot` commits a validated PNG through `AttachmentStore`; raw PNG bytes never enter text results, logs, telemetry, memory, or MSE inputs. Protected password, OTP, payment, file, installation, deletion, permission, and OS-security targets remain provider-denied.

## Model Experience

### Tool schemas

#### What the model sees

With a provider, the model sees the twelve closed [Computer Control tool schemas](../../../docs/tool-catalog.md#deepseek-aidsh-tool-computer-control) and uses `computer_list` followed by `computer_snapshot` before acting. Without a provider it sees no Computer Use schema or prompt text. Typed content is omitted from pending presentation.

#### Token effect

The fixed schemas add a bounded input cost whenever the Desktop provider is mounted. List and snapshot contents are per-call results rather than standing prompt text.

#### KV Cache effect

The roster is prefix-stable while `ComputerControl` availability and the closed schemas remain unchanged. Mounting or removing the provider changes tool visibility and may invalidate reuse from that point.

## Known Limitations and Deferred Work

- Accessibility semantics cannot prove every external effect; native policy and visible user control remain authoritative.
- Coordinate click, double-click, drag, and scroll require a vision-capable route and remain window-relative.
- This package does not own native permission prompts, helper lifecycle, leases, approval, allowlists, the visible status capsule, or emergency Stop UI.
