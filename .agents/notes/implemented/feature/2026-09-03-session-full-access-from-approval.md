# Agent Note: Session Full Access from an Approval

Status: implemented

English | [中文](2026-09-03-session-full-access-from-approval.zh.md)

## Problem

An approval takeover previously offered only Reject and Allow once. Repetitive approvals made a trusted task cumbersome, but adding a new durable approval outcome or remembering tool names would broaden authority without an exact parameter scope.

## Decision

The approval card adds **Don't ask again this session**. It does not mint a new approval outcome. After the user opens and acknowledges the same Full access risk confirmation used by the Access selector, the client executes the existing `/permission danger-full-access` command against the exact Session that owns the pending approval. Only a successful, matched command permits the card to answer that current approval as `allowed-once`.

The `conversation.composer` registration injects one narrow `runSessionCommand(line)` callback. InputBar and the approval entry resolve commands through the same apply-owned helper; neither receives the Session object or a global permission service. Permission truth remains the existing Session event projection. A different Session is unchanged, and selecting Workspace Write later restores its ordinary approval policy.

While the permission command or approval response is pending, all three card actions are disabled. A failed or unmatched permission command sends no approval response and re-enables the card with fixed retry copy. If permission changed successfully but the current response failed, retry sends only `allowed-once`; it does not repeat or roll back Full access. Raw transport errors are not rendered.

## Rejected alternatives

- Add a session-wide or permanent `ApprovalOutcome`: rejected because the existing outcome cannot describe a safe durable tool-parameter scope.
- Store a browser-side grant: rejected because local storage is presentation state, not Session permission authority.
- Answer before running `/permission`: rejected because the current high-risk action could execute while the requested Session policy change had failed.

## Verification

Component tests cover Reject, Allow once, risk acknowledgement, command-before-answer ordering, pending-operation disablement and duplicate suppression, unmatched and rejected commands, fixed error copy, and response-only retry after Full access. Apply tests pin the narrow shared command face. Permission projection tests pin exact Session isolation and switching back to Workspace Write. The core `ApprovalOutcome` union remains unchanged.

## Consequences

This option reduces repeated tool approvals only for the current Session by selecting its existing Full access preset. It does not affect OS prompts, site policies, another Session, or any future independently gated high-risk domain.
