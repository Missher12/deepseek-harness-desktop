# macOS 侧副本更新验收驱动

[English](macos-side-copy-update.md) | 中文

## 摘要

[驱动](macos-side-copy-update.ts)将显式产物复制到私有临时目录，分别记录更新适配器失败、退出失败及保护数据变化。驱动本身不启动应用，结果始终标记 `nativeAcceptance: false`；原生验收还需要 foundation 适配器与独立的运行进程证据。

## 目录

- [输入与隔离](#输入与隔离)
- [合成旧配置](#合成旧配置)
- [适配器与证据](#适配器与证据)
- [离线验证](#离线验证)
- [开发备注](#开发备注)

## 输入与隔离

输入包括旧应用产物及其 `app.asar` SHA-256、目标 DMG 及 SHA-256、最终源码 SHA、Evolution 0.7.0 包目录与带 SHA-256 的归档，以及显式合成 Session 字节。驱动拒绝 `/Applications` 下的产物、越界包链接、绝对包链接和无效 Session 路径。副本中的相对包链接保持相对形式。适配器操作前后均检查源产物哈希；驱动不证明签名、DMG 格式、完整解包依赖来源或归档与包目录的一致性。

每次运行分配权限为 0700 的临时目录。适配器只接收该次运行的应用、DMG 副本、尝试 ID、源码 SHA 和 fixture 路径，首次启动及重启必须使用这些隔离路径。默认行为不读取用户 Session 正文、凭据或插件数据。运行结束保留目录供检查；适配器证明全部工作停止后，只移除本次拥有的目录。准备失败可能保留部分目录，不计作运行完成。

[原生输入消费者](macos-side-copy-native-adapter.ts)先验证 foundation 的[基础 descriptor](../../../scripts/desktop-base-contract.ts)及其可信 SHA-256，再解析 Mac 资源。它检查候选 ASAR 哈希、包内 Desktop/内核元数据、必需文件和可执行文件范围。输入为 `DSH_DESKTOP_SMOKE_DESCRIPTOR`、`DSH_DESKTOP_SMOKE_DESCRIPTOR_SHA256`、`DSH_MACOS_CANDIDATE_ASAR_SHA256` 和 `DSH_MACOS_SOURCE_SHA`；`DSH_MACOS_REQUIRE_NATIVE=1` 会拒绝缺失输入。没有原生请求时，离线发现不生成请求；输入不全或开关无效则失败。输入加载器本身仅验证制品；`runMacBaseCore` 还执行共享打包冒烟以及旧历史 UI 重开和原生目录选择续验。

## 合成旧配置

[Fixture](macos-legacy-profile-fixture.ts)模拟有序 Web Bundle 列表 `@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app`、`dsh-missher-evolution`、live patch reload、本地归档依赖和 profile 内的 Evolution 0.7.0 包。共享 `profiles/node_modules/@deepseek-ai` 链接指向旧应用侧副本的解包运行时。它添加空用户 patch 和数据保留哨兵，不伪造生成的 Cordis 配置、lockfile、fallback cache 格式、凭据或可变 Evolution 规则。

主要原生场景使用已核验的 Desktop 0.5.5 / Harness 0.1.3-alpha.1 源产物，Desktop 0.5.8 是另一升级来源。调用方负责版本核验和有效历史 Session 种子；fixture 不推断 Session 格式，也不把合成哨兵字节当作可执行插件状态。离线测试使用不可执行的合成产物，不能证明 Evolution 激活或历史可读。

保护清单包含路径、空目录和普通文件哈希，既有条目必须保持一致。只有通过精确 `allowedNewProtectedPaths` 条目声明的新代路径可以新增；通配规则不能允许删除或覆盖。每项实际新增均记录到证据报告。符号链接、被重定向的祖先目录和硬链接保护文件均使保留检查失败。

## 适配器与证据

`MacosSideCopyAdapter` 是测试依赖接口。Foundation 提供 `upgrade`、`verifyReady` 和 `stopAndVerify`；真实 helper 与 ready 协议仍是唯一产品依据。适配器必须限制等待时间、消费真实 ready 回执、验证实际版本和可执行文件/home/userData 路径，并在升级失败后停止全部所属进程。驱动等待清理完成后采集最终数据证据，清理失败与升级或 ready 失败分别保留。

适配器结束后，目录内的 `side-copy-result.json` 通过原子重命名写入。它记录尝试、最终源码 SHA、输入产物哈希、保护清单、允许与实际新增路径，以及分别归类的失败阶段。`adapter-completed` 只表示回调和数据保留检查完成；空回调、helper 启动成功或 `open` 命令成功不能证明原生升级成功。

核心验证显式使用 `scope: 'core'`。`native-base-evidence.json` 报告 `acceptance: 'core-passed'` 和 `unverifiedChecks: ['pauseRecovery']`，不证明完整插件恢复或安装器事务。旧历史 UI 证据读取官方会话行现有的 `text/plain` 拖拽内容和 `aria-selected` 状态，必须匹配真实夹具的 Session ID、已渲染历史回答，以及原始文件和工作区成员关系的保护结果。Mac 目录选择要求根进程下新增且唯一的候选 PID，命令严格为 `osascript` 或 `/usr/bin/osascript`，并通过该 PID 的 lsof 文本映像记录验证 `/usr/bin/osascript`。System Events 仅操作这个已确认 PID，支持 Choose/选择/选取 确认按钮并验证新增工作区行。辅助功能权限缺失、UI 断言失败或所属进程及监听端口残留都会使本次运行失败。原生验证还要求精确且干净的源码 SHA、实际 Intel 可执行文件和 Info.plist 身份。各根目录保留阅读器、设置、旧历史和所选工作区截图及带哈希的记录。

可选启动入口接收 `DSH_MACOS_STARTUP_EXECUTABLE` 和 `DSH_MACOS_STARTUP_FIXTURES`，使用一份或十份独立夹具。耗时覆盖当前核心生命周期及 Mac 续验，不用于新旧性能比较。旧的视觉包装脚本入口和扩展 CI 草稿不属于本次核心入口。

设置 `DSH_MACOS_PICKER_MODE=manual` 可使用人工辅助目录选择，默认值为 `automatic`。`DSH_MACOS_PICKER_TIMEOUT_MS` 只在人工模式下有效，必须为 1000 到 600000 的整数，默认 600000。两个原生入口均显式解析策略，并为有上限的等待预留测试截止时间。自动输入失败不会切换到人工模式。

应用自己的 Add workspace 操作打开新增且经过系统映像核验的选择器后，人工模式写入 `checks/mac-picker-awaiting-user.json` 并向 stdout 输出同一 JSON 行，包含完整自有目标路径、窗口标题/PID、比例及截止时间。这只是输出提示，该文件和任何外部确认都不能提供成功依据。人工模式不执行键盘输入、激活或代选；它等待确认过的 picker 退出，并要求官方持久化记录出现新的工作区 ID，且规范化完整 `path` 等于要求的物理目录。字段来自固定官方 `workspace/spec.ts` 域（`global.workspaceIds`、`tables.workspaces`），已有同路径工作区或仅 basename 相同的错误路径均不能通过。实际工作区行和输入框 trial 交互也必须通过。取消或写入失败、错误路径、超时均失败，随后沿用自有应用退出及旧数据验证。消费者只读取隔离的工作区表，不读取误选目录内容。

可移交核心证据记录 `pickerMode`，绑定的 Mac 续验记录保存所选工作区 ID 和完整路径，最终验证在退出后重新读取官方记录。Mac 续验失败时也执行旧历史保护验证，失败不能生成完成记录。人工模式用于下一次冻结候选的原生验收，不代表已有原生通过结果。

## 离线验证

仓库依赖可用时，从仓库根目录运行定向测试：

```sh
pnpm exec vitest run apps/desktop/tests/macos-side-copy-update.spec.ts
```

测试创建可丢弃合成源，通过显式离线回调调用驱动，结束后清理自己的目录。覆盖哈希拒绝、副本链接范围、Session 路径拒绝、ready/清理失败、源变化、数据损坏及显式允许的新代文件。打包核心入口为 `packaged-smoke.spec.ts`。`DSH_MACOS_CORE_FIXTURES` 指向 JSON 文件，包含恰好两个 `{ smokeRoot, legacyFixturePath }` 对象，顺序为 100%、150%；两份夹具由共享历史夹具生成器在不同物理根目录准备。`DSH_MACOS_DESKTOP_EXECUTABLE` 可显式选择一次性安装副本的可执行文件；两个比例均直接使用同一实际程序及共享缩放选项，不使用 shell 包装程序。

[历史性能工具](../../../scripts/macos-desktop-runtime-evidence.ts)的可选对照仅接受 0.5.3 基线与 0.5.5 候选。它不约束当前 Desktop manifest，也不提供当前版本发布验收；0.6.0 候选会因超出该实验范围而被拒绝。

## 开发备注

无。
