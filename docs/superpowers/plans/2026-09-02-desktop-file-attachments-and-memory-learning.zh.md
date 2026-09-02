# Desktop 文件附件与记忆和学习实施计划

[English](2026-09-02-desktop-file-attachments-and-memory-learning.md) | 中文

> **面向 agentic worker：** 必须使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 子技能逐项实施本计划。步骤使用 checkbox（`- [ ]`）跟踪。

**目标：** 为 DeepSeek Harness Desktop 交付 Provider 中立的文档附件、清晰的“记忆与学习”设置体验，并用发行门禁确保 Browser／Computer Control 不进入 Intel macOS 与 Windows x64 成品。

**架构：** 扩展现有附件 Service Definition 与本地 Provider，加入不可变文档存储和有界提取；新增持久 `document` 内容块，并在每个生产 LLM adapter 中投影为确定性文本。把输入框草稿附件从纯图片改为有序的图片或文档联合类型。保留现有 Brain Hub runtime，只改名并简化用户可见设置投影。

**技术栈：** TypeScript、React、Cordis、Typert Remote、Zod／Schemastery、PDF.js、fflate、fast-xml-parser、Vitest、Vite 浏览器 snapshot、Electron／electron-builder、NSIS、GitHub Actions。

---

### 任务 1：锁定发行范围与依赖

**文件：**
- 修改：`apps/desktop/tests/manifest.spec.ts`
- 修改：`apps/desktop/tests/packaged-smoke.ts`
- 修改：`scripts/stage-desktop.spec.ts`
- 修改：`packages/attachment/attachment-local/package.json`
- 修改：`pnpm-lock.yaml`

- [ ] **步骤 1：编写发行缺失测试**

增加断言，证明 Desktop 依赖、staged 文件、packaged 文件、设置行与模型工具目录均不含 `tool-agent-control`、`tool-browser-control`、`tool-computer-control`、`ui-desktop-control`、`control-runtime`、`computer-use-helper` 或 `extensions/chromium`。

- [ ] **步骤 2：运行测试并在缺少负向门禁处确认 RED**

运行：`pnpm exec vitest run apps/desktop/tests/manifest.spec.ts scripts/stage-desktop.spec.ts`

预期：新的 staged roster 断言会失败，直到实现精确禁止清单。

- [ ] **步骤 3：新增唯一精确的禁止产物清单并声明提取依赖**

发行 verifier 检查规范化的仓库相对路径与精确包名。为 `@deepseek-ai/dsh-attachment-local` 直接添加 `pdfjs-dist`、`fflate` 与 `fast-xml-parser` 依赖，不依赖传递包。

- [ ] **步骤 4：重新生成锁文件并确认 GREEN**

运行：`pnpm install && pnpm exec vitest run apps/desktop/tests/manifest.spec.ts scripts/stage-desktop.spec.ts`

预期：聚焦测试通过，供应链策略接受新增直接依赖。

### 任务 2：定义持久文档附件约定

**文件：**
- 修改：`packages/attachment/attachment/src/types.ts`
- 修改：`packages/attachment/attachment/src/error.ts`
- 修改：`packages/attachment/attachment/src/index.ts`
- 修改：`packages/attachment/attachment/src/admission.ts`
- 修改：`packages/attachment/attachment/tests/admission.spec.ts`
- 修改：`packages/attachment/attachment/tests/index.spec.ts`
- 修改：`packages/llm/llm/src/types.ts`
- 修改：`packages/llm/llm/tests/content.spec.ts`

- [ ] **步骤 1：编写约定与接纳 RED 测试**

覆盖闭集文档媒体类型、五文档／20 MiB／50 MiB 限制、规范显示名称、混合批次顺序、`document` 内容块类型，以及未知字段与非法数量拒绝。

- [ ] **步骤 2：确认 RED**

运行：`pnpm exec vitest run packages/attachment/attachment/tests packages/llm/llm/tests/content.spec.ts`

预期：测试因文档类型和 Service 方法不存在而失败。

- [ ] **步骤 3：实现最小 Provider 中立约定**

新增 `DocumentAttachmentRef`、`DocumentMediaType`、`SaveDocumentAttachment`、`StoredDocumentAttachment` 与 `DocumentAttachmentLimits`。为 `AttachmentStore` 增加 `documentLimits`、`validateDocument`、`saveDocument(s)` 与 `readDocument`。为 `ContentBlockMap` 增加 `{ type: 'document'; attachment: DocumentAttachmentRef }`。

