# Agent Note: 打包版 client 模块 proxy 透明解析

Status: implemented

[English](2026-08-31-packaged-client-module-proxy-transparency.md) | 中文

## Problem

Electron 把应用模块树打进 `app.asar`，而外部 Harness profile 无法通过文件系统软链接穿入该 archive。因此 app boot 通过受管 ESM proxy 暴露应用包。client 模块扫描器此前停在 proxy manifest；这些 manifest 有意描述 Node re-export，而非浏览器 client，导致扫描器找不到任何 `dsh.client` 声明、发布空启动图，并在没有 client 插件的情况下启动 Desktop shell。

## Decision

client 模块扫描器把 app-boot 受管 ESM fallback proxy 当作一步透明的包定位。proxy 必须使用生成的 private ESM manifest、`entry-N.js` 默认 export，以及 `dsh.moduleFallback.targets` 中的 `file:` 目标。扫描器只跟随该目标一次，要求原始 manifest 声明同一包名，并从原始包读取 `dsh.client`、`./client` 与 bundle 字节。无效目标、循环和第二层 proxy 均 fail closed。Node host import 继续使用 proxy。

## Alternatives considered

**把 `dsh.client` 复制到每个 proxy manifest。** proxy 导出的文件是 Node ESM re-export，而不是编写好的浏览器 bundle。把它拼入浏览器 combo 只会把空启动图换成无效浏览器代码。

**解包完整应用模块树。** 这能避免 archive 穿越，但会显著扩大未打包应用面，并且只为 profile 解析而复制文件。

## Consequences

打包版 Desktop 启动现在会发布与源码安装相同的 bootstrap 和 application client batch，同时保留 Node 解析所需的外部 profile proxy。扫描器现在依赖精确的 app-boot proxy 标记与一个原始 `file:` 目标；其他包和任意类似 proxy 的 manifest 维持原有解析行为。
