/**
 * Scope-addressed conversation send, cancel, and history orchestration.
 *
 * Scope addressing rides the cordis Service tracker: property access through
 * `ctx.conversation` rebinds `this.ctx` to the caller's context, so methods
 * read the session tag with `scopeOf`. Mutable state must remain reachable
 * through one property read; assignment through the tracker proxy and `#`
 * private fields bypass that rebinding.
 */
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
// Type-only imports: a plugin-to-plugin value import is a bundle purity
// error, so scope resolution goes through the sessions service (scopeOf
// method) instead of the standalone helper.
import type {
  ISessions, PendingSubmissionRetirement, SessionFace,
} from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  MAX_PROMPT_ATTACHMENT_BASE64_CODE_UNITS,
  promptAttachmentBase64CodeUnits,
} from '@deepseek-ai/dsh-attachment/types'
import type {
  ComposerAttachment, ComposerDocumentAttachment, ComposerImageAttachment,
} from './contract/slots.ts'
import type { QueueAction, QueueItemId } from './contract/queue.ts'
import type { ComposerBlocks } from './contract/composer-blocks.ts'
import type {
  DraftAttachmentId, SessionInputResolver, SubmitImageAttachment, SubmitOutcome,
} from './contract/input.ts'
import type { InputSubmitMode } from './contract/composer-submission.ts'
import { classifyComposerFile, imageMediaType } from './attachment-files.ts'
import type { ComposerFileClassification } from './attachment-files.ts'

/**
 * The outward conversation face (`ctx.conversation`): the scope-addressed
 * verbs and the input registry other plugins may reach — and exactly what a
 * test fake must supply.
 */
export interface IConversation {
  /** The per-session input machine registry (SessionInputResolver face). */
  readonly input: SessionInputResolver
  /**
   * The per-session composer-block registry: how a plugin the composer
   * cannot import makes a session's input inert with its own reason.
   */
  readonly blocks: ComposerBlocks
  /**
   * Send a prompt into the caller scope's session (queued turn).
   * @param text - prompt text, sent verbatim as one text block.
   * @returns completion; business failures reject (and land in promptError).
   */
  send(text: string): Promise<void>
  /**
   * Apply one edit, remove, or strict steer operation to a pending queue occurrence.
   * @param itemId - agent-owned inbox occurrence identity.
   * @param action - requested queue operation.
   * @returns completion; converged strict-steer races resolve, while other failures reject.
   */
  updateQueue(itemId: QueueItemId, action: QueueAction): Promise<void>
  /**
   * Cancel the scoped session's in-flight turn while preserving its pending Queue.
   * @returns completion; failures reject as in send.
   */
  cancel(): Promise<void>
  /**
   * Pull one older history page for the scoped session.
   * @returns completion of the page pull.
   */
  loadOlder(): Promise<void>
}

/**
 * Fill the draft's intrinsic dimensions once the browser parses the image
 * header (a metadata read off the preview URL, not a full decode). Failures
 * and non-browser runtimes leave them absent — consumers size those images
 * from CSS constraints instead. The descriptors stay registry-owned; submit
 * reads the dimensions into an immutable echo snapshot, so this late write
 * does not require a store notification.
 */
function probeDimensions(attachment: ComposerImageAttachment): void {
  if (typeof Image !== 'function') return
  const probe = new Image()
  probe.onload = () => {
    attachment.width = probe.naturalWidth
    attachment.height = probe.naturalHeight
  }
  probe.src = attachment.previewUrl
}

/** Give the echo one paint opportunity without letting a throttled frame clock block admission. */
function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        setTimeout(resolve, 0)
        return
      }
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        clearTimeout(fallback)
        setTimeout(resolve, 0)
      }
      const fallback = setTimeout(finish, 100)
      requestAnimationFrame(finish)
    } else {
      setTimeout(resolve, 0)
    }
  })
}

/** Create one browser-only draft descriptor; only its id enters input state. */
function browserDraftAttachment(
  file: File,
  classification: ComposerFileClassification,
): ComposerAttachment {
  const id = randomUUID() as DraftAttachmentId
  if (classification.kind === 'document') return { kind: 'document', id, file, mediaType: classification.mediaType }
  return { kind: 'image', id, previewUrl: URL.createObjectURL(file), file }
}

