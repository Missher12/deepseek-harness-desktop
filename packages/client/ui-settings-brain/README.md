---
description: "Unified local external-brain status for Web Settings"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-brain

English | [中文](README.zh.md)

## Summary

Unified **External Brain** overview for Web and Desktop Settings. The browser plugin registers a localized section at order 9 and reads one bounded, pathless Host snapshot. It does not read memory databases, project paths, or provider errors.

The page paints three stable source rows before the first response: project memory, validated experience rules, and built-in read-only compatibility with a previous memory library. It then replaces placeholders with provider state and bounded counts. It also explains the single recall path, the six-item and 4 KB limits, the 150 ms fail-open deadline, and reversible exact-duplicate consolidation.

## Table of Contents

- [Dev Note](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="dev-note"></a>
## Dev Note

None.

<a id="model-experience"></a>
## Model Experience

### External-brain settings overview

#### What the model sees

Nothing from opening this page. This package renders local status only; model-visible memory continues to be selected and injected exclusively by `@deepseek-ai/dsh-missher-brain`.

#### Token effect

None from this settings package. A qualifying recall is separately bounded by the Brain Hub to six complete records and 4 KB.

#### KV Cache effect

Opening this page has no prompt or cache effect. A qualifying recall can change that turn's context under the Brain Hub's documented bounds.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Provider-specific review, deletion, and enable controls remain in their owning Settings sections.
- A provider that fails or misses the status deadline is shown as unavailable without exposing its internal error.
