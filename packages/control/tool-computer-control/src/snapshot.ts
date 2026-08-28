/** Computer accessibility snapshot tool with optional durable screenshot attachment. */

import type { Context } from '@deepseek-ai/cordis'
import { AttachmentId, type ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { closeToolParameters } from './closed-tool.ts'
import type { ComputerToolController } from './controller.ts'
import { computerCall } from './presentation.ts'
import { routeCanSeeImages } from './vision.ts'

const IMAGE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    attachmentId: { type: 'string', required: true },
    mediaType: { type: 'string', const: 'image/png', required: true },
    bytes: { type: 'integer', required: true },
    width: { type: 'integer', required: true },
    height: { type: 'integer', required: true },
    name: { type: 'string' },
    originalDimensions: {
      type: 'object', additionalProperties: false,
      properties: {
        width: { type: 'integer', required: true },
        height: { type: 'integer', required: true },
      },
    },
  },
} as const

const SNAPSHOT_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    appId: { type: 'string', required: true },
    windowId: { type: 'string', required: true },
    snapshotRevision: { type: 'integer', required: true },
    semanticText: { type: 'string', required: true },
    refs: {
      type: 'array', required: true,
      items: {
        type: 'object', additionalProperties: false,
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
interface SnapshotValue {
  appId: string
  windowId: string
  snapshotRevision: number
  semanticText: string
  refs: { ref: string; role: string; name: string }[]
  image?: SnapshotImage
}

function imageRef(image: SnapshotImage): ImageAttachmentRef {
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
    text: `Computer snapshot\nApplication: ${JSON.stringify(value.appId)}\nWindow: ${JSON.stringify(value.windowId)}\nRevision: ${value.snapshotRevision}\n\n${value.semanticText}`,
  }]
  if (value.image !== undefined) blocks.push({ type: 'image', attachment: imageRef(value.image) })
  return blocks
}

/** Build the strict native snapshot tool. */
export function computerSnapshotTool(ctx: Context, controller: ComputerToolController) {
  return closeToolParameters(defineTool({
    name: 'computer_snapshot',
    description: 'Capture bounded accessibility semantics for one app window. A screenshot attachment is requested only for the exact active vision-capable route; pixels never expand the authorized app/window set.',
    parameters: {
      app_id: { type: 'string', required: true, description: 'Application id from computer_list.' },
      window_id: { type: 'string', required: true, description: 'Window id paired with that application in computer_list.' },
    },
    output: { schema: SNAPSHOT_SCHEMA, render: (_args, value) => renderSnapshot(value as SnapshotValue) },
    presentCall: () => computerCall('Inspect computer window'),
    async execute(args, exec) {
      const includeImage = await routeCanSeeImages(ctx, exec)
      const envelope = await controller.snapshot({ appId: args.app_id, windowId: args.window_id }, exec, includeImage)
      let image: SnapshotImage | undefined
      if (includeImage && envelope.png !== undefined) {
        const attachments = ctx.get('attachments')
        if (attachments === undefined) throw new Error('Computer screenshot storage became unavailable.')
        const saved = await attachments.saveImage({
          data: envelope.png.read(), mediaType: 'image/png', name: 'computer-snapshot.png',
        })
        if (saved.mediaType !== 'image/png') {
          throw new Error('Attachment storage changed the computer screenshot media type.')
        }
        image = saved as SnapshotImage
      }
      return {
        appId: envelope.result.appId,
        windowId: envelope.result.windowId,
        snapshotRevision: envelope.result.snapshotRevision,
        semanticText: envelope.result.semanticText,
        refs: envelope.result.refs.map(ref => ({ ref: ref.ref, role: ref.role, name: ref.name })),
        ...(image === undefined ? {} : { image }),
      }
    },
  }))
}
