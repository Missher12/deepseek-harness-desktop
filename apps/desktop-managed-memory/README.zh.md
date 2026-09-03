# Desktop 托管记忆

[English](README.md) | 中文

这是固定 `dsh-missher-memory` 版本的 Desktop 私有兼容入口。Host 入口重新导出固定版本的软件包；`lib/client.js` 是机械同步的副本，其模块 ID 与此托管软件包一致。

更改任一固定 Provider 版本后，请运行 `pnpm exec tsx scripts/sync-desktop-managed-providers.ts` 重新生成两个托管客户端产物。
