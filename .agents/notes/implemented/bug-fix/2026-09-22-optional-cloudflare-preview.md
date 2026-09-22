# Agent Note: Build previews without Cloudflare credentials

Status: implemented

English | [中文](2026-09-22-optional-cloudflare-preview.zh.md)

## Problem

Repositories without Cloudflare credentials can build the PR preview but fail at deployment. That failure obscures successful build validation and implies a hosted preview exists when none was configured.

## Decision

The [preview workflow](../../../../.github/workflows/build-preview-cloudflare.yml) always installs immutable dependencies and builds the workspace and preview. With no deployment or Access credentials, it records that deployment is unconfigured and skips upload, remote verification, and URL comments. All four credentials enable the existing deployment and protected-image checks. Partial configuration fails explicitly without printing credential values.

## Alternatives considered

**Skip the entire job.** This removes useful build validation from repositories without a preview service.

**Ignore deployment errors.** That hides invalid credentials and failures of an explicitly configured deployment.

## Consequences

A passing build does not imply a deployed preview. Configured deployments retain their failure checks. Tests execute the configuration decision with absent, complete, and partial synthetic credentials and verify that build steps remain unconditional.
