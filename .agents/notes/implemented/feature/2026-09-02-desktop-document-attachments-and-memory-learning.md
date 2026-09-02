# Agent Note: Desktop document attachments and Memory & Learning

Status: implemented

English | [中文](2026-09-02-desktop-document-attachments-and-memory-learning.zh.md)

## Problem

Desktop accepted browser-owned images but treated ordinary files as workspace references rather than message attachments. Users could not drag a report or source file into the composer and have its contents travel with the message. The Settings label “External Brain” also described an implementation concept instead of the two user-facing capabilities it actually provides. An unfinished Browser/Computer Control product existed only in separate development work and must not enter this release.

## Decision

The attachment contract now has a durable document block beside the existing image block. The browser composer classifies one closed shared filename roster, keeps image and document drafts in one ordered list, and validates image and document limits independently before submission. Images retain object-URL previews. Documents use non-interactive file cards and never create browser object URLs. After admission, historical user messages render the same ordered attachment group without exposing content-address identifiers as generic JSON.

The renderer preflights one 296MiB canonical-base64 carrier budget across images and documents before reading file bytes, serializes those reads, and leaves 4MiB for the closed HTTP JSON envelope. The Host independently repeats the combined check before decoding and asks the local attachment service to validate the complete document batch before publication. Original bytes and extracted UTF-8 text are stored in separate owner-private content-addressed trees. References contain SHA-256 identifiers, verified media facts, a sanitized leaf name, byte counts, and explicit truncation state; they never contain a local path.

Local extraction accepts PDF, DOCX, XLSX, UTF-8 text, Markdown, JSON, CSV, YAML, XML, and the shared closed roster of common source-code filenames. PDF extraction runs in a separately bundled Worker with a 30-second wall deadline and 128MiB V8 old-generation limit; pages, text-item work, per-item characters, and output bytes are also bounded. OOXML extraction bounds entry count, entry size, expanded bytes, and path depth; it rejects traversal, encryption, and macros, ignores external relationships, and never evaluates spreadsheet formulas. Every read verifies both immutable digests. Model adapters replace document blocks with one deterministic tagged text projection before their existing image conversion. Projection favors the newest messages, retains attachment order within a message, and replaces any document that cannot fit the exact resolved route context and output reserve with a deterministic metadata-only placeholder.

Durable content-address ids remain in the Host session log, but they are not renderer currency. History, live session events, queue frames, presenter views, and known extension carriers all cross the Host boundary through a bounded renderer document DTO. Its display id is process-random and opaque; attachment ids, extracted-text ids, source digests, and text digests never enter the renderer payload or DOM.

The user-facing Settings section is now **Memory & Learning** / **记忆与学习**. It shows reviewed project memory and learned workflows as the two real capabilities, while legacy-memory compatibility remains supporting copy. Brain Hub interfaces, provider order, local databases, recall limits, one injection path, and fail-open behavior are unchanged.

Desktop staging owns an exact forbidden-artifact roster for the unfinished Browser/Computer Control product. The ordinary Workbench browser remains because it is a workspace surface, not browser automation.

## Alternatives considered

**Send absolute file paths to the model.** Rejected because paths are host-private, do not survive replay or fork, and would give providers ambient filesystem knowledge.

**Let every model adapter parse files.** Rejected because format handling, limits, and security behavior would drift by provider and repeat work on every request.

**Accept arbitrary archives, legacy Office files, or executable formats.** Rejected because this release has no bounded non-executing extractor for them.

**Remove the ordinary Workbench browser with Browser Control.** Rejected because Workbench is an independent user workspace feature and carries none of the removed control authority.

## Consequences

Users can drag or choose supported documents together with images and text, see them before and after sending, and obtain deterministic model-visible text after restart or fork. Extraction is local and bounded, but source and extracted objects are retained until reference-aware garbage collection is implemented. Password-protected Office files, macro-enabled containers, legacy `.doc`/`.xls`, arbitrary archives, and unknown file types remain rejected. macOS and Windows packages must be built from the same public commit; offline and macOS evidence do not substitute for native Windows acceptance.

## Testing

Contract, prompt-wire, local extraction, immutable storage, model projection, composer, history rendering, localization, Memory & Learning, Desktop manifest, and staging tests cover the new path. The local attachment package enforces complete statement, branch, function, and line coverage over its source. Packaged acceptance separately verifies the final macOS application and the same-commit Windows workflow.
