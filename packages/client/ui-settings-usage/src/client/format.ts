/** Locale-aware compact display helpers for usage metrics. */

/**
 * Compact a non-negative count for a KPI or ranked row.
 * @param value - Count to format.
 * @param locale - BCP 47 locale used by the number formatter.
 * @returns Locale-aware compact text.
 */
export function formatCompactNumber(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
}
/**
 * Render a completed duration without implying sub-minute precision.
 * @param value - Completed duration in milliseconds.
 * @param locale - BCP 47 locale used to select English or Chinese units.
 * @returns Human-readable whole-minute duration text.
 */
export function formatDuration(value: number, locale: string): string {
  const totalMinutes = Math.max(0, Math.floor(value / 60_000))
  const days = Math.floor(totalMinutes / (24 * 60))
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60)
  const minutes = totalMinutes % 60
  const zh = locale.toLocaleLowerCase().startsWith('zh')
  if (zh) {
    if (days > 0) return `${days} 天 ${hours} 小时`
    if (hours > 0) return `${hours} 小时 ${minutes} 分`
    return `${minutes} 分`
  }
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

/**
 * Extract a concise model label while preserving provider identity when useful.
 * @param value - Provider-qualified model label, or no observed model.
 * @returns The observed model label or an em dash placeholder.
 */
export function formatModel(value: string | null): string {
  return value ?? '—'
}