/** Scope-addressed conversation service (root singleton, provided as `conversation`). */
export class ConversationController extends Service implements IConversation {
  /** The per-session input machine registry (SessionInputResolver face). */
  readonly input: SessionInputResolver
  /** The per-session composer-block registry. */
  readonly blocks: ComposerBlocks
  private readonly draftAttachments = new Map<DraftAttachmentId, ComposerAttachment>()

  /**
   * @param ctx - owning root context (the plugin apply context; the service
   * registers itself and follows that fiber's lifetime).
   * @param config - carries the SessionInputResolver and composer-block registry
   * constructed by the plugin apply (the same instances the slot inject
   * factories close over).
   */
  constructor(ctx: Context, config: { input: SessionInputResolver; blocks: ComposerBlocks }) {
    super(ctx, 'conversation')
    this.input = config.input
    this.blocks = config.blocks
    ctx.effect(() => () => {
      for (const attachment of this.draftAttachments.values()) {
        if (attachment.kind === 'image') revokePreview(attachment.previewUrl)
      }
      this.draftAttachments.clear()
    }, 'conversation draft attachments')
  }

  /**
   * Send a prompt into the scoped session. Business failures also land in the
   * session snapshot's promptError (object-layer state); the rejection here
   * exists for caller choreography (the composer restores the draft on it).
   * @param text - prompt text, sent verbatim as one text block.
   */
  async send(text: string): Promise<void> {
    const session = this.scopedSession('send')
    const result = await session.prompt([{ type: 'text', text }], 'queue')
    if (!result.ok) throw new Error(`conversation.send failed: ${result.error.code}: ${result.error.message}`)
  }

  /**
   * Submit ordered draft images with text through one host admission. A local
   * submission echo enters the session snapshot synchronously; serialization
   * and the prompt round-trip start after the browser can paint it. On the
   * echo's observed retirement the draft images hand their preview URLs to
   * the durable image cache and leave the registry; on failure they stay
   * registered so the composer can restore them. Documents share the same
   * bounded Host admission, but only images enter the local visual echo.
   * @param session - target session.
   * @param text - serialized prompt text.
   * @param imageIds - ordered draft-local attachment ids (legacy field name).
   * @param mode - queue or steer delivery selected by composer policy.
   * @param signal - optional cancellation for the complete Host admission.
   * @returns the Host admission outcome; local attachment preparation failures reject.
   */
  async sendSession(
    session: SessionFace,
    text: string,
    imageIds: readonly DraftAttachmentId[],
    mode: InputSubmitMode,
    signal?: AbortSignal,
  ): Promise<SubmitOutcome> {
    const attachments = this.draftImages(imageIds)
    if (attachments.length !== imageIds.length) {
      throw new Error('conversation.sendSession: one or more draft attachments are no longer available')
    }
    const snapshot = session.getSnapshot()
    if (snapshot.subagent !== null) {
      const uploaded = await this.serializeAttachments(attachments)
      const content = [...uploaded, ...(text === '' ? [] : [{ type: 'text' as const, text }])]
      const result = await session.prompt(content, mode, signal)
      return result.ok ? { kind: 'success' } : { kind: 'error' }
    }
    let finishRetirement: ((retirement: PendingSubmissionRetirement) => void) | undefined
    const retirement = attachments.length === 0
      ? undefined
      : new Promise<PendingSubmissionRetirement>((resolve) => { finishRetirement = resolve })
    const submission = session.beginSubmission({
      mode,
      text,
      images: attachments
        .filter((attachment): attachment is ComposerImageAttachment => attachment.kind === 'image')
        .map(attachment => ({
          previewUrl: attachment.previewUrl,
          ...(attachment.file.name === '' ? {} : { name: attachment.file.name }),
          ...(attachment.width === undefined ? {} : { width: attachment.width }),
          ...(attachment.height === undefined ? {} : { height: attachment.height }),
        })),
      onRetire: (settlement) => {
        this.settleSubmittedAttachments(session.sessionId, attachments, settlement)
        finishRetirement?.(settlement)
      },
    })
    let content: Parameters<SessionFace['prompt']>[0]
    try {
      await nextPaint()
      const uploaded = await this.serializeAttachments(attachments)
      content = [...uploaded, ...(text === '' ? [] : [{ type: 'text' as const, text }])]
    } catch (error) {
      submission.abandon()
      throw error
    }
    const result = await session.prompt(content, mode, signal, submission.requestId)
    if (!result.ok) return { kind: 'error' }
    if (retirement !== undefined && (await retirement).reason !== 'observed') return { kind: 'error' }
    return { kind: 'success' }
  }

