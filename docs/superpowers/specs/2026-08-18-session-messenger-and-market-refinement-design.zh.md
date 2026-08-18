# 会话通信可见性与插件市场稳定分类设计

[English](2026-08-18-session-messenger-and-market-refinement-design.md) | 中文

**日期：** 2026-08-18

**状态：** 待实现

**目标：** Intel macOS 与 Windows x64 的 DeepSeek Harness Desktop 0.1.6

## 目标

跨会话投递继续作为持久 Agent 输入，但接收会话会把每条已领取 relay 显示为可见的 Harness 风格消息卡片，不再只显示折叠的通用上下文行。当前会话标题栏打开一个受约束的通信抽屉，用于复制 Session ID、向精确 Session ID 发送消息、回复指定投递和查看 receipt 状态。抽屉可以调整宽度，也不会从侧栏底部向外突出。

插件市场保留现有的紧凑列表。分类轨道按照一个固定顺序展示 live registry 返回的全部分类并支持横向滚动；选择分类只改变结果列表和选中状态，不改变标签位置或工具栏几何。

本轮优化保留[跨会话通信设计](2026-08-17-cross-session-agent-messaging-plugin-design.md)中的投递、恢复、回复、等待和拒绝语义，并以本文的界面和双平台验收取代其中仅提供紧凑底部 Client 入口与只交付 macOS 的范围。

## 选定方案

通信入口从 `sidebar.footer.action` 移到 `conversation.session.header.utilities`。标题栏按钮与未读标记通过 `shell.overlay` 打开插件自有抽屉，因此功能仍可独立卸载，也不替换会话内容、详情列、会话行或 Electron 外壳。普通桌面宽度下，拖动手柄把抽屉限制在 320 至 560 像素，并且只保存数值宽度偏好。窄窗口使用全宽 sheet 并禁用横向调整。关闭抽屉、切换会话、卸载插件或按 Escape 都会移除交互层，不修改 receipt 或会话。

现有 `user/message` 事件继续作为 relay 唯一的模型可见记录和会话内容权威。relay 内容由一个元数据文本块和随后的不可信正文文本块组成；模型按相同顺序接收文本，持久 source 则记录发送方 Session ID、delivery ID、投递模式和正文块索引。`ui-conversation` 的通用 relay 展示读取这些字段，并呈现包含发送方、正文、投递时间和有界操作的可见卡片；模型可见的投递元数据放在可展开详情里。缺少结构化字段的旧记录或外部 relay 继续使用现有 opaque context fallback。

该方案不创建第二个会话事件，不把 relay 复制成伪造的人类 `source.kind=user` 消息，也不根据 assistant 输出推断回复。因此一次投递只进入模型一次，也只在会话内容里出现一次。

## 通信抽屉与用户操作

抽屉提供三个紧凑视图：涉及当前会话的 receipt、已发送状态和最近失败。receipt 行展示发送方或目标 Session ID、投递模式、状态与时间；消息正文继续位于目标 inbox 或会话日志中，不加入现有 SSE 元数据流。选择已经领取的 relay 时，如果其持久卡片已加载，页面滚动到该卡片。尚未唤醒目标的 no-wake 投递标记为“待进入上下文”，不能显示成已读。

发送卡片接受一个精确目标 Session ID、一段不超过现有 16 KiB UTF-8 限制的正文，以及显式 wake 选项。新的精确同源 POST 路由复用每代 capability、精确 loopback origin 检查、无 CORS 策略、有界正文解析、普通会话解析、归档与子 Agent 拒绝、self-send 拒绝、速率限制、receipt 数量限制和 write-ahead coordinator。页面代 capability 授权本机用户操作；Client 提交界面当前显示的 Session ID，Host 在投递前验证该来源是可用普通会话，界面不提供其他来源选择器。blank、已归档、子 Agent、缺失或过期的来源不能发送。路由只返回投递状态，绝不宣称目标已阅读或回复。

“回复”使用同一个发送卡片并绑定某次 delivery。浏览器发送当前 Session ID、delivery ID、正文和 wake 选择；Host 从自己的 receipt store 获取一次性回复权限，并执行与 `reply_to_session` 相同的目标会话绑定。reply token 永不返回浏览器代码。发送或回复期间提交按钮禁用，失败后保留草稿，并显示有界 Harness 错误，不暴露 receipt 存储、凭据或其他会话内容。

