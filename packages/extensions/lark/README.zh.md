# @deepseek-ai/dsh-lark

[English](README.md) | 中文

这是一个可独立安装的 DeepSeek Harness Bundle。显式配对的唯一飞书/Lark 所有者可以在私聊里进入现有的普通 Harness Session，并在原项目中继续开发。插件复用该 Session 原有的 Agent、审批策略、沙箱、工具、模型、历史和项目目录；不嵌入 OpenClaw，不创建第二套 Agent 运行时，也不会向未配对用户暴露项目数据。

## 安装

在本仓库构建并打包，再把 tarball 加入 `web` Profile：先运行 `pnpm --filter @deepseek-ai/dsh-lark bundle`，再运行 `pnpm --filter @deepseek-ai/dsh-lark pack --pack-destination ./artifacts`，最后运行 `dsh plugin --profile web add /absolute/path/to/artifacts/deepseek-ai-dsh-lark-0.1.1-rc.2.tgz`。

安装后重启 Harness。该事务会同时写入包依赖和 `dsh.profile.bundles` 层。它不是 Desktop 强制内置插件，可以独立移除。

## 飞书/Lark 应用设置

创建企业自建应用，启用机器人能力，并选择 WebSocket/长连接接收事件。只订阅：

- `im.message.receive_v1`
- `card.action.trigger`

为应用开通机器人收发消息权限 `im:message`。需要图片/文件输入时再开通 `im:resource`。发布应用版本，并把机器人可用范围限制为预期的所有者账号。可以选配名为 `进入项目` 的机器人菜单，它与 `/` 走相同的快速路径。

在 Harness 设置 → 飞书远程开发中输入 App ID 和 App Secret。密钥只写入 Harness 凭据库，不会返回浏览器、插件状态、日志或卡片。需要时在插件配置里选择 Feishu 或 Lark 域，然后启用插件。

首次接受的私聊会收到一个短配对码；请在 Harness 设置中本地输入该配对码。只有精确匹配的 `open_id` 和私聊 ID 才能读取项目/会话信息或提交开发任务。群聊、机器人回声、其他账号、过期或重放的卡片操作、旧代次操作，都会在读取项目数据前被拒绝。

## 进入项目和 Session

发送精确的 `/`、`/进入`、`/切换`，或点击 `进入项目` 菜单。插件会直接发送不经过模型的项目卡片。先选择显示完整路径的项目，再选择一个现有的普通未归档 Session；运行中的 Session 优先。已归档、已删除、空白、子 Agent、项目目录不匹配的 Session 不会显示，点击时还会再次校验。最终的所有者/私聊/项目/Session 绑定会跨重启持久化。

之后普通文字会成为该精确 Session 中的一次远程 Harness turn，并在会话历史中显示为与本地文本框发送结果相同的用户消息。每条接受的飞书事件会先持久化，并预先创建 Harness Message ID。消息严格按飞书原顺序逐条投递；只有序号 N 被目标 Session 领取并观察到它精确对应的 `turn/end` 后，才会提交 N+1。重启恢复时先核对现有 inbox 和 Session 历史，再复用相同 Message ID，避免主动重复不确定状态下的投递。

活动绑定存在前，普通文字不会进入持久队列。机器人会回复当前绑定状态并提示所有者发送 `/`，而不是让飞书回调失败。

图片只会在所有者校验通过后下载，通过 Harness AttachmentStore 校验并保存为持久图片引用。普通文件默认上限 30 MiB，以 `0600` 权限存放在 `$DSH_HOME/lark/files`，Agent 会收到私有临时路径和 SHA-256；默认保留七天。插件不会自动把附件写入已选择的项目。

## 命令与输出

- `/` 或 `/进入`：不调用模型，选择项目和 Session。
- `/切换`：重新打开项目选择。
- `/解绑`：解除当前 Session 绑定。
- `/状态`：向已配对所有者显示当前绑定。
- `/插话 <内容>`：通过现有 Agent 对正在运行的 Session 插话。
- `/停止`：取消当前远程 turn，只移除尚未领取的 `dsh-lark` 消息，保留其他 inbox 工作。
- `/帮助`：显示精简命令帮助。

