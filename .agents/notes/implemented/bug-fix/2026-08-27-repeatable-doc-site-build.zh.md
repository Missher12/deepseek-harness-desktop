# Agent Note: 可重复的文档站构建

Status: implemented

[English](2026-08-27-repeatable-doc-site-build.md) | 中文

## Problem

文档构建会在 VitePress 渲染站点后，把原始 Markdown 镜像写入 `website/.dist`。VitePress 在后续构建前没有删除这些构建后文件，因此第二次执行在遇到上一次留下的 `index.md` 时触发了冲突保护并失败。

## Decision

两个文档构建入口现在都会先执行仓库自有的准备脚本，再启动 VitePress。该脚本解析仓库与 `website` 目录，拒绝链接形式的 `website` 或 `.dist`，并且只删除固定的可丢弃目标 `website/.dist`。现有的原始 Markdown 冲突检查继续保持严格，因此当前 VitePress 构建复制出的文件仍不能被覆盖。

## Alternatives considered

**允许原始 Markdown 覆盖任意既有输出。** 拒绝，因为这会隐藏与当前构建从 `website/public` 复制出的文件之间的冲突。

**运行仓库级完整清理命令。** 拒绝，因为它会删除无关包的构建输出，使文档构建变得更慢且范围更大。

## Consequences

重复的本地与 CI 构建会从相同的输出状态开始，同时不会削弱源码文件或公共文件的冲突保护。应用运行时和 Desktop 安装包内容不受影响。

## Testing

聚焦测试覆盖精确目标清理、相邻文件保留和链接目录拒绝。随后连续执行两次 MPA 构建；两次都解析了 2402 个内部片段，并生成 181 个原始 Markdown 文件与 `llms.txt`。
