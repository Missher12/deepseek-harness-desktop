/** Grapheme-cluster counting for progressive reveal and bounded copying. */

const SEGMENTER: Intl.Segmenter | undefined = typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  : undefined

/**
 * Count the grapheme clusters of a display string.
 * A trailing cluster whose code points have been received without its
 * combining marks yet is still one cluster, so a growing stream never has to
 * retract a boundary it already published.
 * @param value - display string.
 * @returns the number of user-perceived characters.
 */
export function displayLength(value: string): number {
  if (SEGMENTER === undefined) return Array.from(value).length
  let count = 0
  for (const _segment of SEGMENTER.segment(value)) count += 1
  return count
}

/**
 * Take a prefix of at most `count` grapheme clusters.
 * @param value - display string.
 * @param count - maximum number of grapheme clusters to retain.
 * @returns the retained prefix, or the whole string when it is already within budget.
 */
export function displayPrefix(value: string, count: number): string {
  if (count <= 0) return ''
  if (SEGMENTER === undefined) return Array.from(value).slice(0, count).join('')
  let end = 0
  let seen = 0
  for (const segment of SEGMENTER.segment(value)) {
    if (seen === count) return value.slice(0, end)
    seen += 1
    end = segment.index + segment.segment.length
  }
  return value
}

/**
 * Cluster boundaries of one string, segmented once per text change so a
 * per-frame reveal reads a length and a prefix in constant time. The reveal
 * runs on animation frames while the text changes only per streaming chunk, so
 * re-segmenting inside the frame would make every frame's cost follow the whole
 * thought instead of the few clusters it paints.
 */
export class GraphemeIndex {
  private text = ''
  private ends: number[] = []

  /**
   * Resegment when the text moved, and do nothing when it did not.
   * @param text - current display string.
   */
  update(text: string): void {
    if (text === this.text) return
    this.text = text
    this.ends = []
    if (SEGMENTER === undefined) {
      for (const cluster of Array.from(text)) {
        this.ends.push((this.ends.at(-1) ?? 0) + cluster.length)
      }
      return
    }
    for (const segment of SEGMENTER.segment(text)) {
      this.ends.push(segment.index + segment.segment.length)
    }
  }

  /** @returns the number of clusters in the indexed text. */
  get length(): number {
    return this.ends.length
  }

  /**
   * Take a prefix of at most `count` clusters of the indexed text.
   * @param count - maximum number of clusters to retain.
   * @returns the retained prefix, or the whole indexed text when already within budget.
   */
  prefix(count: number): string {
    if (count <= 0) return ''
    if (count >= this.ends.length) return this.text
    return this.text.slice(0, this.ends[count - 1])
  }
}
