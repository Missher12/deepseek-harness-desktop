# Agent Note: Reproducible official inputs for the Desktop base

Status: implemented

English | [中文](2026-09-13-reproducible-desktop-base-inputs.zh.md)

## Problem

A Desktop package needs independently established official source bytes, a runtime installed for its native host, and separately owned shell additions. A Harness version string cannot distinguish an official build from a modified checkout. An input directory assembled by local one-off commands also leaves later maintainers without a reproducible preparation entry or a safe rule for reusing accepted runtime bytes.

## Decision

Desktop 0.6.0 uses [`prepare-desktop-base.ts`](../../../../scripts/prepare-desktop-base.ts) as the root `desktop:stage` entry. The default preparation path produces the official base composition. This preparation decision supersedes the optional-build position in the [initial base decision](2026-09-13-opt-in-official-desktop-base.md); it does not reinterpret an installed descriptor-less full application or migrate existing profiles. Full source remains available through the explicit `desktop:full:stage:built` historical entry.

The [input verifier](../../../../scripts/desktop-official-inputs.ts) requires the clean official commit `fb2c4b9e698e30edb738bca4cf0618587db7d203`, Harness `0.1.5-rc.2`, and the trusted SHA-256 of a descriptor naming exactly 275 tarballs. Each archive must match its recorded hash, size and actual package manifest; duplicate identities, archive links and escaping paths fail validation. Plain and verbose tar listings accept LF or CRLF line endings and remove only the final line terminator; member whitespace and escaped control characters are preserved for the existing path and type checks. Historical absolute package locations do not establish the current package directory. Same-version fork packages cannot replace the recorded bytes.

The runtime preserves the official dependency-build policy and uses local-file overrides for the verified package set. Production reachability through actual package manifests and the official lockfile proves that the removed `@yao-pkg/pkg@6.21.0` patch is development-only; the `node-pty` patch remains. `strictDepBuilds`, a hoisted installation and disabled peer auto-installation remain explicit. The existing subprocess-local postinstall receives only its exact reviewed tarball identities, without a general build-script allowance.

## Source identity and native installation identity

Source and input identities are portable evidence; installed native bytes are host-specific evidence. A new runtime uses an exclusively created directory and the exact `pnpm@11.7.0` JavaScript executor under the current Node process without a shell. Both the official build and runtime preparation resolve the public `bin.pnpm` JavaScript entry from that package's manifest; an internal executable does not replace the declared entry. Fresh dependency installation retains `install --prod --no-frozen-lockfile` and passes its empty local npmrc through `--config.npmrc-auth-file=<path>`; the single configuration argument keeps the path out of positional package names and excludes the user npmrc. Package name/version, a contained regular entry file and matching realpath remain required, and installation records the CLI file hash after checking its actual `--version` output. Its installation receipt records the official source, input descriptor digest, platform, architecture, Node and pnpm identities. The [runtime inventory](../../../../scripts/desktop-base-runtime.ts) separately fingerprints physical files and contained symlinks. Existing outputs require matching receipts and a complete inventory check; failures do not trigger automatic deletion or reinstallation.

An accepted S2 runtime without the newer installation receipt uses [read-only audit import](../../../../scripts/import-desktop-official-runtime.ts). The build owner supplies a trusted external audit digest that binds the verified package descriptor, runtime inventory, current native platform and hashed native evidence. Import does not write an internal receipt or alter the immutable runtime. An audit from another operating system or architecture cannot authorize reuse on the current host.

Package enumeration accepts regular `.tgz` files and excludes only the pinned official packer’s regular `publish-order.txt` sidecar in the `dsh` and `vendor` families. Unknown output names, non-file objects and a sidecar in the `native` family fail preparation; every tarball still undergoes inspection and the complete 275-package validation. The [Windows workflow](../../../../.github/workflows/windows-desktop.yml) initializes temporary stage and build paths from `RUNNER_TEMP` in a post-checkout PowerShell step via `GITHUB_ENV`, where the runner environment is available.

The explicit `--build-official` path invokes the pinned source's existing official build and package commands only for new package and descriptor outputs. It does not grant permission to rebuild an already accepted core. [Desktop preparation instructions](../../../../apps/desktop/README.md#prepare-the-base-stage) give the input and audit arguments; the [native builder](../../../../scripts/build-desktop-native.ts) owns shell/client compilation separately from official source construction.

