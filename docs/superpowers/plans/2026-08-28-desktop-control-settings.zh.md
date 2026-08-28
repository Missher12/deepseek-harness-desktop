# Desktop 控制设置实施计划

[English](2026-08-28-desktop-control-settings.md) | 中文

> **Agent 执行要求：** 必须使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 按任务实施。本计划用复选框（`- [ ]`）跟踪步骤。

**目标：** 移除误导性的浏览器与电脑控制汇总状态，分别展示能力、开启、权限与刷新状态，并在 macOS 上交付已确认的紧凑列表模块。

**架构：** Electron main 继续作为唯一 Authority，根据 Coordinator 能力、原生状态、应用枚举、持久化设置和当前控制状态生成一份冻结展示快照。严格的 Preload Bridge 只传递这份无路径快照与封闭意图；React 包渲染已确认的紧凑列表，并把故障限制在受影响的行。

**技术栈：** TypeScript、Electron IPC、React、CSS Modules、Vitest、Testing Library、双语 Markdown。

---

### 任务 1：替换汇总快照约定

**文件：**
- 修改：`apps/desktop/src/preload-api.ts`
- 修改：`apps/desktop/tests/preload-api.spec.ts`
- 修改：`packages/client/ui-desktop-control/src/client/contracts.ts`
- 修改：`packages/client/ui-desktop-control/src/client/store.ts`
- 修改：`packages/client/ui-desktop-control/tests/components.client.spec.tsx`

- [ ] **步骤 1：为独立状态结构编写失败的 Validator 测试。**

```ts ignore-check
const snapshot = {
  browser: { availability: 'available', enabled: false },
  computer: { availability: 'available', enabled: false },
  permissions: { screenViewing: 'granted', assistiveControl: 'granted' },
  refresh: { status: { state: 'ready' }, apps: { state: 'ready' } },
  ordinaryApps: [], emergencyAccelerator: 'CommandOrControl+Shift+F12',
  active: null, stopping: false,
}
expect(isDesktopControlUiSnapshot(snapshot)).toBe(true)
expect(isDesktopControlUiSnapshot({ ...snapshot, supported: true })).toBe(false)
expect(isDesktopControlUiSnapshot({ ...snapshot, leaseId: 'renderer' })).toBe(false)
```

- [ ] **步骤 2：运行 `pnpm exec vitest run apps/desktop/tests/preload-api.spec.ts packages/client/ui-desktop-control/tests/components.client.spec.tsx`；确认 Validator 仍要求 `supported`、`browserEnabled` 和 `computerEnabled`，因此进入 RED。**
- [ ] **步骤 3：在 Preload 与 Client 约定中加入精确的 `DesktopControlCapabilityState` 和 `DesktopControlRefreshState` 联合类型。所有嵌套对象必须是普通原型且键集合精确；失败消息最多 160 个 UTF-16 code unit；继续拒绝携带授权能力的扩展字段。**
- [ ] **步骤 4：更新 `EMPTY_DESKTOP_CONTROL_SNAPSHOT`：能力为未知、策略关闭、权限未知、两个刷新分支为检查中。**
- [ ] **步骤 5：重新运行聚焦测试与两个包的类型检查；预期 PASS。**
- [ ] **步骤 6：提交 `fix(desktop): separate control capability states`。**

### 任务 2：让 main 进程状态独立刷新并保留有效值

**文件：**
- 修改：`apps/desktop/src/control/control-coordinator.ts`
- 修改：`apps/desktop/src/control/ui-authority.ts`
- 修改：`apps/desktop/tests/control-coordinator.spec.ts`
- 修改：`apps/desktop/tests/computer-control-ui.spec.ts`

- [ ] **步骤 1：添加浏览器／电脑独立性与部分失败的 Authority RED 测试。**

```ts ignore-check
expect((await authority.snapshot()).browser).toEqual({ availability: 'available', enabled: false })
expect((await authority.snapshot()).computer).toEqual({ availability: 'available', enabled: false })
status.mockRejectedValueOnce(new Error('private native detail'))
expect((await authority.snapshot()).refresh.status).toEqual({ state: 'failed', message: 'Computer status could not be refreshed.' })
list.mockRejectedValueOnce(new Error('private app detail'))
expect((await authority.snapshot()).ordinaryApps).toEqual(lastValidApps)
```

