/**
 * Identify an explicit native Desktop renderer without affecting ordinary Web.
 * @param search - current location search string.
 * @returns whether the Desktop marker is present.
 */
export function isDesktopSurface(search: string): boolean {
  return new URLSearchParams(search).get('surface') === 'desktop'
}