- [ ] **步骤 4：验证 GREEN 与严格类型**

运行：`pnpm exec vitest run packages/attachment/attachment/tests packages/llm/llm/tests/content.spec.ts && pnpm --filter @deepseek-ai/dsh-attachment typecheck`

预期：聚焦测试与包 typecheck 通过。

### 任务 3：实现不可变本地提取

**文件：**
- 新建：`packages/attachment/attachment-local/src/document.ts`
- 新建：`packages/attachment/attachment-local/src/document-store.ts`
- 新建：`packages/attachment/attachment-local/src/ooxml.ts`
- 新建：`packages/attachment/attachment-local/src/pdf-extraction.ts`
- 新建：`packages/attachment/attachment-local/src/pdf-isolate.ts`
- 新建：`packages/attachment/attachment-local/src/pdf-protocol.ts`
- 新建：`packages/attachment/attachment-local/src/pdf-worker.ts`
- 新建：`packages/attachment/attachment-local/tsdown.config.ts`
- 新建：`packages/attachment/attachment-local/tests/document.spec.ts`
- 新建：`packages/attachment/attachment-local/tests/ooxml.spec.ts`
- 新建：`packages/attachment/attachment-local/tests/pdf-isolate.spec.ts`
- 新建：`packages/attachment/attachment-local/tests/pdf-isolate.built.e2e.ts`
- 修改：`packages/attachment/attachment-local/src/index.ts`
- 修改：`packages/attachment/attachment-local/src/invariant.ts`
- 修改：`packages/attachment/attachment-local/README.md`
- 修改：`packages/attachment/attachment-local/README.zh.md`

- [ ] **步骤 1：编写提取器与存储 RED 测试**

Fixture 覆盖 UTF-8 文本／代码、小型 PDF、DOCX 文本、XLSX shared strings 与已存值、Windows 风格名称、确定性截断、digest 校验、加密／宏／旧格式／二进制拒绝、ZIP 路径穿越、过大 entry、过多 entry 与损坏存储字节。

- [ ] **步骤 2：确认 RED**

运行：`pnpm exec vitest run packages/attachment/attachment-local/tests/document.spec.ts packages/attachment/attachment-local/tests/ooxml.spec.ts`

预期：新提取器和存储模块不存在，产生 module-not-found 失败。

- [ ] **步骤 3：实现有界提取与存储**

纯文本使用 fatal UTF-8 解码。PDF.js 在单独打包的 Worker 中按顺序提取页面文本，并受 30 秒墙钟期限、128MiB V8 old-generation 上限及页数／item／输出工作量约束。OOXML 提取使用有界 fflate entry 与 fast-xml-parser，只读取必要的文档／workbook 部件，忽略宏与外部关系，绝不计算公式。Provider 在自有目录用 SHA-256、owner-only 临时写和原子 rename 保存源字节与提取字节。

- [ ] **步骤 4：验证 GREEN 与覆盖率**

运行：`pnpm exec vitest run packages/attachment/attachment-local/tests --coverage.enabled --coverage.include=packages/attachment/attachment-local/src/**`

预期：全部本地附件测试通过，新增提取文件达到完整分支覆盖或只含有理由的不可达排除。

### 任务 4：通过已认证 prompt wire 传递文档

**文件：**
- 修改：`packages/host/apiproxy/src/api/sessions.ts`
- 修改：`packages/host/apiproxy/src/api/sessions.schema.ts`
- 修改：`packages/host/apiproxy/src/api-proxy.ts`
- 修改：`packages/host/apiproxy/tests/client-handler.spec.ts`
- 新建：`packages/host/apiproxy/tests/api-proxy-renderer-attachments.spec.ts`
- 修改：`packages/client/runtime/src/client/contract/session.ts`
- 修改：`packages/client/connection/src/client/fixture.ts`

- [ ] **步骤 1：编写 prompt wire RED 测试**

覆盖 canonical base64、精确字段、媒体／名称限制、混合有序批次、无效成员原子拒绝、附件 Service 缺失、取消与零路径泄漏。

- [ ] **步骤 2：确认 RED**

