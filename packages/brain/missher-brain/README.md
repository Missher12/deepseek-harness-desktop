# @deepseek-ai/dsh-missher-brain

English | [中文](README.zh.md)

The local External Brain hub for DeepSeek Harness. It validates and registers independently owned factual-memory and procedural-learning providers, then selects one bounded context batch for each eligible top-level turn. Providers retain their own databases and side effects; the hub owns no user memory.

## Provider contract

- Every live provider has a non-empty unique `id`, protocol version `1`, and an integer byte budget from 1 through 6,000.
- `prepare()` returns opaque candidates plus single-use `accept()` and `cancel()` operations. Preparing candidates does not mark them used or mutate provider state.
- Registration is insertion ordered and returns an exact-registration disposer. A stale disposer cannot remove a successor with the same ID.
- The local Settings Remote exposes only provider ID, state, bounded item count, byte budget, and the fixed arbitration limits. Provider errors and timeouts become an `unavailable` row; paths and error details never cross into the browser.

## Model Experience

### External-brain candidates

#### What the model sees

Only selected, source-attributed JSON records inside an explicitly untrusted `External brain context` block. Recall runs only for the first step of a top-level direct-user turn whose session has a project working directory. Subagent children, plugin-only messages, later steps, rejected steps, and sessions without a project directory receive nothing.

#### Token effect

Zero tokens on ineligible steps. An eligible recall adds at most six selected contributions and at most 4,000 UTF-8 bytes including the complete wrapper and source metadata.

#### KV Cache effect

The registry does not touch request prefixes. Eligible recall changes only that turn's external-brain context and can reduce cache reuse for the affected prefix. Providers share a 150 ms deadline; timeout, cancellation, malformed output, acceptance failure, and cleanup failure all return the original downstream decision.

### Invariant ownership

No invariant companion is published because BrainProviderRegistry synchronously enforces provider identity, version, budget, and duplicate registration.

## Known Limitations and Deferred Work

- Protocol version `1` supports local, text-only contributions. Binary knowledge, remote provider discovery, and cross-device synchronization are outside this package.
- Project identity is a pathless SHA-256 of the absolute session working directory. This isolates providers from the raw path but does not merge projects reached through distinct symlink spellings.
