import { IconPaperclipOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { DOCUMENT_TYPE_FALLBACK } from './locales.ts'
import css from './DocumentChip.module.css'

/**
 * Compact non-interactive document card rendered inside the attachment rail.
 * @param props.name - browser display name.
 * @param props.typeLabel - short file-type label.
 * @returns an accessible document summary; removal remains owned by the rail.
 */
export function DocumentChip({ name, typeLabel }: { readonly name: string; readonly typeLabel: string }) {
  return (
    <div className={css.root} title={name}>
      <IconPaperclipOutline16 size={18} className={css.icon} />
      <span className={css.name}>{name}</span>
      <span className={css.type}>{typeLabel}</span>
    </div>
  )
}

/** Derive a short non-sensitive type label from a sanitized display name. */
export function documentTypeLabel(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 && dot < name.length - 1 ? name.slice(dot + 1).toUpperCase() : DOCUMENT_TYPE_FALLBACK
}