运行：`pnpm exec vitest run packages/host/apiproxy/tests/client-handler.spec.ts packages/host/apiproxy/tests/api-proxy-renderer-attachments.spec.ts`

预期：文档 prompt part 无法通过当前 schema。

- [ ] **步骤 3：实现文档 prompt 接纳**

新增严格 `document` 请求 part，并让 `durablePromptContent` 在发布有序持久内容块前验证全部图片／文档输入。图片与文档在 300MiB HTTP 上限之下共享 296MiB canonical base64 载体上限；renderer 与 Host 都会在解码前执行检查，renderer 文件读取保持串行。所有附件写入继续由现有 per-agent admission owner 串行化，避免 steering 与 queue prompt 交错一个批次。

- [ ] **步骤 4：验证 GREEN**

运行：`pnpm exec vitest run packages/host/apiproxy/tests packages/client/connection/tests && pnpm --filter @deepseek-ai/dsh-api-proxy typecheck`

预期：wire、Host 与 client 约定测试通过。

### 任务 5：把文档投影到模型请求

**文件：**
- 修改：`packages/llm/llm/src/content.ts`
- 修改：`packages/llm/llm/tests/content.spec.ts`
- 修改：`packages/llm/llm-deepseek/src/serialize.ts`
- 修改：`packages/llm/llm-deepseek/tests/serialize.spec.ts`
- 修改：`packages/llm/llm-pi-ai/src/context.ts`
- 修改：`packages/llm/llm-pi-ai/tests/context.spec.ts`

- [ ] **步骤 1：编写确定性投影 RED 测试**

断言稳定文件名／媒体／截断标签、完整性失败、嵌套 tool result、精确源顺序、取消、无原始路径，以及 DeepSeek 与 pi-ai adapter 的相同文本。

- [ ] **步骤 2：确认 RED**

运行：`pnpm exec vitest run packages/llm/llm/tests/content.spec.ts packages/llm/llm-deepseek/tests/serialize.spec.ts packages/llm/llm-pi-ai/tests/context.spec.ts`

预期：当前实现会忽略 document block。

- [ ] **步骤 3：实现唯一共享的瞬时文档投影**

`projectDocumentsForRequest()` 只读取一次每个唯一引用、校验后把每个出现位置替换成确定性带标签文本块。最新消息优先获得文档预算，同一消息内的附件顺序保持稳定。精确解析出的 route context 与输出预留限制最终展开；无法容纳的文档变为确定性的仅元数据占位文本。两个 adapter 都在现有图片转换前调用该投影。未知 merge-extensible 内容块保持现有行为。

- [ ] **步骤 4：验证 GREEN**

运行步骤 2 的聚焦测试，并 typecheck 三个 LLM 包。

预期：两个 adapter 暴露相同文档文本，并保持图片行为。

### 任务 6：泛化输入框与会话 UI

**文件：**
- 修改：`packages/client/ui-conversation/src/client/input/contract.ts`
- 修改：`packages/client/ui-conversation/src/client/input/machine.ts`
- 修改：`packages/client/runtime/src/client/sessions/conversation.ts`
- 修改：`packages/client/ui-conversation/src/client/skeleton/InputBar.tsx`
- 修改：`packages/client/ui-conversation/src/client/contract/slots.ts`
- 修改：`packages/client/ui-attachment/src/client/ComposerAttachments.tsx`
- 新建：`packages/client/ui-attachment/src/DocumentChip.tsx`
- 新建：`packages/client/ui-attachment/src/DocumentChip.module.css`
- 修改：`packages/client/ui-attachment/src/client/MessageImages.tsx`
- 修改：`packages/client/ui-conversation/src/client/locales.ts`
- 修改：两个包下相关 client 测试

- [ ] **步骤 1：编写 UI 与状态 RED 测试**

覆盖混合顺序、拖入遮罩、选择器 accept 清单、批次原子失败、文档 chip 语义、键盘移除、图片预览保持、草稿恢复、发送／清空、queue／steer，以及本地化的不支持／过大／提取失败错误。

- [ ] **步骤 2：确认 RED**

运行：`pnpm exec vitest run packages/client/ui-attachment/tests packages/client/ui-conversation/tests/input-bar.client.spec.tsx packages/client/ui-conversation/tests/input-scenarios.client.spec.tsx`

预期：文件拖入仍被当前纯图片路径过滤。

