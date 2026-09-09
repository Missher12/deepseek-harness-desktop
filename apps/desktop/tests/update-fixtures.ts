import type { DesktopUpdateTarget } from '../src/update/release.ts'

/** Inert format-shaped bytes; never executed or presented as native installer evidence. */
export function updatePayload(format: DesktopUpdateTarget['packageFormat']): Buffer<ArrayBuffer> {
  const bytes = Buffer.alloc(1024)
  if (format === 'dmg') bytes.write('koly', bytes.length - 512, 'ascii')
  if (format === 'nsis') {
    bytes.write('MZ', 0, 'ascii')
    bytes.writeUInt32LE(64, 0x3c)
    bytes.write('PE\0\0', 64, 'ascii')
    bytes.writeUInt16LE(0x14c, 68) // NSIS may use a PE32 bootstrap for x64 payloads.
    bytes.writeUInt16LE(0x10b, 88)
  }
  if (format === 'deb') {
    bytes.write('!<arch>\ndebian-binary   ', 0, 'ascii')
    bytes.write('2.0\n', 68, 'ascii')
  }
  if (format === 'appimage') {
    bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1], 0)
    bytes.set([0x41, 0x49, 2], 8)
    bytes.writeUInt16LE(62, 18)
  }
  return bytes
}
