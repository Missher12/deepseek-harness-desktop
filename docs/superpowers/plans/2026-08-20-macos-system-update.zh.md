# macOS 系统更新实施计划

[English](2026-08-20-macos-system-update.md) | 中文

> **供 Agent 工作进程使用：** 必须使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans，逐项实施本计划。步骤使用复选框（`- [ ]`）跟踪。

**目标：** 增加不阻塞启动的系统更新设置区，报告官方 Harness 进度，并且只安装经过验证且兼容的 Intel macOS Desktop 版本。

**架构：** Electron 主进程拥有封闭更新状态机、固定 GitHub 端点、验证、下载、校验和与 helper 启动。preload 只暴露狭窄的类型化命令；Desktop 专用设置插件立即渲染缓存状态。官方核心标签只用于提示，白名单 Desktop 发布清单才是唯一安装授权。

**技术栈：** Electron、TypeScript、React slot 注册、Node.js HTTPS/crypto/fs/process API、Vitest、electron-builder、pnpm。

---

## 文件映射

- `apps/desktop/src/update/*`：版本解析、清单/发布选择、下载器、状态服务和可恢复安装 helper。
- `apps/desktop/src/main.ts`、`preload-api.ts` 与 `preload.ts`：生命周期所有权和狭窄 IPC bridge。
- `packages/client/ui-settings-system-update/*`：Desktop 专用设置贡献、store、本地化文案和组件测试。
- `apps/desktop/desktop.cordis.patch.yml`、`apps/desktop/package.json`、`tsconfig.client.json`：打包插件接线。
- `scripts/stage-desktop.ts` 与 `apps/desktop/electron-builder.yml`：不可变构建元数据和已打包 helper/产物检查。

### 任务 1：用失败测试锁定验证与状态行为

- [ ] 增加纯测试，覆盖 `dsh-v<semver>` 解析、Desktop 清单验证、固定仓库与 HTTPS 白名单、平台/架构、大小和校验和要求。
- [ ] 增加发布选择测试，覆盖已是最新、仅上游更新、兼容 Desktop、无效清单、降级和限流状态。
- [ ] 增加服务测试，覆盖立即缓存状态、延迟自动检查、24 小时节流、ETag、手动绕过、受限错误和销毁取消。
- [ ] 增加 preload 测试，证明 renderer 调用方无法提供仓库、URL、文件系统路径或命令值。

### 任务 2：实现主进程更新所有权

- [ ] 使用不可变运行构建元数据，实现封闭状态快照与纯发布选择器。
- [ ] 实现带超时、ETag、响应大小限制和限流处理的固定端点请求，并且不读取凭据。
- [ ] 实现仅所有者可读写的暂存目录、受限重定向、进度事件、字节数检查、SHA-256 验证和未完成文件清理。
- [ ] 只在应用就绪后开始自动检查，并且只在 user data 中持久化公开版本/检查元数据。

### 任务 3：实现可恢复安装

- [ ] 增加不经 shell 直接调用的已打包 helper，并且只传入由主进程验证过的固定路径。
- [ ] 只读挂载已验证 DMG，并验证唯一 app bundle、bundle 标识、Desktop 版本、x86_64 可执行文件和已打包元数据。
- [ ] 备份当前应用、替换、验证替换结果并启动；在备份后的故障中恢复并重新启动旧应用。
- [ ] 如果应用父目录不可写，则打开已经验证的 DMG 供手动拖放安装，不请求提权。

### 任务 4：增加 Desktop 专用设置区

- [ ] 创建普通客户端包，只在 Desktop bridge 存在时通过设置 slot 注册。
- [ ] 使用框架 store seat 保存更新快照；组件接收 hook 与 action，不自行订阅。
- [ ] 立即用占位值渲染最终双行结构，随后显示 Desktop 版本、内置核心、最新官方核心、进度、上次检查和受限恢复信息。
- [ ] 只在合法状态转换中暴露“再次检查”“下载更新”和“重启并安装”；只有上游更新时显示等待 Desktop 适配。

### 任务 5：打包并验证内部版本

- [ ] 把新包、helper 与不可变更新元数据接入 Desktop 暂存和 electron-builder 验证。
- [ ] 运行聚焦更新、preload、客户端、类型、lint、暂存和既有 Desktop 生命周期测试。
- [ ] 构建 Intel macOS DMG，并用本地证据比较已打包元数据、架构、大小和 SHA-256。
- [ ] 安装本地内部版本，验证冷启动没有被延迟，打开系统更新并确认真实页面没有控制台或插件加载器错误；不发布到 GitHub。

### 任务 6：更新项目文档

- [ ] 在 `PROJECT_CONTEXT.md` 记录双通道策略、更新状态、打包证据，以及当前没有可安装公开 Desktop 版本的已知事实。
- [ ] 运行本计划和设计配对的翻译检查；分开报告无关的既有全库失败。
