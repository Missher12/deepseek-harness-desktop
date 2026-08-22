# 插件安装事务恢复实施计划

[English](2026-08-20-plugin-install-transaction-recovery.md) | 中文

> **供 Agent 工作进程使用：** 必须使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans，逐项实施本计划。步骤使用复选框（`- [ ]`）跟踪。

**目标：** 防止插件市场失败操作留下会让应用下次启动损坏的幽灵 bundle，并为已有残留提供受保护的修复路径。

**架构：** 把 `dependencies` 与 `dsh.profile.bundles` 视为同一个清单事务。在包管理器修改前同时快照，在所有未提交结果中同时恢复；只有同时满足外部 bundle、没有对应依赖、没有已安装包目录时，才判定为可修复残留。

**技术栈：** TypeScript、Node.js 文件系统 API、dshmarket HTTP 路由与 React 客户端、Vitest、pnpm patch。

---

## 文件映射

- `apps/desktop/node_modules/dshmarket/src/profile.ts`：清单事务快照、恢复、残留检测与修复前备份原语。
- `apps/desktop/node_modules/dshmarket/src/routes.ts`：安装/更新事务边界和受保护修复端点。
- `apps/desktop/node_modules/dshmarket/src/client/MarketSection.tsx`：残留提示和显式修复动作。
- `scripts/dshmarket-profile-transaction.spec.ts`：针对已修补包源码和路由的回归测试。
- `patches/dshmarket@1.10.1.patch`：供打包构建复现的 pnpm patch。

### 任务 1：复现幽灵 bundle 故障

- [ ] 创建一个 fixture profile，包含内置 bundle，以及同时位于 `dependencies` 和 `dsh.profile.bundles` 的外部载体。
- [ ] 模拟同时改动两个字段的包管理器失败，并断言精确恢复操作前清单。
- [ ] 增加取消、超时和安装后验证拒绝案例；确认新测试在当前仅恢复依赖的实现上失败。
- [ ] 增加残留分类测试，覆盖缺失外部载体、已声明依赖、包目录存在和内置 bundle。

### 任务 2：让插件市场修改成为事务

- [ ] 用包含克隆后依赖和 bundle 名单的类型化快照替代仅依赖快照。
- [ ] 同时恢复两个字段，并保留其他清单键以及快照中精确的内置和无关条目。
- [ ] 在所有非验证成功提交的结果中执行回滚，包括取消和超时。
- [ ] 保持验证成功安装被提交，并保持更新防降级和自保护行为不变。

### 任务 3：增加受保护的残留修复

- [ ] 从已安装端点返回可修复与有歧义的 bundle 诊断。
- [ ] 增加同源 POST 修复端点，只接受已经被分类为可修复的 bundle 名称。
- [ ] 删除精确 bundle 条目前先创建带时间戳的 profile 清单备份；绝不删除包存储内容。
- [ ] 增加显式客户端提示和修复按钮，成功后显示需要重启的文案。

### 任务 4：重建并验证补丁

- [ ] 构建 dshmarket，使 Host 与客户端产物和修改后的源码一致。
- [ ] 通过仓库的 pnpm patch 流程重新生成 `patches/dshmarket@1.10.1.patch`。
- [ ] 运行新事务套件，以及 `dshmarket-self-protection`、客户端布局、客户端产物和 Desktop 暂存套件。
- [ ] 验证隔离 profile 不再保留失败载体 bundle，真实恢复后的应用打开时没有插件加载器错误。

### 任务 5：记录当前状态

- [ ] 在 `PROJECT_CONTEXT.md` 记录事务不变量、修复规则、当前实时恢复和测试证据。
- [ ] 运行本计划的翻译配对检查与聚焦文档检查；分开报告无关的既有全库失败。
