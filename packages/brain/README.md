---
description: "Local memory context coordination and its independently owned providers."
kind: "package-group"
---

# brain/ — local memory coordination

English | [中文](README.zh.md)

## Summary

The brain group selects bounded context from registered memory and learning providers. Each provider owns its data and mutations. The Desktop composition does not mount this group; its source remains available for separate maintenance.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

## Packages

[`missher-brain`](missher-brain/README.md) owns provider registration, bounded selection and context attribution. Its package reference describes the model-facing contract.

## Related documentation

The [extension subsystem](../../docs/subsystems/extensions.md) owns plugin composition. The [core subsystem](../../docs/subsystems/core.md) owns admission of selected context into a turn.

### Dev Note

None.
