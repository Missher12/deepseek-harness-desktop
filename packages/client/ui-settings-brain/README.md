# @deepseek-ai/dsh-client-ui-settings-brain

English | [中文](README.zh.md)

Unified **Memory & Learning** overview for Web and Desktop Settings. The browser plugin registers a localized section at order 9 and reads one bounded, pathless Host snapshot. It does not read memory databases, project paths, or provider errors.

The page paints two stable source rows before the first response: reviewed project memory and learned workflows that have passed validation. It then replaces placeholders with provider state and bounded counts. Supporting copy explains read-only legacy-memory compatibility, the single recall path, the six-item and 4 KB limits, the 150 ms fail-open deadline, and reversible exact-duplicate consolidation.

## Model Experience

### Memory & Learning settings overview

#### What the model sees

Nothing from opening this page. This package renders local status only; model-visible memory continues to be selected and injected exclusively by `@deepseek-ai/dsh-missher-brain`.

#### Token effect

None from this settings package. A qualifying recall is separately bounded by the Brain Hub to six complete records and 4 KB.

#### KV Cache effect

Opening this page has no prompt or cache effect. Memory stores remain on the device; a qualifying model request can include up to six selected excerpts totaling 4 KB and can therefore change that turn's context.

## Known Limitations and Deferred Work

- Provider-specific review, deletion, and enable controls remain in their owning Settings sections.
- A provider that fails or misses the status deadline is shown as unavailable without exposing its internal error.
