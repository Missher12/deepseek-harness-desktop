# Agent Note: Pin the CI bubblewrap payload to an available archive build

Status: implemented

English | [中文](2026-09-22-ci-bubblewrap-payload.zh.md)

## Problem

The CI sandbox preparation script pinned Ubuntu Noble bubblewrap `0.9.0-1ubuntu0.1`, which the official archive no longer serves. The parallel dependency step therefore returned 404 and prevented coverage and snapshot gates from starting.

## Decision

Pin the available Ubuntu Noble `0.9.0-1ubuntu0.3` amd64 package and its verified SHA-256. Keep extraction without a package transaction and retain the executable namespace probe as the authoritative readiness check.

## Alternatives considered

**Keep the unavailable archive version.** Rejected because the official archive returns 404, so the coverage and snapshot jobs cannot reach their gates.

**Install bubblewrap through apt.** Rejected because package resolution would reintroduce an unpinned, runner-dependent payload and a package transaction is unnecessary for this CI probe.

## Consequences

Archive replacement now fails at the checksum or functional probe instead of silently changing the sandbox binary. The owning CI test locks the URL template, digest check, and functional probe requirements; refreshing the archive payload requires updating the version and digest together.