- [ ] **步骤 3：实现唯一有序的草稿附件联合类型**

泛化草稿 ID 与 controller 存储，不复制图片和文档状态机。保留图片灯箱行为。新增文件 chip，并且只在明确 prompt 请求中传递文档字节。

- [ ] **步骤 4：验证 GREEN 与组装 snapshot**

运行：`pnpm run test:gui && DSH_SNAPSHOT=replay pnpm run test:web`

预期：GUI 与 replay snapshot 在有意的本地化附件更新后通过。

### 任务 7：重命名并简化“记忆与学习”

**文件：**
- 修改：`packages/client/ui-settings-brain/src/client/BrainSettingsSection.tsx`
- 修改：`packages/client/ui-settings-brain/src/client/BrainSettingsSection.module.css`
- 修改：`packages/client/ui-settings-brain/src/client/locales.ts`
- 修改：`packages/client/ui-settings-brain/tests/apply.client.spec.tsx`
- 修改：`packages/client/ui-settings-brain/README.md`
- 修改：`packages/client/ui-settings-brain/README.zh.md`
- 修改：`apps/desktop/desktop.cordis.patch.yml`
- 重新生成：受影响的 Web snapshot 与文档 catalog

- [ ] **步骤 1：编写可见文案 RED 测试**

断言 `Memory & Learning`／`记忆与学习`、两个真实 Provider 行、白话解释、无可见 `External Brain`、无 Provider ID／路径／原始错误，以及不变的不含路径 snapshot 调用。

- [ ] **步骤 2：确认 RED**

运行：`pnpm exec vitest run packages/client/ui-settings-brain/tests apps/desktop/tests/manifest.spec.ts`

预期：当前标题和导航仍为 External Brain／外置大脑。

- [ ] **步骤 3：实现纯呈现修改**

重命名文案，并把兼容细节缩减为辅助文本。不改变 Brain Hub 接口、Provider 顺序、召回限制、注入文本、数据库所有权或失败行为。

- [ ] **步骤 4：验证 GREEN 并刷新派生产物**

运行聚焦测试、`pnpm run gen-tool-catalog`、相关 snapshot refresh 命令，以及所有已编辑双语文件的 pairing write。

预期：源码与生成的用户可见输出使用新名称，内部标识保持稳定。

### 任务 8：记录、打包并推送分支

**文件：**
- 新建：`.agents/notes/implemented/feature/2026-09-02-desktop-document-attachments-and-memory-learning.md`
- 新建：中文 counterpart 与 i18n 记录
- 修改：`PROJECT_CONTEXT.md`
- 修改：`apps/desktop/README.md`
- 修改：`apps/desktop/README.zh.md`
- 仅在发行版本门禁要求时修改 release metadata

- [ ] **步骤 1：记录已交付决定和限制**

记录持久 document block、提取限制、拒绝格式、控制产品缺失、用户可见命名以及独立的 macOS／Windows 证据要求。在真实运行前不声称旧版 Office、任意压缩包、裸 Provider 文件或 Windows 原生验收。

- [ ] **步骤 2：运行聚焦与产品验证**

运行附件、Host、LLM、GUI、Brain、Desktop manifest／stage、snapshot replay、Host／Client／Desktop 构建、scoped lint、文档同步、依赖策略与 `git diff --check`。

预期：全部命令以 `0` 退出；明确列出任何平台 skip。

- [ ] **步骤 3：构建并 smoke macOS 产物**

使用临时 `DSH_HOME` 运行 official Desktop stage 与隔离 packaged smoke。检查 `app.asar`、附件提取资产、设置导航与控制产物缺失。

预期：Intel macOS packaged smoke 通过，不触碰日常安装应用或真实用户数据。

- [ ] **步骤 4：提交并推送**

运行仓库 pre-push skill，提交内聚修改，推送 `codex/dsh-next-desktop` 并向 `main` 创建 GitHub PR。在同提交具备 Windows 原生证据前，不打 tag 或发布 release asset。

- [ ] **步骤 5：从同一提交运行 Windows 原生 CI**

触发现有 Windows workflow，并要求 Setup 构建、隔离安装、启动、文档拖入场景、设置名称、进程清理、卸载与用户数据保留。

预期：Windows 证据标识精确 pushed commit；失败保持开放，绝不由 macOS 或 cross-compile 输出替代。