标题栏标记与抽屉继续使用 receipt snapshot 和 SSE 更新。确认通知只改变未读状态，不删除 relay 卡片、消息、receipt 或已排队的 Agent 输入。

## 插件市场分类轨道

registry 是分类数量和本地化名称的权威，因此 Desktop 补丁不会另造一套分类体系，也不会限制可见分类数量。2026-08-18 的验收目录包含二十类，实际实现会渲染任意返回数量。“发现”工具栏按照 `全部` 加 registry 原始顺序渲染全部分类。`orderedCategories` 改为保持输入顺序，分类变化保留轨道的 `scrollLeft`，只更新查询并把结果页码重置为第一页。

分类容器使用单行不换行的原生横向滚动区。左右按钮每次滚动一个可见轨道宽度，并在各自边缘禁用；轻微的边缘渐隐提示仍有隐藏分类，同时不遮挡获得焦点的标签。触控板横向手势和 Shift 加滚轮直接使用原生滚动区。键盘焦点进入一个不可见的选中标签时，只滚动使其刚好可见的最小距离，绝不改变 DOM 顺序。筛选切换期间，工具栏高度、搜索框、分类轨道和结果列表起点保持固定。

所有返回分类均可通过键盘访问，选中状态不只依赖颜色，并在 200% 缩放下保持可见焦点。减少动画模式关闭平滑滚动。页面本身不会产生横向溢出。

## 失败与生命周期行为

Host companion 不可用时，标题栏入口仍可复制当前 Session ID；发送、回复、receipt 状态和未读确认会禁用，并显示一条连接诊断。重连通过 event ID 替换 receipt snapshot，不重复生成标记或卡片。路由或工具冲突仍会在 receipt 或会话产生任何修改前拒绝插件激活。

抽屉关闭或卸载时会清理 document listener、待执行 animation frame、resize observer 和活动请求。市场轨道随组件卸载清理 scroll 与 resize listener。Desktop 退出继续终止自己拥有的 Harness 进程树和随机端口服务。发布工作会关闭本任务拥有的构建服务、已挂载镜像、临时 smoke profile 和重复候选应用进程；不会终止 Codex、远程访问软件、Hermes 或其他无关用户应用。

## 验证与交付

聚焦 Client 测试覆盖标题栏注册、可见 relay 卡片、结构化正文 fallback、Escape 与焦点恢复、宽度限制与持久化、窄屏 sheet、发送与回复失败后的草稿、receipt 确认、键盘顺序、屏幕阅读器、减少动画和 200% 缩放。Host 测试覆盖精确 origin 与 capability 检查、正文限制、当前会话权限、普通目标解析、归档、子 Agent 与 self 拒绝、不向浏览器暴露 token 的回复绑定、恢复、卸载，以及拒绝时零修改。

市场测试覆盖全部 registry 分类的稳定顺序、选择后不重排 DOM、保留横向滚动位置、边缘按钮、键盘最小滚动、固定工具栏高度、窄容器和页面无溢出。现有安装、更新、激活、回滚、自我保护、主题、备份和活动记录行为保持不变。

packaged smoke 使用临时 `DSH_HOME` profile 验证一次普通跨会话发送、一张可见的已领取 relay 卡片、一次 receipt 绑定回复、一个 no-wake 待处理状态、归档与子 Agent 拒绝、选择前后精确分类顺序、抽屉调宽、随机端口启动、重启恢复和完整进程清理。Intel macOS 从同一提交生成 DMG，Windows x64 生成 per-user Setup。每个成品都在原生平台安装和验收，并在发布新的 `desktop-v0.1.6` 前从公开地址重新下载、核对大小和 SHA-256。

## 考虑过的替代方案

复用现有详情列可以直接继承拖动行为，但会与当前工具调用的输入和输出竞争位置，每次消息到达都需要切换模式。composer 弹层改动较小，但无法用合适宽度容纳历史记录和长消息。保留底部弹层可以沿用当前注册，却会继续出现向外突出的几何，也仍然把 relay 折叠起来。选定的标题栏入口与受约束抽屉不会影响工具详情，符合已确认布局，也保持功能可独立移除。

## 范围外

跨设备或跨 profile 通信、公共网络访问、广播、无限自动 Agent 对聊、原生系统通知、任意 GitHub 仓库安装、新插件分类服务、ARM macOS 打包、自动安装更新和终止无关用户进程不属于本轮优化。