  /**
   * Create runtime-only draft attachments and image object URLs.
   * @param files - browser files to register after closed type classification.
   * @returns ordered draft descriptors.
   */
  createDraftImages(files: readonly File[]): readonly ComposerAttachment[] {
    const classifications = files.map(classifyComposerFile)
    return files.map((file, index) => {
      const classification = classifications[index]
      /* v8 ignore next -- classifications is produced by the same-length map immediately above. */
      if (classification === undefined) throw new Error('conversation.createDraftImages: classification missing')
      const attachment = browserDraftAttachment(file, classification)
      this.draftAttachments.set(attachment.id, attachment)
      if (attachment.kind === 'image') probeDimensions(attachment)
      return attachment
    })
  }

  /**
   * Resolve ordered input-state ids to runtime-owned draft attachments.
   * @param ids - draft attachment ids.
   * @returns descriptors that remain live, in requested order.
   */
  draftImages(ids: readonly DraftAttachmentId[]): readonly ComposerAttachment[] {
    const attachments: ComposerAttachment[] = []
    for (const id of ids) {
      const attachment = this.draftAttachments.get(id)
      if (attachment !== undefined) attachments.push(attachment)
    }
    return attachments
  }

  /**
   * Serialize ordered draft images to command-submit wire payloads without
   * sending or releasing them (the composer releases only after the command
   * settles successfully).
   * @param imageIds - ordered draft-local attachment ids.
   * @returns base64 payloads in id order.
   */
  async serializeDraftImages(imageIds: readonly DraftAttachmentId[]): Promise<readonly SubmitImageAttachment[]> {
    const attachments = this.draftImages(imageIds)
    if (attachments.length !== imageIds.length) {
      throw new Error('conversation.serializeDraftImages: one or more draft images are no longer available')
    }
    const images = attachments.filter((attachment): attachment is ComposerImageAttachment => attachment.kind === 'image')
    if (images.length !== attachments.length) {
      throw new Error('conversation.serializeDraftImages: slash commands do not accept document attachments')
    }
    return Promise.all(images.map(attachment => this.encodeImage(attachment.file)))
  }

  /**
   * Release one browser-owned draft attachment and any preview URL.
   * @param id - draft attachment id.
   */
  releaseDraftImage(id: DraftAttachmentId): void {
    const attachment = this.draftAttachments.get(id)
    if (attachment === undefined) return
    this.draftAttachments.delete(id)
    if (attachment.kind === 'image') {
      revokePreview(attachment.previewUrl)
    }
  }

  /**
   * Release a set of browser-owned draft images.
   * @param attachments - descriptors to release.
   */
  releaseDraftImages(attachments: readonly ComposerAttachment[]): void {
    for (const attachment of attachments) this.releaseDraftImage(attachment.id)
  }

  /** Apply one operation to a pending queue occurrence. */
  async updateQueue(itemId: QueueItemId, action: QueueAction): Promise<void> {
    const session = this.scopedSession('updateQueue')
    const result = await session.updateQueue(itemId, action)
    if (!result.ok) {
      if (
        action.kind === 'steer'
        && (result.error.code === 'session/steer-unavailable' || result.error.code === 'session/queue-item-not-found')
      ) return
      throw new Error(`conversation.updateQueue failed: ${result.error.code}: ${result.error.message}`)
    }
  }

  /** Cancel the scoped session's in-flight turn while preserving Queue (failures land in promptError and reject, as in send). */
  async cancel(): Promise<void> {
    const session = this.scopedSession('cancel')
    const result = await session.cancel()
    if (!result.ok) throw new Error(`conversation.cancel failed: ${result.error.code}: ${result.error.message}`)
  }

  /** Pull one older history page for the scoped Session. */
  async loadOlder(): Promise<void> {
    await this.scopedSession('loadOlder').loadOlder()
  }

  /** Resolve the caller scope's session face or throw on root contexts. */
  private scopedSession(op: string): SessionFace {
    const id = this.scopeId(op)
    const binding = this.requireSessions().binding(id)
    if (binding === undefined) throw new Error(`conversation.${op}: session "${id}" resolved no binding`)
    return binding.session
  }

