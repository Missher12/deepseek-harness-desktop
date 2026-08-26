/** Load independent persisted window inputs concurrently. */
export async function readDesktopWindowPrerequisites<T>(
  preferencesReady: Promise<unknown>,
  readBounds: () => Promise<T>,
): Promise<T> {
  const [, bounds] = await Promise.all([preferencesReady, readBounds()])
  return bounds
}
