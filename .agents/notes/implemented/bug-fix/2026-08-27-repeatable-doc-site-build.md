# Agent Note: Repeatable documentation site builds

Status: implemented

English | [中文](2026-08-27-repeatable-doc-site-build.zh.md)

## Problem

The documentation build emits raw Markdown twins into `website/.dist` after VitePress renders the site. VitePress did not remove those post-build files before a later build, so the second invocation failed its collision guard when it encountered the previous `index.md`.

## Decision

Both documentation build entry points now run a repository-owned preparation script before VitePress. The script resolves the repository and `website` directories, refuses a linked `website` or `.dist`, and removes only the fixed disposable `website/.dist` target. The existing raw-Markdown collision checks remain strict, so a file copied by the current VitePress build still cannot be overwritten.

## Alternatives considered

**Allow raw Markdown to overwrite any existing output.** Rejected because it would hide collisions with files copied from `website/public` during the current build.

**Run the repository-wide clean command.** Rejected because it removes unrelated package build output and makes a documentation build slower and broader than necessary.

## Consequences

Repeated local and CI builds start from the same output state without weakening source or public-file collision protection. The application runtime and packaged Desktop contents are unchanged.

## Testing

Focused tests cover exact-target cleanup, sibling preservation, and linked-directory refusal. The MPA build then ran twice consecutively; both runs resolved 2402 internal fragments and emitted 181 raw-Markdown files plus `llms.txt`.
