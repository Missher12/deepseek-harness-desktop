/** Identify the native macOS Desktop renderer without affecting ordinary Web. */
export function isMacDesktopSurface(search: string, userAgent: string): boolean {
  return new URLSearchParams(search).get('surface') === 'desktop'
    && /Macintosh|Mac OS X/u.test(userAgent)
}
