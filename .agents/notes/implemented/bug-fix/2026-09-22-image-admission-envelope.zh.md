# Agent Note: 图片准入包络与提示承载预算

Status: implemented

[English](2026-09-22-image-admission-envelope.md) | 中文

## Problem

准入限制与承载提交的传输层此前被当作同一个预算维护，但二者并不相同：`maxMessageImageBytes` 指的是解码后的源字节，而提示承载统计的是 base64 码元，比前者多出三分之一。两者还相差一个数量级：20 张 × 50 MiB 为 1.3 GiB 编码量，而天花板是 296 MiB，因此编辑器接受的提交根本发不出去。由此还衍生出两个后果：单边像素上限以 8192px 拒绝了常见的手机照片与截图来源；每条消息的总量又用了一个调用方无法与承载上限比较的单位来表达。

## Decision

产品限制为：单张 50 MiB、每条消息 20 张、每条消息源字节总量 200 MiB、64,000,000 像素、单边 16384px；MiB 按 1024 × 1024 计算，恰好等于限制可接受。这些值只在 `LocalAttachmentStore.Config` 解析一次，经 `imageLimits` 到达 Host 校验，经 `imageLimits` 投影到达编辑器，因此客户端提示与 Host 拒绝使用的是同一组数字。`DEFAULT_MAX_IMAGE_BYTES` 为 50 MiB，`DEFAULT_MAX_IMAGE_DIMENSION` 为 16384；总量、张数与像素默认值不变。

该包络被记录为一组彼此独立的预算，而不是一个。源准入约束读者可以附加什么；承载上限约束单个 HTTP body：`MAX_PROMPT_ATTACHMENT_BASE64_CODE_UNITS` 为图片与文档合计 296 MiB 的 base64，桥接层 `DEFAULT_MAX_REQUEST_BODY_BYTES` 为 300 MiB，即该天花板加上 4 MiB 用于提示文本、文件名与 RPC JSON。持久化附件在准入之下归一化（`normalizedImageMaxBytes` 4 MiB、2048² 像素、8192px），供应商预算则由所属路由表达（`llm-pi-ai` 的 `maxRequestImageBytes`、`requestImagePixelBudget`、`requestImageMaxBytes`）。分类上限并不承诺各类可以同时填满：图片与文档的编码预算之和超过承载上限，编辑器会在构造请求之前拒绝这样的提交。

编码保持串行。`serializeAttachments` 读取一个 `File`、编码、释放原始缓冲区，然后处理下一个，因此唯一持续增长的只有请求本身携带的编码字符串；承载预算允许的原始字节量，已超过进程连同其编码形式所能容纳的规模。解码侧并发不变：`imageCompressionConcurrency` 默认为 2，并限制每个 store 的原生转换并发。

## Layer budgets

| 层 | 归属 | 限制 | 超限行为 |
|---|---|---|---|
| 源准入 | `attachment-local` `imageLimits` | 50 MiB、20 张、总量 200 MiB、64M 像素、16384px | 具名 `AttachmentError` 码，映射为限制文案 |
| 传输 | `client-connection` body 上限 | 单个 HTTP body 300 MiB | 处理器运行前返回 413 与 `connection: close` |
| 编辑器兜底 | `ui-conversation` / `InputBar` | 图片与文档合计 296 MiB 编码 base64 | 在添加阶段以 `attachment.totalTooLarge` 拒绝 |
| 存储投影 | `attachment-local` 归一化策略 | 4 MiB、2048² 像素、8192px | 准入时降采样；后续请求复用存储字节 |
| 供应商请求 | `llm-pi-ai` 路由 profile | 20 MiB base64、2048² 像素、单张 1 MiB | 最旧的图片被替换为文本占位符 |

## Alternatives considered

**把 HTTP body 上限提高到能容纳各类限制之和。**这会让承载层成为系统中最大的数字，并把失败点推到 300 MiB 缓冲区已经存在之后。这些分类从来不是要同时满足的；把它们表达为同一个预算，才是掩盖差距的原因。

**把每条消息总量降到承载层允许的规模。**这会拒绝一个本可通过的合法 200 MiB 提交——总量预算单独看是能装进承载层的，因为 200 MiB 的 base64 为 267 MiB，低于 296 MiB 天花板。只有图片与文档的组合装不下，而那正是编辑器拒绝的组合。

**保留 8192px 单边上限并改为降采样。**像素预算已经约束了存储内容，因此单边上限只决定哪些来源被直接拒绝。8192px 会在其余限制生效之前就拒绝 12000px 的全景图和常见的现代手机照片。

**并发编码图片以降低延迟。**客户端已经把工作限制在一个原始缓冲区上。此处并发会以峰值内存换取墙钟时间，而这条路径的耗时主要由模型请求决定，且预算允许的总量本就超出以原始形式持有的能力。

**信任客户端执行包络。**编辑器检查只是为给出良好错误信息的兜底；Host 会通过 `admitPromptContent` 重新准入每个部分，因此绕过编辑器的调用方仍会被同一组限制拒绝。

## Consequences

此前被字节上限拒绝的 25.8 MiB 来源现在可以准入并归一化；16384px 的长边可以通过，而过去的天花板是 8192px。传输层边界的可观测行为不变，且已被固化：声明长度超过承载天花板一个字节的 body 在处理器运行前被 413 拒绝；恰好等于天花板的 body 可以通过，因为它所依据的附件天花板已预留了框架开销。`MAX_PROMPT_ATTACHMENT_BASE64_CODE_UNITS` 增加了"分类预算无法同时填满"的说明。验证来自[大图测试套件](../../../../packages/attachment/attachment-local/tests/index.spec.ts)（在每个边界生成真实编码字节，包括超过旧字节上限的 3000×3000 噪声图与超过旧单边上限的 16384×200 渐变图），以及[承载预算测试套件](../../../../packages/client/connection/tests/http-bridge.host.spec.ts)。未复现上游 413：可复现的层级是传输层，而供应商预算未对真实路由做验证。Windows 与 Ubuntu 未做原生验收。

## Related

- [思考全文进入阅读流](2026-09-22-reasoning-full-length-reading.zh.md)