- [ ] **步骤 2：运行 `pnpm exec vitest run apps/desktop/tests/control-coordinator.spec.ts apps/desktop/tests/computer-control-ui.spec.ts`；确认 Coordinator 状态缺少浏览器支持且 `Promise.all` 会合并两类失败，因此进入 RED。**
- [ ] **步骤 3：在 `DesktopControlCoordinatorStatus` 的 `computerSupported` 旁加入 `browserSupported`；两者只由对应生产 Adapter 推导。**
- [ ] **步骤 4：用分别 settled 的状态读取与列表读取替换合并 catch。Authority 实例只缓存冻结且已验证的最近有效原生状态和应用投影。首次读取失败时电脑能力为未知；后续失败保留最近有效值，只标记失败的刷新分支。绝不返回捕获到的原始错误文字。**
- [ ] **步骤 5：保持设置串行化和 main 原生确认不变。将封闭设置意图映射到返回快照中的 `browser.enabled` 与 `computer.enabled`。**
- [ ] **步骤 6：重新运行聚焦测试、`pnpm exec tsc -b apps/desktop/tsconfig.json --force` 与限定 Oxlint；预期 PASS。**
- [ ] **步骤 7：提交 `fix(desktop): preserve independent control status`。**

### 任务 3：渲染已确认的紧凑列表模块

**文件：**
- 修改：`packages/client/ui-desktop-control/src/client/components.tsx`
- 修改：`packages/client/ui-desktop-control/src/client/desktop-control.module.css`
- 修改：`packages/client/ui-desktop-control/src/client/locales.ts`
- 修改：`packages/client/ui-desktop-control/src/client/index.ts`
- 修改：`packages/client/ui-desktop-control/tests/components.client.spec.tsx`

- [ ] **步骤 1：为完整 B 版布局添加组件 RED 测试。**

```tsx ignore-check
const view = render(<DesktopControlSettings snapshot={snapshot} onMutation={mutate} onRetry={retry} />)
expect(view.getByText('2 capabilities available')).toBeTruthy()
expect(view.getByText('Available · Not enabled')).toBeTruthy()
expect(view.getByText('Screen Viewing')).toBeTruthy()
expect(view.getByText('Authorized applications')).toBeTruthy()
fireEvent.click(view.getByRole('button', { name: 'Retry status' }))
expect(retry).toHaveBeenCalledOnce()
```

- [ ] **步骤 2：运行 `pnpm exec vitest run packages/client/ui-desktop-control/tests/components.client.spec.tsx`；确认新的摘要、独立能力行与重试控件均缺失，因此进入 RED。**
- [ ] **步骤 3：实现六个有序区域：标题摘要、两行能力、macOS 权限、授权应用、紧急停止快捷键、当前控制。复用 Desktop Token；加入紧凑边框行、图标底座、状态标签、响应式换行、强制颜色、可见焦点，并避免横向滚动。**
- [ ] **步骤 4：只禁用确实不支持或正在提交的对应开关。可用、不可用、未知、已开启、未开启均使用文字和图标，不依赖颜色。停止始终无需批准，并显示停止中状态。**
- [ ] **步骤 5：设置 Seat 通过复用零参数 `getComputerControlStatus()` Bridge 调用公开 `retry()`。同一时刻只允许一次重试，忽略重复点击；刷新拒绝时保留最近快照，并显示 main 提供的重试状态。**
- [ ] **步骤 6：补齐中英文文案；测试键盘名称、失败与空状态、所有能力组合、控制进行中、停止和窄容器。**
- [ ] **步骤 7：运行组件测试、Client 包类型检查、Desktop 类型检查、限定 Oxlint 与 `git diff --check`；预期 PASS。**
- [ ] **步骤 8：提交 `feat(desktop): redesign control settings module`。**

### 任务 4：记录并验收 macOS 结果

**文件：**
- 修改：`packages/client/ui-desktop-control/README.md`
- 修改：`packages/client/ui-desktop-control/README.zh.md`
- 更新：`packages/client/ui-desktop-control/README.i18n.yaml`
- 新建：`.agents/notes/implemented/feature/2026-08-28-desktop-control-settings-status.md`
- 新建：`.agents/notes/implemented/feature/2026-08-28-desktop-control-settings-status.zh.md`
- 新建：`.agents/notes/implemented/feature/2026-08-28-desktop-control-settings-status.i18n.yaml`
- 测试：macOS 打包设置 smoke 与视觉截图证据

- [ ] **步骤 1：在 README 配对中记录独立可用性、开启状态、刷新保留与准确 Renderer 安全排除项。新增 implemented Agent Note，说明为何移除汇总 support，以及为何 main 保留最近有效展示状态。**
- [ ] **步骤 2：分别执行 `pnpm run verify-translation-pairing --write <english-path>` 重录两组配对，并运行 scoped pairing。**
- [ ] **步骤 3：运行聚焦测试、Desktop/Client 类型检查、限定 lint、`pnpm run constraints`、`pnpm run publint`、Agent Note 格式与分类、translation pairing 和 `git diff --check`。**
- [ ] **步骤 4：从最终候选构建 Intel macOS 应用。使用隔离的 Desktop 设置目录启动，验证两个已安装 Adapter 均显示“可用 · 未开启”，两个已授予权限分别显示；重试不折叠状态；分别开启能力时仍要求原生确认。采集完整模块的浅色与深色外观。**
- [ ] **步骤 5：只有自动与打包 smoke 全部通过后才安装验证应用。确认普通 Harness 聊天正常启动，控制模块不再显示汇总式“不可用”。**
- [ ] **步骤 6：提交文档与证据 `docs(desktop): record control settings status model`。**

