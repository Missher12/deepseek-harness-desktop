interface Utf8Fit {
  text: string
  bytes: number
  truncated: boolean
}

function assertByteBudget(maxBytes: number): void {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new TypeError('UTF-8 byte budget must be a non-negative integer.')
}

function assertCharacterBudget(maxCharacters: number): void {
  if (!Number.isSafeInteger(maxCharacters) || maxCharacters < 0) {
    throw new TypeError('UTF-8 source-character budget must be a non-negative integer.')
  }
}

function fitUtf8Bytes(text: string, maxBytes: number): Utf8Fit {
  assertByteBudget(maxBytes)
  const encoded = new TextEncoder().encode(text)
  if (encoded.byteLength <= maxBytes) return { text, bytes: encoded.byteLength, truncated: false }
  let end = maxBytes
  const decoder = new TextDecoder('utf-8', { fatal: true })
  while (end > 0) {
    try {
      return { text: decoder.decode(encoded.subarray(0, end)), bytes: end, truncated: true }
    } catch {
      end -= 1
    }
  }
  return { text: '', bytes: 0, truncated: true }
}

/**
 * Deterministically fit UTF-8 text without splitting a code point.
 * @param text - source text to retain.
 * @param maxBytes - maximum UTF-8 bytes in the returned prefix.
 * @returns bounded text and whether source content was truncated.
 */
export function fitUtf8(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const fitted = fitUtf8Bytes(text, maxBytes)
  return { text: fitted.text, truncated: fitted.truncated }
}

/** Incremental UTF-8 output whose retained chunks can never exceed one byte budget. */
export class Utf8BudgetBuilder {
  private readonly chunks: string[] = []
  private readonly maxBytes: number
  private usedBytes = 0
  private cut = false

  constructor(maxBytes: number) {
    assertByteBudget(maxBytes)
    this.maxBytes = maxBytes
  }

  /** Current retained UTF-8 byte length. */
  get byteLength(): number {
    return this.usedBytes
  }

  /** Whether unretained source text has been observed. */
  get truncated(): boolean {
    return this.cut
  }

  /**
   * Append as much of one fragment as fits and report whether it fit completely.
   * @param value - source fragment to append.
   * @returns whether the complete fragment fit.
   */
  append(value: string): boolean {
    if (value === '') return true
    if (this.cut) return false
    const fitted = fitUtf8Bytes(value, this.maxBytes - this.usedBytes)
    if (fitted.text !== '') this.chunks.push(fitted.text)
    this.usedBytes += fitted.bytes
    if (fitted.truncated) this.cut = true
    return !fitted.truncated
  }

  /**
   * Append within both the output-byte budget and a source-character work limit.
   * @param value - source fragment to append.
   * @param maxCharacters - maximum UTF-16 source units inspected for this fragment.
   * @returns whether the complete fragment fit both limits.
   */
  appendBounded(value: string, maxCharacters: number): boolean {
    assertCharacterBudget(maxCharacters)
    if (value === '') return true
    if (this.cut) return false
    const remainingBytes = this.maxBytes - this.usedBytes
    const byteWorkLimit = remainingBytes === Number.MAX_SAFE_INTEGER ? remainingBytes : remainingBytes + 1
    let workCharacters = Math.min(value.length, maxCharacters, byteWorkLimit)
    if (workCharacters > 0 && workCharacters < value.length) {
      const last = value.charCodeAt(workCharacters - 1)
      const next = value.charCodeAt(workCharacters)
      if (last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) workCharacters -= 1
    }
    const complete = workCharacters === value.length
    const fitted = this.append(value.slice(0, workCharacters))
    if (!complete) this.cut = true
    return complete && fitted
  }

  /** Record omitted source content whose bounded prefix was already appended. */
  markTruncated(): void {
    this.cut = true
  }

  /**
   * Materialize the bounded output once extraction stops.
   * @returns retained text and whether any source content was omitted.
   */
  result(): { text: string; truncated: boolean } {
    return { text: this.chunks.join(''), truncated: this.cut }
  }
}
