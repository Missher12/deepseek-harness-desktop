# Agent Note: Lark card action admission and unbound messages

Status: implemented

English | [中文](2026-08-26-lark-card-action-admission.zh.md)

## Problem

Feishu can return a card button's JSON object members in a different order from the object sent by the plugin. The Lark identity check compared serialized objects, so an exact Session-selection action could fail even though every key and value matched. Ordinary text sent before an active Session binding also raised an expected inbox error through the WebSocket callback, which left the owner without actionable guidance.

## Decision

- Card action data is compared as an exact set of string keys and values without depending on object member order. Owner, private chat, nonce, action, generation, expiry, and one-use checks remain mandatory.
- The durable inbox reports `accepted`, `duplicate`, or `unbound` from its serialized admission operation. The command router replies with current binding status only for `unbound`; accepted and duplicate events retain their existing delivery behavior.

## Alternatives considered

**Remove action-data comparison.** This lost because a valid nonce must not authorize altered workspace, Session, approval, or RPC identifiers.

**Sort and serialize both objects.** This lost because the admitted payload is a bounded flat string record; direct key and value comparison states the exact rule without adding a canonical serializer.

**Check binding state in the command router before enqueue.** This lost because the binding could change between that check and the inbox's serialized write-ahead operation. The inbox remains the authoritative admission point.

## Verification

Identity tests cover reordered exact data, altered values, nonce ownership, generation, expiry, and one-use behavior. Command and inbox tests cover an inactive binding without a durable write or Agent delivery and require the owner-facing status response.

## Consequences

Valid project and Session card clicks survive JSON member reordering while missing, extra, or altered action data remains rejected. Expected pre-binding text no longer turns into a failed Feishu callback. The private inbox interface carries a three-state result so the owner-facing router can distinguish an inactive binding from accepted or duplicate delivery.
