# Agent Note: 思考全文进入阅读流

Status: implemented

[English](2026-09-22-reasoning-full-length-reading.md) | 中文

## Problem

思考内容此前由两层独立的展开控件承载。`ReasoningRow` 自带固定高度的滚动容器、遮罩、展开/收起按钮、箭头和"跟随最新"控件；其上，Turn 过程折叠会把范围内所有行隐藏，包括带思考的 Assistant 行，而最终回答自身的思考又被单独隐藏一层。读者要先打开一个控件、再滚动第二个滚动容器，才能读到模型已经完整送达的思考；同时，会话自身的尾部跟随逻辑还会与内层滚动容器互相拉扯。

## Decision

思考是阅读流中的原文文本。`ReasoningRow` 只渲染静态标题和一个自然增高的正文：没有按钮、没有箭头、没有 `role="region"` 滚动容器、没有 `max-height`、没有遮罩、没有截断、没有内部滚动，也没有跟随控件。会话自身的滚动容器是唯一的阅读滚动，其既有的尾部跟随逻辑继续尊重用户操作。

Turn 过程折叠不再覆盖思考。`TURN_PROCESS_MEMBER_KINDS` 列出过程范围可折叠的种类——`assistant-step`、`tool-call`、`context`——并取代此前"凡非独立种类皆可折叠"的判断（旧判断会把锚点落在范围内的提示、错误与尾部行一并纳入）。此外，Assistant 数据带思考的行永不被覆盖，因此带思考的最终回答、以及思考与正文混排的过程行，无论折叠是否打开都保持可见。只有当 `processPresentation.hasExternalProcess` 为真时，Turn 才有折叠控件，因此仅以思考为过程证据的 Turn 不会再出现过程控件。`TurnProcessSpec.inlineReasoning` 仍作为事实记录在 wire 与日志中，但不再决定显示方式。

当某块是流式尾部时，`useRevealedText` 逐帧绘制逐渐增长且按字素对齐的前缀。可见正文是读屏与选择通道；`data-reasoning-full` 只为诊断与测试记录已接收文本，不提供完整文本的阅读或复制交互。终态、暂停和减少动态效果时绘制完整文本。帧通过 `requestAnimationFrame` 调度，并按经过的时间推进，因此显示速率来自经过时间，而不是帧数或固定间隔。

## Reveal budget

`REVEAL_CLUSTERS_PER_SECOND` 为 240。`CATCH_UP_CLUSTERS` 与之相等：显示最多欠模型约一秒的打字量，之后便欠读者整个分块——超过预算的积压在一帧内整体绘制，而等待超过 `BACKLOG_CHASE_MS`（300 毫秒）的积压无论大小都会追齐。扩展上一段文本的分块保留已绘制计数，因此流式追加会继续播放；替换文本的分块则重新开始，因为该计数描述的是它所测量文本的前缀。`Draft` 使用 `Intl.Segmenter` 分段，并保留足以让新补全的代理对、区域指示符对或 emoji 连接序列与前一字素重新合并的可变尾部。正式流式测试比较每个 UTF-16 分块位置，并读取渲染后的正文。当前没有能证明 120 或 240 Hz 浏览器帧保证的 Draft 性能基准。

暂停与终态显示全部已接收内容：完成、停止、报错、进入后台或开启减少动态效果的块直接返回原文；暂停后恢复的块显示暂停期间到达的内容，而不重放。没有待显示内容时，该 hook 不调度任何帧。

## Alternatives considered

**保留折叠并默认展开。**读者的要求是去掉按钮，而不是改默认值。默认展开仍要付出控件、箭头，以及每次加载历史后重新打开的成本，且下一次 Turn 结束时又会自动隐藏。

**保留折叠，靠浏览器查找展开。**`useSearchableHidden` 已经让被折叠的过程行可被查找，这也是工具行可以折叠的原因。但思考不能这样处理：查找只是揭示匹配项，不会让一段思考按顺序可读，而要求是始终全文可见。

**把现有滚动容器的 `max-height` 调大。**任何上限都会重新引入第二个滚动容器和遮罩，而会话本身已经在滚动。上限本身就是缺陷，而不是它的取值。

**用 4 毫秒或 8 毫秒的 `setInterval` 播放。**定时器无法表达刷新率。在 240 Hz 显示器上 8 毫秒定时器相当于 125 Hz，而在后台或被节流的标签页里它仍在反复做没人看得到的工作。按帧调度并以经过时间推进，可以在每种显示器上给出同一速率，并在显示停止时停止。

**逐字符创建 DOM 节点。**这会让选择、复制和 `textContent` 变得不稳定，并让每个分块的节点数成倍增加。单个追加的 `Text` 节点保留了 `Range` 端点和不被折叠的选择，组件此前已依赖这一点。

## Consequences

仅以思考为过程证据的 Turn 现在完全没有过程控件，因此 `message.turnProcess.thoughtForAWhile` 不再有可达界面，六个 `message.reasoning.*` 本地化键被删除。此前需要两次展开才能读到的思考现在直接处于阅读流中，这会拉长紧凑模式下的会话：[data-turn-process-member] 仍把带思考的行标记为过程范围成员以供布局使用，但它的 hidden 属性保持关闭。[ChatView 测试套件](../../../../packages/client/ui-chat/tests/chat-view.client.spec.tsx)覆盖紧凑模式下的折叠边界，[reasoning-row](../../../../packages/client/ui-chat/tests/reasoning-row.client.spec.tsx)覆盖全文阅读、选择与控件缺失，[reasoning-stream](../../../../packages/client/ui-chat/tests/reasoning-stream.client.spec.tsx)覆盖显示速率、突发布局预算、字素边界、暂停与恢复。刷新率结论依据的是按经过时间推进的实现与假时钟测试；120 与 240 Hz 未在真实硬件上观测。

## Related

- [思考准入与提示承载预算](2026-09-22-image-admission-envelope.zh.md)
