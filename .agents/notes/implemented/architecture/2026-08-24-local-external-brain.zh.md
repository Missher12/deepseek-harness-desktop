# Agent Note: 本地外置大脑 Provider Hub

Status: implemented

[English](2026-08-24-local-external-brain.md) | 中文

## Problem

超长项目需要经过审核的事实记忆和可复用的工作规则，但两个插件各自直接注入会造成文本重复、上下文预算不可预测，还可能把召回内容误当成新的学习证据。旧 TencentDB 数据库的兼容读取也必须保持可选和只读，不能让全新 Desktop 安装依赖应用外的用户数据。

## Decision

Desktop 按 `@deepseek-ai/dsh-missher-brain`、`dsh-missher-memory`、`dsh-missher-evolution` 的顺序加载。Brain 独占自动外部上下文注入监听器并提供 Provider 注册表；Memory 与 Evolution 要求该服务存在，不建立备用注入监听器。召回只在带工作目录的顶层直接用户会话第一步执行，使用工作目录的无路径 SHA-256 项目标识，并在同一个 150 毫秒期限内最多选择六项、合计 4,000 UTF-8 字节。Provider 超时、输出无效、确认失败或清理失败都会保留原始下游决策。

Memory 负责已审核项目事实、schema 2 FTS5 检索，以及至少四条旧的、未固定的精确重复内容的确定性压缩。压缩事务生成一个抽取式胶囊，归档而不删除来源记忆，记录来源标识与校验和，并支持恢复来源和 FTS 行的事务回滚。包内包含固定查询的 `node:sqlite` TencentDB 兼容读取器，但 Desktop 不打包数据库；读取器只会只读打开用户明确选择且通过路径包含校验的 `vectors.db`，拒绝符号链接和扩展加载，也绝不为 MSE 提供证据。

Evolution 负责流程型 Candidate、Trial 与 Active 规则，并且仅在 Brain 接受所选一次性 handle 后记录使用。它观察顶层直接会话结果，不把 Memory 召回文本、Brain 上下文、维护任务、子 Agent 或原始工具输出当作学习来源。Harness 包不包含 Hermes、Python、飞书、Cron 或 Gateway 运行时。

设置摘要只读取一个无路径 Brain 快照。Remote 返回前先显示稳定占位行，之后仅展示 Provider 可用状态、有界计数与固定召回限制，不暴露数据库路径、项目路径、规则文本、记忆文本或 Provider 错误详情。

## Alternatives considered

- **让 Memory 与 MSE 分别注入** — 不采用，因为独立监听器无法执行统一总字节预算和事务归因，还会让召回内容形成自强化学习证据。
- **把事实、规则和兼容数据合并到一个数据库及插件** — 不采用，因为事实召回与流程学习的证据和生命周期不同，而旧数据库必须继续由用户所有并保持只读。
- **随 Desktop 打包 TencentDB 数据库或服务** — 不采用，因为全新安装不需要旧数据，打包用户状态会破坏所有权和隐私，固定的本地 SQLite 读取器已足以兼容。
- **默认维护流程使用模型生成语义压缩** — 本版本不采用，因为确定性的精确重复抽取可恢复、不会虚构事实，并且无需凭据或网络也能工作。

## Consequences

Desktop 获得唯一、有界、可检查的上下文路径，Memory 与 Evolution 继续独立持有状态，本地压缩可恢复，旧记忆召回保持可选，普通聊天也不依赖后台任务。Memory 0.2.0 与 Evolution 0.1.1 要求 Desktop 的 Brain 服务，不是独立注入器。精确重复压缩不会合并改写表达；不同绝对路径或符号链接写法会被有意视为不同项目。三个托管组件都会出现在插件市场中，其数据始终位于应用包外，并在应用替换或卸载后保留。
