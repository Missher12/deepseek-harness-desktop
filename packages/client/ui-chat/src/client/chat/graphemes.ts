/** Incremental grapheme-cluster segmentation for a text that only ever grows. */

const SEGMENTER: Intl.Segmenter | undefined = typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  : undefined

/**
 * Count the grapheme clusters of a display string.
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
 * A draft segmented into grapheme clusters as chunks arrive.
 *
 * A chunk may *continue* the last cluster rather than start a new one: a
 * combining mark, an emoji join sequence, or the second half of a surrogate
 * pair all change the text without changing the cluster count. The endings of
 * every cluster except the last are therefore final, and only the last is
 * recomputed when more text arrives. Segmentation runs once per received chunk,
 * so a frame that paints a few clusters never walks the whole thought.
 */
export class Draft {
  private readonly endings: number[] = []
  private text = ''
  private dirty = false

  /** @returns the number of grapheme clusters received so far. */
  get length(): number {
    return this.endings.length
  }

  /** @returns the received text, exactly as plain concatenation of the chunks would produce. */
  toString(): string {
    return this.text
  }

  /** @returns the length of the received text in UTF-16 code units. */
  get textLength(): number {
    return this.text.length
  }

  /**
   * Offset one past the last code unit of the first `count` clusters.
   * A cluster a later chunk may still continue counts here as it currently
   * stands, so a reader never waits on a boundary only the next chunk settles.
   * @param count - number of clusters.
   * @returns the prefix offset, or 0 when `count` is not positive.
   */
  endOf(count: number): number {
    if (count <= 0) return 0
    return count >= this.endings.length ? this.text.length : this.endings[count - 1] as number
  }

  /**
   * Append one chunk's text, without touching the segmentation.
   * @param chunk - the chunk exactly as received.
   */
  append(chunk: string): void {
    if (chunk === '') return
    this.text += chunk
    this.dirty = true
  }

  /**
   * Bring the cluster endings up to date, segmenting only the tail the last
   * chunk may have changed.
   * @returns whether the cluster count grew since the previous call.
   */
  update(): boolean {
    if (!this.dirty) return false
    this.dirty = false
    const previous = this.endings.length
    // The last ending is provisional until more text arrives, so it is
    // recomputed rather than trusted. Every earlier ending is final.
    if (this.endings.length > 0) this.endings.pop()
    const start = this.endings.length > 0 ? this.endings[this.endings.length - 1] as number : 0
    const tail = this.text.slice(start)
    if (SEGMENTER === undefined) {
      for (const character of tail) {
        this.endings.push((this.endings[this.endings.length - 1] ?? start) + character.length)
      }
    } else {
      for (const segment of SEGMENTER.segment(tail)) {
        this.endings.push(start + segment.index + segment.segment.length)
      }
    }
    return this.endings.length > previous
  }
}
