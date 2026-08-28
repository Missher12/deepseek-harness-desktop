/** Semantic browser snapshot tool with optional durable screenshot attachment. */

import type { Context } from '@deepseek-ai/cordis'
import { AttachmentId, type ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-llm'
import { closeToolParameters } from './closed-tool.ts'
import type { BrowserToolController } from './controller.ts'
import { browserCall } from './presentation.ts'

const IMAGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    attachmentId: { type: 'string', required: true },
    mediaType: { type: 'string', const: 'image/png', required: true },
    bytes: { type: 'integer', required: true },
    width: { type: 'integer', required: true },
    height: { type: 'integer', required: true },
    name: { type: 'string' },
    originalDimensions: {
      type: 'object',
      additionalProperties: false,
      properties: {
        width: { type: 'integer', required: true },
        height: { type: 'integer', required: true },
      },
    },
  },
} as const

const SNAPSHOT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    surfaceId: { type: 'string', required: true },
    url: { type: 'string', required: true },
    title: { type: 'string', required: true },
    snapshotRevision: { type: 'integer', required: true },
    semanticText: { type: 'string', required: true },
    refs: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ref: { type: 'string', required: true },
          role: { type: 'string', required: true },
          name: { type: 'string', required: true },
        },
      },
    },
    image: IMAGE_SCHEMA,
  },
} as const

type SnapshotImage = Omit<ImageAttachmentRef, 'mediaType'> & { mediaType: 'image/png' }

type SnapshotValue = {
  surfaceId: string
  url: string
  title: string
  snapshotRevision: number
  semanticText: string
  refs: { ref: string; role: string; name: string }[]
  image?: SnapshotImage
}

function imageRef(image: NonNullable<SnapshotValue['image']>): ImageAttachmentRef {
  return {
    attachmentId: AttachmentId(image.attachmentId),
    mediaType: image.mediaType,
    bytes: image.bytes,
    width: image.width,
    height: image.height,
    ...(image.name === undefined ? {} : { name: image.name }),
    ...(image.originalDimensions === undefined ? {} : {
      originalDimensions: { ...image.originalDimensions },
    }),
  }
}

function renderSnapshot(value: SnapshotValue) {
  const blocks: ({ type: 'text'; text: string } | { type: 'image'; attachment: ImageAttachmentRef })[] = [{
    type: 'text',
    text: `Browser snapshot\nURL: ${JSON.stringify(value.url)}\nTitle: ${JSON.stringify(value.title)}\nRevision: ${value.snapshotRevision}\n\n${value.semanticText}`,
  }]
  if (value.image !== undefined) blocks.push({ type: 'image', attachment: imageRef(value.image) })
  return blocks
}

/** Resolve image support for the exact current route; unknown capability falls back to semantics. */
async function routeCanSeeImages(ctx: Context, exec: ToolRunContext): Promise<boolean> {
  const attachments = ctx.get('attachments')
  if (attachments === undefined || !attachments.imageLimits.mediaTypes.includes('image/png')) return false
  const llm = ctx.get('llm')
  const routed = exec.agent?.session.requestHeader()?.config
  const provider = routed?.provider ?? exec.agent?.options.provider
  const model = routed?.model ?? exec.agent?.options.model
  if (llm === undefined || provider === undefined || model === undefined) return false
  try {
    const info = await llm.resolveModelInfo(provider, model, exec.signal)
    return info.inputModalities?.includes('image') === true
  } catch (error: unknown) {
    exec.signal.throwIfAborted()
    void error
    return false
  }
}

/** Build the closed semantic snapshot tool. */
export function browserSnapshotTool(ctx: Context, controller: BrowserToolController) {
  return closeToolParameters(defineTool({
    name: 'browser_snapshot',
    description: 'Capture the controlled browser\'s current URL, title, revision-bound semantic refs, and bounded semantic tree. A screenshot is attached only when the exact active model supports image input. Screenshot pixels never authorize coordinate actions.',
    parameters: {},
    output: {
      schema: SNAPSHOT_SCHEMA,
      render: (_args, value) => renderSnapshot(value as SnapshotValue),
    },
    presentCall: () => browserCall('Inspect browser'),
    async execute(_args, exec) {
      const includeImage = await routeCanSeeImages(ctx, exec)
      const envelope = await controller.snapshot(exec, includeImage)
      let image: SnapshotImage | undefined
      if (includeImage && envelope.png !== undefined) {
        const attachments = ctx.get('attachments')
        if (attachments === undefined) throw new Error('Browser screenshot storage became unavailable.')
        const saved = await attachments.saveImage({
          data: envelope.png.read(),
          mediaType: 'image/png',
          name: 'browser-snapshot.png',
        })
        if (saved.mediaType !== 'image/png') {
          throw new Error('Attachment storage changed the browser screenshot media type.')
        }
        image = saved as SnapshotImage
      }
      return {
        surfaceId: envelope.result.surfaceId,
        url: envelope.result.url,
        title: envelope.result.title,
        snapshotRevision: envelope.result.snapshotRevision,
        semanticText: envelope.result.semanticText,
        refs: envelope.result.refs.map(ref => ({ ref: ref.ref, role: ref.role, name: ref.name })),
        ...(image === undefined ? {} : { image }),
      }
    },
  }))
}
