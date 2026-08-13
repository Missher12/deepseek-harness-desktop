# DeepSeek Harness 桌面版

[English](README.md) | 中文

这是官方 DeepSeek Harness 运行时的 Intel macOS 原生外壳。应用只在本机
回环地址启动一个由自身管理的 Harness 子进程，端口由操作系统随机分配，
现有 Harness Web 客户端运行在加固后的 Electron 窗口内。

侧栏提供类似 Codex 的已归档会话管理器。归档会保留会话日志及其原有
Workspace 位置，可在管理器中原位恢复；永久删除只能从归档管理器进入，
必须明确二次确认，且运行中的会话会被拒绝删除。
每个已有内容的会话都在操作菜单中提供“复制会话 ID”，归档会话卡片也
提供同一操作，复制时不会恢复或删除会话。应用复制完整且稳定的原始 ID，
并根据宿主剪贴板是否接受写入显示结果提示。

## 图标来源

`assets/icon-source.png` 是 2026-08-14 通过 macOS 与 Windows 两端验收的
1254×1254 RGBA 正式母版。透明四角、奶白圆角底板、蓝色内层与白色
DeepSeek 白鲸均保持原样，未替换、未重新设计。

母版 SHA-256：
`1fe0c2a3b6475c451f86dc999e97de33e4aabace244e35a284d1c5e162b0672a`

`assets/icon.icns` 仅由该母版在本机转换为 macOS 标准 16–1024 px 图标集，
SHA-256 为
`d453a58a11cb5247f83f3b220bca2c6f0f216f07a6c7dfbb4998bb9f9f72c54e`。

## 构建

在仓库根目录执行：

```bash
pnpm run desktop:pack
pnpm run desktop:dmg
```

两个命令都只构建 Intel（`x86_64`）macOS 产物。生产暂存目录为
`apps/desktop/.stage`，输出目录为 `apps/desktop/release`。

`desktop:pack` 生成可直接启动的 `.app`，`desktop:dmg` 生成安装镜像。应用
使用操作系统分配的随机回环端口，不会占用固定的 65000 端口。

当前 Intel 成品为 `DeepSeek-Harness-0.1.2-mac-x64.dmg`，SHA-256：
`40e20ade2025116e0b80181529ba5fef4fbe11087690894636a0c9c5bd4ff138`。

## 成品验证

先生成目录版应用，再从仓库根目录运行：

```bash
pnpm exec vitest run apps/desktop/tests/packaged-smoke.spec.ts --config vitest.config.ts
```

测试使用临时工作目录、临时用户数据和临时 `DSH_HOME`，验证 preload、
三栏工作台、归档管理器、设置窗口、随机监听端口，以及原生退出后的完整
进程回收。

当前本机构建未使用 Apple Developer 证书签名或公证；首次从其他位置打开时，
可能需要在 Finder 中右键选择“打开”。
