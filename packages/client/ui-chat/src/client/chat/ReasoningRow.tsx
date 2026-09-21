/** Literal reasoning in the main reading flow; the transcript scrolls, the block does not. */
import { useLayoutEffect, useRef } from 'react'
import { IconThinkOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import { useRevealedText } from './use-revealed-text.ts'
import css from './ReasoningRow.module.css'

/**
 * Render original reasoning at full length without truncating or replaying received text.
 * The block grows with its content and names no reading control: the transcript owns
 * scrolling, and every viewport keeps the complete literal text. While this block is
 * the streaming tail, `useRevealedText` paints a progressively growing prefix whose
 * final frame equals the received text exactly.
 * @param props.text - complete or streaming reasoning, with literal whitespace.
 * @param props.running - whether this block is the streaming tail.
 * @param props.t - the owning Chat locale seat.
 * @returns the reasoning block and its static heading.
 */
export function ReasoningRow({ text, running, t }: { text: string; running: boolean; t: ChatViewSlotProps['t'] }) {
  const content = useRef<HTMLDivElement>(null)
  const shown = useRevealedText(text, running)
  useLayoutEffect(() => {
    const body = content.current
    if (body === null) return
    const current = body.firstChild
    // Appending to the same Text node preserves a reader's Range endpoints.
    // Replacing its entire value on every chunk would collapse that selection.
    if (current instanceof Text && shown.startsWith(current.data)) current.appendData(shown.slice(current.length))
    else body.replaceChildren(body.ownerDocument.createTextNode(shown))
  }, [shown])

  return (
    <div className={css.root} data-variant="think" data-state={running ? 'running' : 'ok'}>
      <div className={css.heading}>
        <IconThinkOutline14 size={14} />
        <span className={css.title}>{t('message.think')}</span>
        {running && <span className={css.status}>{t('row.running')}</span>}
      </div>
      {/* The complete received text rides a data attribute while the paint
          catches up: assistive technology and copy never read a partial
          thought, and the streaming node alone carries the painted prefix. */}
      <div ref={content} className={css.thinkBody}
        data-reasoning-full={text} data-reasoning-shown={shown} />
    </div>
  )
}