## Stage and update-helper ownership

The default output is `apps/desktop/.stage`; the [base stager](../../../../scripts/stage-desktop-base.ts) refuses an existing stage. It checks the runtime before copying it, verifies the copy before adding the two native clients, and emits `base-smoke.json` for composition-aware checks. The base patch contains only the two additive client entries and retains the complete official Web dependency graph. The historical full enhancement inventory cannot serve as the base package or smoke expectation.

The [packaging configuration](../../../../apps/desktop/electron-builder.yml) keeps the official runtime, composition descriptor and base patch physical under `app.asar.unpacked`. Profile resolution needs real filesystem link targets. Native adapter resolution uses a separately identified manifest rather than modifications to official package manifests. The stage declares the two copied shell utilities as dependencies at their verified official versions; package names and versions must match the runtime before output creation. This lets the builder’s existing traversal fallback collect those physical packages when pnpm returns an empty dependency graph, without inventing an installation ledger or changing the package manager. A collector command that fails to return JSON remains an error.

The [helper preparer](../../../../scripts/prepare-desktop-helper-runtime.ts) owns an independent Node `24.17.0` executable and its release/file checks. Formal preparation requires a recorded real native `--version` probe; cross-platform extraction and injected probes remain distinct evidence. Verified existing helpers are reused read-only, and packaging places the helper under `desktop-helper` resources. This helper receipt does not authorize an update or prove a native replacement lifecycle.

The Linux `.deb` declares `python3`. Native update preflight still determines available capabilities; an AppImage environment missing required capabilities does not acquire automatic replacement authority from package preparation. Linux feature completion and installer/update lifecycle acceptance remain separate from the shared preparation implementation.

<a id="packaged-file-selection-and-permissions"></a>
## Packaged file selection and permissions

The [Windows builder entry](../../../../scripts/windows-desktop-builder.ts) combines the global file patterns and all Windows exclusions into one derived FileSet. Under the pinned builder, separate global and Windows matchers can copy a file that another matcher excludes. The derived configuration explicitly includes the official runtime's physical modules before applying the safety exclusions, including `node-pty` exclusions for its contained pnpm-store layout. Both public Windows package scripts and CI use this entry. It anchors relative PATH entries before changing the working directory and preserves the original configuration beside an exclusively created derived file; the derived file is excluded from the package.

After verifying the runtime copy, POSIX staging adds read permission only to its `provenance.json` and, when recorded in the verified inventory, `desktop-official-installation.json`. These descriptors must remain readable when system installation makes the files root-owned. The source descriptors retain their bytes and permissions; other files, directory permissions and executable bits remain unchanged. Audited inputs without an installation receipt remain supported. These file-selection and permission checks do not establish native installation or application-startup acceptance.

## Alternatives considered

**Reuse the historical full enhancement inventory as the base input.** Rejected because matching package versions or hiding features cannot establish official executable provenance. Base keeps the complete official Web graph and identifies only the native additions separately.

**Repeat the one-off S2 preparation or rebuild every accepted runtime.** Rejected because a maintained entry can verify inputs and preserve independently accepted bytes. Explicit new builds and externally audited read-only reuse have different preconditions and receipts.

**Treat an installed runtime as portable across operating systems.** Rejected because a source digest does not establish native module or executable compatibility. Platform and architecture are checked independently of source identity.

## Consequences

Preparation requires explicit trusted input locations and digests. Existing stages and runtimes are preserved on rejection, and the full source remains available without becoming an implicit base fallback in the build pipeline. The separate official source, native build, helper and stage owners make each artifact's evidence attributable; they also require native verification on every release target.

The implemented checks and current evidence include real verification of all 275 S2 package inputs, native-client/main compilation, and a real darwin helper download and version probe. These facts do not establish a completed CLI-to-stage preparation, Linux feature completion, a published Desktop 0.6.0 release, or formal macOS/Windows/Linux acceptance. The [platform update decision](2026-09-09-platform-specific-desktop-updates.md) retains its independent installation and handoff requirements.
