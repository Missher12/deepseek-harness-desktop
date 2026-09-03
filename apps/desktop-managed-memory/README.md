# Desktop managed memory

English | [中文](README.zh.md)

Private Desktop compatibility entrypoint for the pinned `dsh-missher-memory`
release. The Host entry re-exports the pinned package; `lib/client.js` is a
mechanically synchronized copy whose module id matches this managed package.

Regenerate both managed client artifacts with
`pnpm exec tsx scripts/sync-desktop-managed-providers.ts` after changing either
pinned provider release.
