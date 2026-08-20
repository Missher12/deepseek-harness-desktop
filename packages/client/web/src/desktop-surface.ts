/**
 * Identify the native macOS Desktop renderer without affecting ordinary Web.
 * @param search - current location search string.
 * @param userAgent - current browser user-agent string.
 * @returns whether both Desktop and macOS markers are present.
 */
export function isMacDesktopSurface(search: string, userAgent: string): boolean {
  return new URLSearchParams(search).get('surface') === 'desktop'
    && /Macintosh|Mac OS X/u.test(userAgent)
}
