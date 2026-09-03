# Desktop 插件市场实施计划

[English](2026-08-17-desktop-plugin-market.md) | 中文

**目标：** 只在 DeepSeek Harness Desktop 中挂载锁定版本的 `dshmarket@1.10.1`，并提供内置、限定 profile 的包运行器，不要求系统预装 Node 或 pnpm。

**架构：** Desktop 专用 CLI patch 会在 `dshmarket` 之前挂载第一方 Host 适配器。适配器发布不可变的 `desktopProfiles.current` 与串行化的 `desktopPnpm.runPlugin()`。操作重新进入内置 `dsh plugin` 命令，保留上游 profile 初始化和 bundle 对账；现有 subprocess 服务负责凭据过滤和进程树清理。

**技术栈：** Electron 43、Cordis 服务、Node subprocess 流、pnpm 11.7.0、TypeScript、现有 DSH profile loader。

## 任务 1：增加内置 pnpm CLI 接缝

- [ ] 在 `apps/cli/tests/plugin.spec.ts` 添加失败测试，覆盖显式内置 pnpm 入口、绝对路径校验、无 shell argv 与普通 PATH 行为不变。
- [ ] 最小重构 `apps/cli/src/plugin.ts`，让受信任 Desktop 提供的绝对 pnpm 入口通过 `process.execPath` 运行；保留现有对账逻辑与默认 PATH 路径。
- [ ] 运行聚焦 CLI 测试直至 GREEN。

## 任务 2：构建 Desktop Host 服务

- [ ] 创建 `packages/host/desktop-plugin-runtime`，包含包元数据、TypeScript 配置、README 双语对、源码与测试。
- [ ] 添加失败测试，覆盖不可变当前 profile、内置 pnpm 解析、空值/NUL/路径拒绝、单操作锁、流式输出、abort/cancel 与 effect 清理。
- [ ] 把 `desktopProfiles` 实现为当前 Desktop generation 固定的 `web` profile 身份。
- [ ] 基于 `ctx.subprocess` 实现 `desktopPnpm.runPlugin()`，使用准确的内置 CLI、当前 `DSH_HOME` 与内置 pnpm 入口。
- [ ] 运行新包测试与类型检查直至 GREEN。

## 任务 3：只在 Desktop 挂载已审计市场

- [ ] 在 `apps/desktop/package.json` 中精确依赖 `dshmarket@1.10.1`、`pnpm@11.7.0` 与 Host 适配器，并更新锁文件。
- [ ] 新增 `apps/desktop/desktop.cordis.patch.yml`，让 Host 适配器位于 `dshmarket` 之前。
- [ ] 扩展 `HarnessProcess`，接收绝对 patch 路径，并把 `--patch <path>` 放在 Web 自己的 host/port 参数之前。
- [ ] 在 `apps/desktop/src/main.ts` 中解析源码与打包后的 patch 路径。
- [ ] 扩展 `scripts/stage-desktop.ts` 与 Electron 构建文件，复制并校验 patch、市场包、内置 pnpm 入口和适配器产物。
- [ ] 针对准确 argv 与运行时闭包添加先失败后通过的 process/staging 测试。

## 任务 4：证明组合与安全性

- [ ] 增加临时 home 配置转储测试，证明 Desktop patch 包含 `desktop-plugin-runtime` 和 `dsh-market`，普通 `dsh web --dump-config` 两者都不包含。
- [ ] 在临时 `DSH_HOME` 下启动组合后的 Web Host；验证 `/dsh-market/status`、市场客户端注册，以及 Desktop 模式无需配置系统 pnpm即可报告内置 pnpm 可用。
- [ ] 安装并删除一个预构建 fixture 插件；验证 dependency 对账、Loader 状态、取消/忙碌行为，以及会话和凭据哨兵保持不变。
- [ ] 运行 Desktop、CLI、profile loader、GUI、lint、运行时闭包和文档门禁。

## 任务 5：打包并记录交付

- [ ] 更新 Desktop README、包通知与 `PROJECT_CONTEXT.md`，记录锁定市场、服务边界、限制和测试。
- [ ] 构建 Intel `.app` 与 DMG；验证 DMG 和临时 home 下的打包冒烟。
- [ ] 保留共享的 Windows Release 输入，并在公开 Pull Request 上运行现有原生 Windows Setup 构建与 smoke。
