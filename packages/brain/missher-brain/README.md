# dsh-missher-brain

English | [中文](README.zh.md)

The local External Brain hub for DeepSeek Harness. It validates and registers independently owned factual-memory and procedural-learning providers so a later arbiter can select one bounded context batch for each eligible top-level turn. Providers retain their own databases and side effects; the hub owns no user memory.

## Provider contract

- Every live provider has a non-empty unique `id`, protocol version `1`, and an integer byte budget from 1 through 6,000.
- `prepare()` returns opaque candidates plus single-use `accept()` and `cancel()` operations. Preparing candidates does not mark them used or mutate provider state.
- Registration is insertion ordered and returns an exact-registration disposer. A stale disposer cannot remove a successor with the same ID.

## Model Experience

### External-brain candidates

#### What the model sees

Nothing from the registry alone. The Brain Hub injector is the sole component allowed to render selected contributions into an eligible model step.

#### Token effect

Zero tokens until the injector selects and renders provider contributions. The provider and hub budgets bound that later context.

#### KV Cache effect

The registry does not touch request prefixes. A later eligible recall changes only that turn's external-brain context and can reduce cache reuse for the affected prefix.

## Known Limitations and Deferred Work

- Protocol version `1` supports local, text-only contributions. Binary knowledge, remote provider discovery, and cross-device synchronization are outside this package.
