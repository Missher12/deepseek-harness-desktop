/** Desktop authority services withheld from model-authored dynamic packages and model-visible inspection. */
export const PRIVILEGED_CONTROL_SERVICE_KEYS = Object.freeze([
  'browserControl',
  'computerControl',
] as const)

const PRIVILEGED_CONTROL_SERVICE_KEY_SET: ReadonlySet<string> = new Set(PRIVILEGED_CONTROL_SERVICE_KEYS)

/**
 * Test whether a Cordis service key controls privileged Desktop execution.
 * @param key - Runtime Cordis service key.
 * @returns true only for a closed privileged-control service key.
 */
export function isPrivilegedControlService(key: string): boolean {
  return PRIVILEGED_CONTROL_SERVICE_KEY_SET.has(key)
}
