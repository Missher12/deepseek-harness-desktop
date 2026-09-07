# Agent Note: Desktop alpha integration and responsive conversation width

Status: implemented

English | [中文](2026-09-07-desktop-local-alpha-integration.zh.md)

## Problem

Desktop additions consume Session persistence and attachment APIs that changed in Harness 0.1.3-alpha.1. An upgrade must retain document extraction, history redaction, archive deletion and accurate usage accounting. Older persisted subagent descriptor v2 records also need historical migration without gaining unsupported continuation semantics. Transcript width dragging remains an independent interaction after the right Workbench is removed.

## Decision

Desktop integrates the tagged alpha core while adapting consumers to explicit read and write handles. Read consumers always close handles. Session deletion acquires writer ownership and removes all generations together so a retained predecessor cannot resurrect a deleted conversation. The released-format validator admits only the known descriptor v2 composition and preserves its version; the subagent owner's current-version fence remains intact.

Usage schema 3 reads settled Assistant messages and compact attempt usage, preserving separately billed retries. Two concurrent reads fit the JSONL cold-read memo. Each row observes the post-open revision before reading and is invalidated by later durable or live changes. Upgrade validation uses isolated history copies and hashes retained predecessor files; native validation uses the packaged application.

Image, locally extracted document and generic-file paths share the attachment service without conflating their storage or admission contracts. Initial fixture history and live follow use the production renderer projection. The Add menu and paperclip share one file input so disabled intake cannot be bypassed through a duplicate control.

Conversation width follows the existing ResizeObserver and adaptive clamp. Manual drag targets, handlers and stored-width overrides are removed. This partially supersedes [adaptive content width](2026-08-18-conversation-adaptive-content-width.md): its shared width axis and fixed-position descendant rationale remain applicable. System Update distinguishes installed Desktop and Harness versions, unchecked state, prerelease status, progress and actionable failures.

## Alternatives considered

Relabeling historical descriptors as current would silently grant unverified resume semantics. Hiding width handles while retaining their hit zones would leave the reported interaction. Rebuilding every usage row on each opening would turn a one-time migration cost into recurring latency. These alternatives are rejected.

## Consequences

Core and Desktop versions remain distinct. Legacy source logs remain immutable during migration, and unsupported future or unknown event shapes still refuse conversion. Local compatibility does not establish Windows acceptance or authorize Git publication. A prerelease upgrade needs complete history and packaged-native evidence before local replacement; a source build alone is insufficient.
