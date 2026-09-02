# Agent Note: Desktop 升级时恢复完全匹配的旧版打包模块代理

Status: implemented

[English](2026-09-02-recover-legacy-packaged-module-proxies.md) | 中文

## 问题

打包版 Desktop 0.4.10 与 0.4.11 会把 `$DSH_HOME/profiles/node_modules` 回退物化为真实的 ESM 代理目录，因为 profile 外部插件无法沿链接进入打包后的 `app.asar` 文件系统。Desktop 0.5.0 使用普通安装链接，并把每个真实回退条目都视为用户所有。因此，已有 0.4.x home 会在 Harness 子进程启动前于 `healProfilesModuleFallback` 失败，而仅使用全新临时 home 的原生冒烟测试仍保持绿色。

## 决策

`healProfilesModuleFallback` 仅在包名、manifest 键顺序及序列化、ESM exports、规范的 `pathToFileURL` 目标、生成的 `entry-N.js` 字节和完整目录文件清单都与历史生成器一致时，才认定其为旧版代理。每个目标都必须进入打包后的 `app.asar` 或 `snapshot` 路径。任何不匹配、额外字段、额外文件、非规范 URL 或不可读条目都会让真实目录保持不变，并抛出原有的明确错误。

认定成功的代理会先被原子重命名到真实目录 `$DSH_HOME/recovery/legacy-module-fallback`，再创建当前安装链接。恢复名称由内容摘要和随机后缀组成；保留的 manifest 与条目字节可供检查或手动还原。各层恢复父目录自身也必须是真实目录。并发启动只有在另一进程已经移动代理或创建完全相同链接时，才可输掉重命名或链接创建竞态。

打包版 Desktop 冒烟测试会在临时 `DSH_HOME` 中，把完全匹配的 `@deepseek-ai/dsh-desktop` 代理与普通 profile、冷 Session 字节一起种入。只有代理已保存在恢复目录、当前链接存在、无关字节完全一致且自有进程树彻底退出，启动才会被接受。

## 考虑过的替代方案

**删除每个带 `dsh.moduleFallback.targets` 的目录。** 仅凭 marker 无法证明所有权，误判后的删除不可逆。要求历史字节完全匹配并采用可恢复重命名，才能保留普通真实目录的拒绝行为。

**要求用户手动修复目录。** 失败发生在 Harness 子进程启动前，Desktop 错误页又有意只显示通用信息，因此受影响的升级无法进入设置或应用内修复操作。

**继续写入旧版代理格式。** 这会把打包相关的目标 URL 保留为活动状态，并让未来修复继续比较过时的 exports，而不是让每个安装统一收敛到当前链接。

**替换前复制目录。** 先复制再删除可能留下不完整备份，也会扩大崩溃窗口。同一 home 内的重命名能原子保留原目录条目。

## 后果

完全匹配的 0.4.x 生成代理只迁移一次，不再阻塞 Desktop 启动。恢复目录会一直保留到用户自行删除；运行时不会清理升级证据。经过修改或已经损坏的代理仍会关闭式失败并需要手动检查。全新 home 与已有正确链接保持原有行为，而单元测试及 macOS、Windows 原生打包冒烟测试会覆盖这条升级路径。
