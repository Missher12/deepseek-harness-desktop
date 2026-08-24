# Agent Note: 本地外置大脑 Provider Hub

Status: proposed

[English](2026-08-24-local-external-brain.md) | 中文

## 问题

Desktop 已经发布带可选只读 TencentDB 兼容来源的审核记忆插件，而 Harness-native Missher Evolution System 拥有流程规则。如果两个插件分别注入，Provider 完成顺序可能改变提示词顺序，重复事实会消耗两次上下文，单个阻塞 Provider 会拖慢对话，而且即使另一个监听器拒绝步骤，Provider 仍可能把项目标为已使用。反过来合并数据库又会抹掉各来源拥有的不同审核、生命周期、删除和学习保证。

既有的 [Desktop 个性化、计费与记忆决策](../../../implemented/feature/2026-08-24-desktop-personalization-billing-memory.md)继续负责审核记忆捕获和 TencentDB 只读边界。本提案扩展组装与注入，不取代该决策。

## 提案

Desktop 0.3.8 将依次组装 `dsh-missher-brain@0.1.0`、`dsh-missher-memory@0.2.0` 和 `dsh-missher-evolution@0.1.1`。Brain Hub 暴露一个有版本的 Provider 约定，并拥有唯一的外置大脑 `agent/pre-step` 监听器。Memory 拥有事实候选项、FTS 召回、可回滚胶囊和内置兼容 Reader。Evolution 拥有 Candidate-to-Trial-to-Active 流程学习。任何 Provider 都不读取或写入另一个 Provider 的状态。

Provider 在无副作用情况下准备不透明候选项。Hub 校验存活 Provider 的身份、版本和预算；依次把固定项、当前审核记忆、胶囊、活跃规则和 legacy 召回排序；抑制规范化后的完全重复项；最多选择六条记录或包含完整渲染在内的 4,000 UTF-8 bytes。Hub 只接受已选择的不透明 handle，并取消废弃批次。Provider 错误、截止时间、取消、接受失败和清理失败都会返回原始下游决策。

召回只在具备项目工作目录的顶层直接用户轮次首步运行。Provider 收到无路径项目 hash，而不是原始目录。注入消息在不受信任背景块中为每项标出来源、引用和时间。持久 Subagent 子会话从不自动召回，MSE 也绝不把召回、legacy、整理或其他插件生成的上下文当作训练输入。

## 状态与维护边界

Memory schema 2 将在插件隔离状态数据库中保留已审核 atom、胶囊、胶囊到来源的关联和维护历史。自动整理只考虑同一项目、scope 与兼容 kind 中较旧且已审核的活跃 atom。固定、近期、待审核、敏感、冲突和 legacy TencentDB 行都不符合条件。成功胶囊会在同一事务中归档而非删除来源 atom；回滚会废弃胶囊并重新激活所有来源。

兼容 Reader 代码会随两个原生安装包发布，但 `vectors.db` 永远不会。它只以只读模式打开用户明确连接的外部数据库，拒绝符号链接或 containment 逃逸，不加载扩展，也不暴露任何修改协议。全新安装不需要 TencentDB。

## 考虑过的替代方案

**让 Memory 与 MSE 保留独立 pre-step 监听器。** 拒绝，因为监听器顺序、重复预算、副作用时机和失败隔离会变成 Provider 私有行为，并可能在后续更新中分叉。

**把事实记忆、legacy vectors 和学习规则合进一个数据库。** 拒绝，因为事实审核、只读兼容和流程晋升有不同权限与删除语义。共享数据库会让隔离与回滚更难证明。

**Fork Harness 核心。** 拒绝，因为 Provider Registry、waterfall 监听器、设置 Section 与不可变 Desktop 组装已提供足够扩展点。核心 fork 会明显增加上游更新难度，却没有增加必需能力。

**在安装包中放入真实 TencentDB 数据库或安装时迁移它。** 拒绝，因为个人数据绝不能进入公开产物，安装也不能修改独立拥有的来源。

**连接 Obsidian 或远程知识服务。** 本版本拒绝，因为用户选择的是本地外置大脑。远程同步、认证和知识库权限会扩大信任边界。

## 验收标准

- Brain Hub 拒绝无效与重复 Provider，只移除精确注册，使用确定性的完整 byte 仲裁，并达到 100% Host 聚焦覆盖率。
- 超时、中止、异常候选项、接受失败、取消失败和无 Provider 都保持原始会话决策不变。
- Memory 迁移为增量且可恢复；整理有界、事务化、保留来源并可回滚。
- TencentDB fixture 和任何明确检查的真实来源在搜索与维护前后都逐字节相同；全新安装无需来源数据库。
- MSE 只学习直接且符合条件的反馈，绝不学习召回或维护文本。
- Mac Intel 与 Windows x64 安装包来自同一公开 Desktop 0.3.8 提交，通过原生安装生命周期 smoke，并保留隔离用户状态。

## 风险

外置大脑上下文会降低召回轮次的前缀缓存复用，自动整理即使保留来源关联也可能丢失细微差别。完整 byte 上限、明确来源提示、严格资格、胶囊校验、归档而非删除以及一键回滚共同约束这些成本。150 ms Provider 截止时间可能在慢磁盘上省略有用上下文；相比等待或注入迟到状态，优先保证 fail-open 对话连续性。
