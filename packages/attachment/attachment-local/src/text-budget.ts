/** Deterministically fit UTF-8 text without splitting a code point. */
export function fitUtf8(text: string, maxBytes: number): { text: string; truncated: boolean } {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new TypeError('UTF-8 byte budget must be a non-negative integer.')
  const encoded = new TextEncoder().encode(text)
  if (encoded.byteLength <= maxBytes) return { text, truncated: false }
  let end = maxBytes
  const decoder = new TextDecoder('utf-8', { fatal: true })
  while (end > 0) {
    try {
      return { text: decoder.decode(encoded.subarray(0, end)), truncated: true }
    } catch {
      end -= 1
    }
  }
  return { text: '', truncated: true }
}
