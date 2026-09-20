# Intel Mac 打包

[English](README.mac.md) | 中文

`mac.mjs` 使用共用蓝紫色鲸鱼图标打包官方桌面界面和运行时，不附带用户 profile、个人插件、语言覆盖配置或更新源。应用使用本地 ad-hoc 签名；DMG 未签名，两者均未经公证。发布由总指挥统一执行。

最终源码检出的官方构建通过后，只准备一次锁定运行时。随后可复用该准备目录打包：

```sh
node desktop-packaging/mac.mjs prepare
node desktop-packaging/mac.mjs package
node desktop-packaging/mac.mjs dmg
```

`package` 生成目录形式的应用。`dmg` 要求工作树干净，并在 `apps/desktop/.desktop-build/targets/mac-x64/local-artifacts/` 生成 `deepseek-harness-<version>-mac-x64-local.dmg` 和 `mac-dmg.json`。回执将文件大小、SHA-256 与检出的完整 Git SHA 绑定；打包过程中提交发生变化会被拒绝。仅使用为总指挥锁定的最终 SHA 重新构建的产物。

共用准备脚本通过 `DSH_DESKTOP_LOCAL_MAC_ADHOC=1` 选择本地运行时签名器，在封存运行时清单前签署 Mach-O 辅助文件。ad-hoc 代码没有用于原生库校验的 Team ID，因此辅助文件不启用 hardened runtime 标志；Node 保留 JIT entitlement。Electron 应用仍使用 hardened runtime 签名，正式签名分支独立保留。

在 Intel Mac 上运行隔离原生检查：

```sh
node desktop-packaging/smoke-mac-dmg.mjs \
  apps/desktop/.desktop-build/targets/mac-x64/local-artifacts/deepseek-harness-<version>-mac-x64-local.dmg \
  apps/desktop/.desktop-build/mac-owner/final-dmg-smoke
```

检查会验证并只读挂载 DMG，将应用复制到私有临时 Applications 目录，检查签名和图标，再使用临时 HOME、DSH_HOME 和 Electron 数据启动。检查内容包括打包版本、界面、系统分配端口的回环 Host、空的外部插件依赖、正常退出和进程清理。检查不设置 webserver profile 覆盖，也不调用模型，不替换用户日常应用或数据。