  /** Read the caller's session scope tag via the sessions service; root contexts fail loud. */
  private scopeId(op: string): SessionId {
    const id = this.requireSessions().scopeOf(this.ctx)
    if (id === undefined) {
      throw new Error(`conversation.${op} requires a session scope — address one via ctx.sessions.scope(id).conversation`)
    }
    return id
  }

  private requireSessions(): ISessions {
    // Strict ctx.get, not the injection proxy: the scope-addressed pattern
    // reads the service off whatever context the tracker rebound.
    const sessions = this.ctx.get('sessions')
    if (sessions === undefined) throw new Error('conversation: sessions service unavailable')
    return sessions
  }

  /** Convert browser attachments to canonical base64 prompt parts. */
  private async serializeAttachments(
    attachments: readonly ComposerAttachment[],
  ): Promise<Parameters<SessionFace['prompt']>[0]> {
    let remaining = MAX_PROMPT_ATTACHMENT_BASE64_CODE_UNITS
    for (const attachment of attachments) {
      const encodedLength = promptAttachmentBase64CodeUnits(attachment.file.size)
      if (encodedLength > remaining) {
        throw new ComposerAttachmentPayloadError()
      }
      remaining -= encodedLength
    }

    // Keep only one raw File buffer live at a time. The encoded strings must
    // remain until the request is sent, but concurrent arrayBuffer() calls
    // would additionally retain every large source buffer at once.
    const serialized: Parameters<SessionFace['prompt']>[0] = []
    for (const attachment of attachments) {
      if (attachment.kind === 'image') {
        serialized.push({ type: 'image', ...await this.encodeImage(attachment.file) })
      } else {
        serialized.push(await this.encodeDocument(attachment))
      }
    }
    return serialized
  }

  /**
   * Settle one submission's draft attachments when its echo retires. Observed:
   * every attachment leaves the registry, and each image hands its preview URL to the durable
   * image cache (seeded under the admitted reference so the transcript node
   * renders immediately while the cache reads canonical bytes) or revoking it
   * when the cache already holds that reference. Failed: nothing changes;
   * the ids stay registered for the composer's rail restore.
   */
  private settleSubmittedAttachments(
    sessionId: SessionId,
    attachments: readonly ComposerAttachment[],
    retirement: PendingSubmissionRetirement,
  ): void {
    if (retirement.reason !== 'observed') return
    const uiConversation = this.ctx.get('uiConversation')
    let imageIndex = 0
    for (const attachment of attachments) {
      const live = this.draftAttachments.get(attachment.id)
      if (live === undefined) {
        if (attachment.kind === 'image') imageIndex += 1
        continue
      }
      this.draftAttachments.delete(attachment.id)
      if (attachment.kind === 'document') continue
      const ref = retirement.attachments[imageIndex]
      imageIndex += 1
      if (ref !== undefined && uiConversation?.seedImageUrl(sessionId, ref, attachment.previewUrl) === true) continue
      revokePreview(attachment.previewUrl)
    }
  }

  /** Canonical base64 wire form of one browser image file. */
  private async encodeImage(file: File): Promise<SubmitImageAttachment> {
    return {
      mediaType: imageMediaType(file.type),
      data: bytesToBase64(new Uint8Array(await file.arrayBuffer())),
      ...(file.name === '' ? {} : { name: file.name }),
    }
  }

  /** Canonical base64 wire form of one browser document file. */
  private async encodeDocument(
    attachment: ComposerDocumentAttachment,
  ): Promise<Extract<Parameters<SessionFace['prompt']>[0][number], { type: 'document' }>> {
    return {
      type: 'document',
      mediaType: attachment.mediaType,
      data: bytesToBase64(new Uint8Array(await attachment.file.arrayBuffer())),
      name: attachment.file.name,
    }
  }
}

/** Browser-side backstop matching the Host's combined prompt carrier code. */
class ComposerAttachmentPayloadError extends Error {
  readonly code = 'ATTACHMENTS_TOO_LARGE'

  constructor() {
    super('Combined image and document payload exceeds the request carrier limit.')
    this.name = 'ComposerAttachmentPayloadError'
  }
}

/** Canonical browser base64 encoded in bounded chunks. */
function bytesToBase64(data: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let offset = 0; offset < data.length; offset += chunk) {
    binary += String.fromCharCode(...data.subarray(offset, offset + chunk))
  }
  return btoa(binary)
}

function revokePreview(url: string): void {
  if (url.startsWith('blob:')) URL.revokeObjectURL(url)
}
