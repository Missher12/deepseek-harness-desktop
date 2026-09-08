/** Reuse completed tight-list items; ambiguous block structure returns to the full grammar. */
import type { List, Nodes, Root } from 'mdast'

/** The final list item remains reparsable until another item makes it stable. */
export interface ListFrontier {
  readonly node: List & { position: NonNullable<List['position']> }
  readonly base: number
  readonly marker: string
  readonly pendingOffset: number
  readonly pendingLine: number
}

/** A tight list of paragraphs has no block structure shared between its items. */
function supported(node: List): node is List & { position: NonNullable<List['position']> } {
  return node.position !== undefined && node.children.length > 0 && node.spread !== true
    && node.children.every(item => item.spread !== true
      && item.position?.start.column === 1 && item.position.start.offset !== undefined
      && (item.children.length === 0
        || (item.children.length === 1 && item.children[0]?.type === 'paragraph')))
}

/**
 * Recognize parser-confirmed top-level lists without document-wide reference or HTML state.
 * @param node - The final parsed list in the current tail.
 * @param text - Full accumulated Markdown source.
 * @param base - Offset of the source slice that produced the node's positions.
 * @returns A last-item frontier, or null for unsupported block structure.
 */
export function listFrontier(node: List, text: string, base: number): ListFrontier | null {
  const start = node.position?.start
  const last = node.children.at(-1)?.position?.start
  if (start?.column !== 1 || start.offset === undefined || last?.offset === undefined || !supported(node)) return null
  const source = text.slice(base + start.offset)
  // References/footnotes and raw HTML can reinterpret earlier items. Preserve
  // their existing full-tail semantics instead of caching a partial answer.
  if (/[\[<]/u.test(source)) return null
  const marker = /^(?:[-+*]|\d{1,9}[.)])(?:[ \t]|$)/u.exec(source)
  if (marker === null) return null
  return {
    node, base, marker: marker[0].trimEnd().slice(-1),
    pendingOffset: last.offset, pendingLine: last.line,
  }
}

/** Rebase only the fresh grammar result; retained nodes and prior snapshots remain immutable. */
function shiftPositions(node: Nodes, offset: number, line: number): void {
  if (node.position !== undefined) {
    for (const point of [node.position.start, node.position.end]) {
      point.line += line
      if (point.offset !== undefined) point.offset += offset
    }
  }
  if ('children' in node) {
    for (const child of node.children) shiftPositions(child, offset, line)
  }
}

/**
 * Parse the pending item and newly appended items, preserving earlier mdast
 * nodes and the original ordered-list start. Loose/nested lists, references,
 * HTML, or a following block fall back in the same update.
 * @param state - The previous parser-confirmed frontier.
 * @param text - Full accumulated Markdown source.
 * @param parse - The caller's existing GFM grammar.
 * @returns Updated frontier, or null when the complete tail must be parsed.
 */
export function extendListFrontier(
  state: ListFrontier,
  text: string,
  parse: (text: string) => Root,
): ListFrontier | null {
  const pending = text.slice(state.base + state.pendingOffset)
  if (/[\[<]/u.test(pending)) return null
  const root = parse(pending)
  const suffix = root.children[0]
  if (root.children.length !== 1 || suffix?.type !== 'list') return null
  const frontier = listFrontier(suffix, pending, 0)
  if (frontier === null || frontier.marker !== state.marker) return null
  shiftPositions(suffix, state.pendingOffset, state.pendingLine - 1)
  const node = {
    ...state.node,
    children: [...state.node.children.slice(0, -1), ...suffix.children],
    position: { start: state.node.position.start, end: frontier.node.position.end },
  }
  return {
    ...state, node,
    pendingOffset: state.pendingOffset + frontier.pendingOffset,
    pendingLine: state.pendingLine + frontier.pendingLine - 1,
  }
}
