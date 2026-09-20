/**
 * Sign local macOS runtime helpers before their integrity inventory is sealed.
 * @param root Absolute prepared runtime directory.
 * @returns Completion after every Mach-O signature is verified.
 */
export declare function signAdHocRuntime(root: string): Promise<void>;

/** Return the local Intel Mac electron-builder configuration. */
export default function localMacConfig(): Record<string, unknown>;
