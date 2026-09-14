# 验证源码迁移记录

[English](desktop-source-migration.md) | 中文

Desktop 的源码维护入口为 [Missher12/deepseek-harness-desktop](https://github.com/Missher12/deepseek-harness-desktop)。本文记录 2026-09-14 从私有验证仓库导入的内容。

## 导入内容

| 项目 | 标识 |
| --- | --- |
| 来源 | `Missher12/deepseek-harness-desktop-validation`，`main` |
| 来源提交 | `861921a7c10c8f7fef7793be559af386858436f2` |
| 导入前公开主分支 | `d1e8bd9c6d49f980405888099087f931ddd26d83` |
| 开发中 Desktop | `0.6.0` |
| 固定官方 Harness | `0.1.5-rc.2`，`fb2c4b9e698e30edb738bca4cf0618587db7d203` |

本次导入来源主分支的已跟踪文件，包括桌面代码、构建脚本、平台工作流、测试及其文档。产品代码与该快照保持一致。公开首页、桌面指南和维护交接按两项目标及当前源码状态重写。

私有仓库保留原始历史、实验分支和 Actions 记录。本次不导入私有 Git 历史或本地未提交工作。已有公开标签、Release 和安装包资产继续关联其原提交。

## 待完成工作

来源提交记录的 Windows 原生运行和 Ubuntu 原生生命周期检查失败，Ubuntu 安装包构建任务通过。这些结果不能证明原生验收完成。导入源码不会生成新 Release、更新已安装应用，也不代表插件设置和市场入口已经完成。

后续按[项目上下文](../PROJECT_CONTEXT.md)、[交接说明](../HANDOVER.md)和[发布流程](../apps/desktop/releasing/README.zh.md)继续。工作台与飞书保持排除。已有可选插件功能应保留，兼容问题在所属项目内解决。
