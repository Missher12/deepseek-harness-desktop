import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'

/**
 * Apply searchable hidden state without unmounting a stable subtree.
 * A live selection in the same Turn defers hiding until it clears; focused descendants
 * keep their owning disclosure open through the reveal callback.
 * @param hidden - whether the subtree is currently hidden.
 * @param reveal - callback for browser find's `beforematch` reveal.
 * @returns ref for the stable subtree root.
 */
export function useSearchableHidden(
  hidden: boolean,
  reveal: () => void,
): RefObject<HTMLDivElement> {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const element = ref.current
    if (element === null) return
    const document = element.ownerDocument
    const update = (): boolean => {
      if (hidden && element.contains(document.activeElement)) {
        reveal()
        return false
      }
      const selection = hidden ? document.getSelection() : null
      let selected = false
      if (selection !== null && !selection.isCollapsed) {
        const seat = element.closest('[data-chat-turn]')
        const scope = seat?.parentElement
        const members = seat !== null && scope != null
          ? Array.from(scope.children).filter(sibling =>
            sibling.getAttribute('data-chat-turn') === seat.getAttribute('data-chat-turn'))
          : [element]
        selected = Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index))
          .some(range => members.some(member => range.intersectsNode(member)))
      }
      if (hidden && !selected) element.setAttribute('hidden', 'until-found')
      else element.removeAttribute('hidden')
      return hidden && selected
    }
    if (!update()) return
    const onSelection = () => {
      if (!update()) document.removeEventListener('selectionchange', onSelection)
    }
    document.addEventListener('selectionchange', onSelection)
    return () => { document.removeEventListener('selectionchange', onSelection) }
  }, [hidden, reveal])
  useEffect(() => {
    const element = ref.current
    if (element === null) return
    element.addEventListener('beforematch', reveal)
    return () => { element.removeEventListener('beforematch', reveal) }
  }, [reveal])
  return ref
}
