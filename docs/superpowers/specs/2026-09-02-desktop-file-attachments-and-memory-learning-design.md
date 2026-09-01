# Desktop File Attachments and Memory & Learning Design

English | [中文](2026-09-02-desktop-file-attachments-and-memory-learning-design.zh.md)

## Goal

DeepSeek Harness Desktop accepts files dragged or selected in the composer, presents local memory in language users can understand, excludes the unfinished Browser/Computer Control product from the release, and ships the same source behavior on Intel macOS and Windows x64.

## Product scope

The release adds document attachments for PDF, DOCX, XLSX, UTF-8 text, Markdown, JSON, CSV, YAML, XML, and common source-code files. Existing PNG, JPEG, WebP, and GIF handling stays unchanged. Directories, executables, archives, legacy DOC/XLS containers, password-protected documents, macro payloads, and unknown binary formats are rejected with localized errors.

The Browser/Computer Control implementation is not part of `origin/main` and remains outside this branch. Product and package tests reject Agent Control, external Chromium-control extension, Computer Control settings, and native input-helper artifacts if they enter Desktop staging. The ordinary Workbench browser remains because it is a user-facing workspace feature, not browser automation.

The user-facing `External Brain` settings section becomes `Memory & Learning` (`记忆与学习`). Package names, provider interfaces, local databases, the single injection listener, and model-facing safety instructions remain unchanged. The page explains the two capabilities that exist: reviewed project memory and validated workflow learning. Compatibility-reader detail moves to supporting copy instead of appearing as a third user feature.

## Attachment architecture

### Durable content

The attachment Service Definition adds a document reference beside the existing image reference. A document reference contains only an opaque content-addressed id, a verified closed media type, bounded byte counts, a sanitized display name, and extraction facts. It never contains an absolute path, browser object URL, credential, or provider file id.

The local provider stores immutable source bytes and deterministic extracted UTF-8 text below `DSH_HOME`. Admission verifies the complete input before publishing a reference. Content-addressed writes may leave unreachable bytes after cancellation, matching the existing image-store contract; no late message is appended.

The durable session message contains a `document` content block holding the reference. Request projection reads and verifies the stored extraction, then converts the block to a deterministic tagged text section. All model-visible text is therefore reconstructable from the session log plus immutable attachment storage. Provider adapters do not receive a filesystem path and do not expose a raw file-send command.

### Extraction and limits

Admission accepts at most five documents and 50 MiB of source bytes per message, with a 20 MiB limit per document. Extracted text is bounded to 96 KiB per document and 256 KiB per message. Truncation is explicit in both the reference and model-facing text.

Plain-text formats require valid UTF-8 and reject NUL-heavy or binary content. PDF input requires the PDF signature and uses PDF.js without executing embedded actions. DOCX and XLSX input requires a valid OOXML ZIP container, a bounded entry roster, and the expected content-type and document parts; macros and external relationships are ignored, formulas are never evaluated, and only stored display text is extracted. ZIP entry count, expanded bytes, path depth, and per-entry bytes are bounded before text construction.

The browser sends canonical base64 bytes only after an explicit drop or picker action. Host admission revalidates every declared field and decoded byte count. Filenames are normalized to a basename, control characters are removed, and display-name bytes are bounded. Dragging never grants future filesystem access.

### Composer and history

The draft attachment model becomes an ordered image-or-document union. Images keep thumbnails and lightbox preview. Documents render a compact file chip with name, format, size, removal action, and keyboard focus. The drop overlay and picker advertise the supported closed set. A mixed batch preserves user order and fails atomically when any member is invalid.

Submitted document blocks render as file chips in conversation history. The source bytes are available only through the authenticated session attachment lookup; the renderer receives bounded metadata unless the user explicitly downloads or previews a supported attachment in a future feature.

## Memory & Learning experience

The settings navigation and page title use `Memory & Learning` / `记忆与学习`. The introduction states that DSH can recall reviewed project facts and reuse validated working methods locally. Two rows show `Project memory` and `Learned workflows` with their real ready, disabled, or unavailable state and bounded counts. A concise `How it works` block explains first-step recall, project isolation, the six-item/4 KB/150 ms limits, and fail-open behavior.

The page does not claim that all conversations are remembered, that the model trains itself, or that data synchronizes across devices. It does not expose provider ids, database paths, raw errors, or compatibility-store internals. The existing pathless Host snapshot stays authoritative.

## Cross-platform behavior

Renderer, wire, storage, extraction, and model projection code is platform-neutral. It consumes browser-supplied bytes rather than reopening a platform path. Tests exercise Windows-style filenames and separators without accepting paths. Desktop staging includes the same packages and extraction assets for macOS and Windows.

Intel macOS must pass focused source tests, production builds, Desktop staging, and isolated packaged smoke. Windows source correctness is checked locally through TypeScript and static Setup gates; native Setup, launch, drag/drop, cleanup, and data-preservation evidence must come from the same commit on a Windows x64 runner. A macOS artifact never substitutes for Windows evidence.

## Failure behavior

Unsupported, malformed, oversized, encrypted, or extraction-failing documents remain in the local draft and show a localized error; no partial message is queued. Missing or corrupt durable bytes fail the model request with a bounded attachment error rather than silently omitting content. A model route receives extracted text, so document input does not depend on image capability declarations.

Memory status failures keep the existing fail-open behavior and render `Unavailable`; they never block a message. Product-absence tests fail staging if Browser/Computer Control files reappear.

## Alternatives considered

**Convert a dropped file to `@file`.** Rejected because `@file` names a workspace reference and cannot represent an external file chosen from Finder or Explorer. It would also make the visible file chip promise content that the model might never receive.

**Send provider-specific raw file ids.** Rejected because provider support differs and provider ids are not durable product data. It would create inconsistent replay and give adapters more authority than the current provider-neutral message model.

**Inline extracted text directly into the draft.** Rejected because it destroys attachment identity, overwhelms the editor, loses provenance, and prevents deterministic history rendering.

**Remove the Workbench browser with the control feature.** Rejected because the Workbench browser is an ordinary Desktop workspace tool and does not expose the unfinished Browser/Computer Control authority.

**Rename the internal Brain Hub and storage packages.** Rejected because the confusion is user-facing terminology, while the existing package and provider contracts already enforce the intended local safety model.

## Acceptance

- Mixed image/document drop and picker flows work on macOS and Windows from one source implementation.
- PDF, DOCX, XLSX, and text/code fixtures produce bounded deterministic model text and durable history chips.
- Malformed, oversized, encrypted, executable, archive, legacy Office, and unknown binary inputs produce zero persisted references and zero submitted messages.
- Absolute paths, source bytes, credentials, provider file ids, and raw extraction errors do not enter session JSON, UI snapshots, logs, or model metadata.
- The assembled Desktop exposes `Memory & Learning` / `记忆与学习` and no user-facing `External Brain` label.
- Desktop manifests, staging, tool catalogs, settings navigation, and packaged smoke contain no Browser/Computer Control product entry or runtime artifact.
- macOS packaged evidence and Windows native evidence identify the same final Git commit before release publication.