### 任务 5：闭合电脑控制授权流程

**文件：**
- 修改：`packages/control/desktop-control-protocol/src/bridge.ts`
- 修改：`packages/control/desktop-control-protocol/protocol-v1.json`
- 修改：`packages/control/desktop-control-protocol/tests/codec.spec.ts`
- 修改：`packages/control/desktop-control-protocol/tests/codec-matrix.spec.ts`
- 修改：`native/computer-use-helper/crates/protocol/src/lib.rs`
- 修改：`apps/desktop/src/control/control-coordinator.ts`
- 修改：`apps/desktop/tests/control-coordinator.spec.ts`
- 修改：`packages/control/tool-computer-control/src/controller.ts`
- 修改：`packages/control/tool-computer-control/tests/tools.spec.ts`
- 修改：`packages/client/ui-desktop-control/src/client/components.tsx`
- 修改：`packages/client/ui-desktop-control/src/client/locales.ts`
- 修改：`packages/client/ui-desktop-control/src/client/desktop-control.module.css`
- 修改：`packages/client/ui-desktop-control/tests/components.client.spec.tsx`
- 修改：`packages/control/tool-computer-control/README.md`
- 修改：`packages/control/tool-computer-control/README.zh.md`
- 修改：`packages/client/ui-desktop-control/README.md`
- 修改：`packages/client/ui-desktop-control/README.zh.md`
- 新建：`.agents/notes/implemented/feature/2026-08-28-desktop-control-authorization-diagnostics.md`
- 新建：`.agents/notes/implemented/feature/2026-08-28-desktop-control-authorization-diagnostics.zh.md`

- [ ] **步骤 1：为安全拒绝清单编写 Protocol 与 Coordinator RED 测试。**

```ts ignore-check
expect(ERROR_CODES).toContain('CONTROL_DISABLED')
expect(ERROR_CODES).toContain('TARGET_NOT_AUTHORIZED')
expect(ERROR_CODES).toContain('APPROVAL_DENIED')
await expect(acquireWithNoAllowedApps()).rejects.toMatchObject({ code: 'TARGET_NOT_AUTHORIZED' })
expect(nativeApproval).not.toHaveBeenCalled()
```

- [ ] **步骤 2：运行聚焦 Protocol 与 Coordinator 测试；当前三项判断都会折叠成 `POLICY_DENIED`，因此预期进入 RED。**
- [ ] **步骤 3：将三个错误码加入权威 TypeScript Manifest 与 Rust 清单。只在原生应用 Surface 关闭时返回 `CONTROL_DISABLED`；非空原生请求经过 main 持有的白名单过滤后没有目标时返回 `TARGET_NOT_AUTHORIZED`；Electron 询问被取消时返回 `APPROVAL_DENIED`。浏览器与 Helper 的敏感目标策略继续使用 `POLICY_DENIED`。**
- [ ] **步骤 4：添加工具 RED 测试，分别输入三个精确 Provider 错误码，并断言长度受限、不会泄露原始细节的纠正提示。`POLICY_DENIED` 继续映射为目标受保护提示，`PERMISSION_DENIED` 映射为操作系统权限指引。**
- [ ] **步骤 5：实现工具映射并证明 `ComputerToolController` 仍只调用 `acquireLease`；它不得导入或调用 Harness `ApprovalService`，因此普通 `ask` 与 `never` 保持独立。**
- [ ] **步骤 6：为电脑控制可用且已开启、应用列表存在但均未允许的状态添加组件 RED 测试。断言页面醒目显示应用授权提示，并说明每个任务使用独立的原生批准。**
- [ ] **步骤 7：根据权威快照状态渲染指引，保留逐应用原生确认，并确保 UI 不包含租约、Session、窗口、引用或批准字段。只新增对应中英文文案并复用现有 Desktop Token。**
- [ ] **步骤 8：更新两组 README 配对并新增 implemented Agent Note。对每组变更执行 `pnpm run verify-translation-pairing --write <english-path>`。**
- [ ] **步骤 9：运行聚焦 Protocol／Coordinator／工具／UI 测试、Rust Protocol 测试、Desktop／Host／Client 类型检查、限定 Oxlint、GUI 测试、Web replay、constraints、publint、文档门禁和 `git diff --check`；所有本变更持有的检查必须通过。**
- [ ] **步骤 10：构建并安装 Intel macOS 候选。从零个允许应用开始，验证专用纠正提示且不打开原生任务询问；通过 GUI 允许 Chrome、批准原生任务询问，然后完成一次无害的 `computer_snapshot` → `computer_focus` → 新鲜引用 `computer_click`。**
- [ ] **步骤 11：提交实现 `fix(desktop): explain computer authorization denials`。**
