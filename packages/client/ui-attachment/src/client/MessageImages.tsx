import type { MessageImagesProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { DocumentChip, documentTypeLabel } from '../DocumentChip.tsx'
import { ImageGallery, MessageImage } from '../MessageImage.tsx'
import { messageImageLabels } from './labels.ts'
import css from '../MessageImage.module.css'

/** Historical message-attachment slot entry. */
export function MessageImages({ images, attachments, loadImage, align, t }: MessageImagesProps) {
  if (attachments !== undefined) {
    if (attachments.length === 0) return null
    const labels = messageImageLabels(t)
    const variant = attachments.length === 1 ? 'single' : 'tile'
    return (
      <div className={css.gallery} data-align={align}>
        {attachments.map(item => item.kind === 'image'
          ? (
            <MessageImage
              key={item.displayId}
              attachment={item.attachment}
              load={loadImage}
              variant={variant}
              labels={labels}
            />
          )
          : (
            <DocumentChip
              key={item.displayId}
              name={item.attachment.name}
              typeLabel={documentTypeLabel(item.attachment.name)}
            />
          ))}
      </div>
    )
  }
  return <ImageGallery images={images} load={loadImage} align={align} labels={messageImageLabels(t)} />
}
