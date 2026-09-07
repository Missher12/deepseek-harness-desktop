/** Shared local-calendar projection for usage folds and snapshots. */

/**
 * Format one epoch millisecond as a canonical local date key.
 * @param time - Epoch millisecond to project.
 * @param timeZone - IANA time zone used for the calendar projection.
 * @returns Canonical YYYY-MM-DD date key independent of locale punctuation.
 */
export function usageDateKey(time: number, timeZone: string): string {
  return createUsageDateFormatter(timeZone)(time)
}

/**
 * Reuse one validated formatter for a session's calendar projection.
 * @param timeZone - IANA zone, validated when the formatter is created.
 * @returns A local date projector without per-event formatter initialization.
 */
export function createUsageDateFormatter(timeZone: string): (time: number) => string {
  const formatter = new Intl.DateTimeFormat('en', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return (time) => {
    const parts = formatter.formatToParts(time)
    const value = (type: Intl.DateTimeFormatPartTypes): string =>
      (parts.find(part => part.type === type) as Intl.DateTimeFormatPart).value
    return `${value('year')}-${value('month')}-${value('day')}`
  }
}
