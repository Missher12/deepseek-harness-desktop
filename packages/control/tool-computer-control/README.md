# @deepseek-ai/dsh-tool-computer-control

English | [中文](README.zh.md)

This optional Consumer exposes Desktop-owned native Computer Use through exactly twelve closed tools: status, list, snapshot, focus, click, double-click, drag, type, key, scroll, wait, and Stop. It registers no model tools unless `ctx.computerControl` exists, so ordinary CLI and Web behavior remains unchanged.

## Contract

The model never supplies a session, lease, approval, request ID, deadline, process handle, or generic native command. The Consumer derives the official session, acquires one provider-authored lease for the exact app/window pairs returned by `computer_list`, and carries forward only provider-authored snapshot revisions. Stop accepts no arguments, acquires no lease, and is approval-free.

Semantic refs are preferred. Screenshot coordinates are accepted only on the exact active route that supports image input. `computer_snapshot` commits a validated PNG through `AttachmentStore`; raw PNG bytes never enter text results, logs, telemetry, memory, or MSE inputs. Protected password, OTP, payment, file, installation, deletion, permission, and OS-security targets remain provider-denied.

## Model Experience

With a provider, the model sees a stable twelve-tool roster and uses `computer_list` followed by `computer_snapshot` before acting. Without a provider it sees no Computer Use schema or prompt text. Typed content is omitted from pending presentation.

## Known limitations

- Accessibility semantics cannot prove every external effect; native policy and visible user control remain authoritative.
- Coordinate click, double-click, drag, and scroll require a vision-capable route and remain window-relative.
- This package does not own native permission prompts, helper lifecycle, leases, approval, allowlists, the visible status capsule, or emergency Stop UI.