每个 Harness turn 只对应一张飞书交互卡片。卡片先稳定显示占位内容，再以打字机效果流式更新可见回复、安全的工具名称/状态、耗时、精确的模型 ID/提供方/推理档位，以及可用时的真实 Harness 输入/输出/缓存 token 用量。中间投影会在已配置间隔内合并为最新状态，不会为每个模型分片排队一次飞书 patch；终态投影会取消待触发计时器，并且最多只等待一个已经在途的卡片请求。模型路由先取自所选 Session 的持久 request header，再由实际 assistant 消息校正，因此中途切换模型也会反映到同一张卡片。思考内容、system 消息、环境变量、原始工具参数/结果、密钥和无限制日志不会投影到飞书。建卡或更新失败时只会降级一次有长度上限的文本回复。

Harness 审批复用现有 ApiProxy 审批记录。飞书端只提供“允许一次”和“拒绝”，桌面端或飞书端第一个合法响应获胜，不增加“始终允许”权限。

## 停用、恢复与卸载

在 Harness 设置中停用后，插件会拒绝新入口、关闭 WebSocket 和 mux 流、停止卡片计时器，并暂停尚未投递的远程队列。重新启用时不会偷偷重放，必须在本地点击“恢复队列”。完整退出 Harness 后不会留下接收器或后台守护进程。

“清除数据”只删除插件自有的所有者、绑定、队列/卡片/nonce 元数据和私有暂存文件，不会删除 Harness 项目、Session、Session 消息、凭据或其他来源的 inbox 条目。卸载命令是 `dsh plugin --profile web remove @deepseek-ai/dsh-lark`。

移除后重启 Harness。包依赖和 Bundle 层会一起消失，普通 Session 保持不变。

## 验证边界与署名

离线测试覆盖所有者门禁、签名操作、普通 Session 校验、持久 FIFO/重启对账、卡片、审批、附件、设置生命周期、Loader 组合和 Profile 移除。真实飞书验收必须使用用户在 Harness 内输入的 App 凭据；测试不得从 OpenClaw 或 Hermes 导入凭据。

实现使用官方 `@larksuiteoapi/node-sdk`。WebSocket 生命周期和合并式卡片刷新调度器参考了采用 MIT 许可证的 `@larksuite/openclaw-lark` `2026.7.16`；本包是独立的 Harness 实现，不打包也不依赖 OpenClaw-Lark。参见 [LICENSE](LICENSE#third-party-notices)。

## 模型体验

### 远程所有者 turn

#### 模型看到的内容

插件不注册模型工具、system prompt 或隐藏指令。每条被接受的普通飞书消息都会在已选择的 Session 中成为一条带 `source.kind=user` 的普通可见 user-role turn；配对所有者与传输事实只保留在插件自有存储中，不会进入模型上下文。已准入图片表现为持久 Harness 图片附件；已准入普通文件只会加入所有者文字，以及私有暂存路径、显示名称、SHA-256 和到期时间。飞书身份值、配对码、凭据、卡片 action 值、传输诊断、原始工具 payload 和思考过程都不会加入模型上下文。

#### Token 影响

被接受的远程 turn 会加入与本地 turn 等价的用户文字和已准入附件描述；之后所选 Agent 的普通回复、工具调用和结果继续遵循该 Session 的既有保留策略。设置界面、传输层、项目卡片、队列元数据、配对状态和飞书流式投影不增加模型 token。卡片会报告实际 Harness 模型路由和 token 用量，但不会把这份报告再次送回 Session。

#### KV Cache 影响

启用插件不会改变模型的静态 prompt 或工具定义前缀。每条已领取的远程消息都追加在既有 Session 尾部，因此与本地用户 turn 一样保留此前前缀的缓存能力；切换绑定只会改变后续尾部内容进入哪个既有 Session。

## 已知限制与暂缓事项

- 一个插件实例只支持一个已配对所有者、一个精确私聊和一个活动项目/Session 绑定；群聊、多所有者、并发绑定、广播和公网控制均有意不支持。
- 真实飞书/Lark 验收仍需要用户创建企业自建应用、发布权限，并在 Harness 本地输入凭据；本包绝不会导入旧 OpenClaw 或 Hermes 凭据。
- 普通文件使用只在 Harness 主机可用的私有临时路径，并在配置的保留期后到期；插件不会把任意本地项目文件上传回飞书，也不会自动把收到的文件复制进项目。
- 飞书端只对既有 Harness 审批提供“允许一次”和“拒绝”。持久权限变更、“始终允许”授权、Session 创建、已归档/子 Agent 选择和自主后台开发均未实现。
