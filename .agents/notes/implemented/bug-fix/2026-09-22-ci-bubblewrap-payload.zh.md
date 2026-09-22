# Agent Note: 将 CI bubblewrap 载荷固定到可用的归档构建

Status: implemented

[English](2026-09-22-ci-bubblewrap-payload.md) | 中文

## 问题

CI 沙箱准备脚本固定使用 Ubuntu Noble 的 bubblewrap `0.9.0-1ubuntu0.1`，但官方归档已不再提供该文件。并行依赖安装步骤因此返回 404，使 coverage 和 snapshot 门禁无法开始。

## 决策

固定使用官方 Ubuntu Noble 现有的 `0.9.0-1ubuntu0.3` amd64 软件包及已核验的 SHA-256。继续采用无软件包事务的解包方式，并保留可执行文件命名空间探测作为最终就绪检查。

## 影响

归档替换现在会在校验和或功能探测处失败，而不会静默更换沙箱二进制。CI owning test 固定 URL 模板、摘要校验和功能探测要求；刷新归档载荷时必须同时更新版本和摘要。
