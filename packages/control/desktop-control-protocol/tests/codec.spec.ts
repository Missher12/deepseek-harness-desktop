import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, expectTypeOf, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  BRIDGE_REQUEST_KINDS,
  CONTROL_KINDS,
  DesktopControlFrameDecoder,
  ERROR_CODES,
  HELPER_REQUEST_KINDS,
  ImmutablePng,
  LengthPrefixedFrameDecoder,
  PROTOCOL_LIMITS,
  PROTOCOL_VERSION,
  assertProtocolManifest,
  assertBridgeDeadline,
  BrowserRef,
  ComputerRef,
  ControlLeaseId,
  decodeJsonFrame,
  decodePngFrame,
  encodeJsonFrame,
  encodeLengthPrefixedFrame,
  encodePngFrame,
  PngTransferId,
  RequestId,
  type BridgeRequest,
  type HelperRequest,
  type DesktopControlOkResponse,
} from '../src/index.ts'

const REQUEST_ID = RequestId('00000000-0000-4000-8000-000000000001')
const LEASE_ID = ControlLeaseId('00000000-0000-4000-8000-000000000002')
const TRANSFER_ID = PngTransferId('00000000-0000-4000-8000-000000000003')
const SESSION_ID = 'session-1' as SessionId
const BROWSER_REF = BrowserRef('browser:00000000000000000000000000000004')
const COMPUTER_REF = ComputerRef('computer:00000000000000000000000000000005')

function jsonFrame(text: string): Uint8Array {
  return Uint8Array.from([0x01, ...new TextEncoder().encode(text)])
}

function statusRequest(): BridgeRequest {
  return {
    protocolVersion: 1,
    messageKind: 'request',
    requestKind: 'desktop.status',
    requestId: REQUEST_ID,
    sessionId: SESSION_ID,
    deadlineUnixMs: 2_000,
  }
}

describe('closed protocol manifest', () => {
  it('pins the complete bridge, helper, control, and error rosters', () => {
    expect(PROTOCOL_VERSION).toBe(1)
    expect(BRIDGE_REQUEST_KINDS).toEqual([
      'desktop.status',
      'browser.snapshot', 'browser.navigate', 'browser.click', 'browser.type',
      'browser.key', 'browser.select', 'browser.scroll', 'browser.wait',
      'browser.back', 'browser.forward', 'browser.reload', 'browser.stop',
      'computer.status', 'computer.list', 'computer.snapshot', 'computer.focus',
      'computer.click', 'computer.double-click', 'computer.drag', 'computer.type',
      'computer.key', 'computer.scroll', 'computer.wait', 'computer.stop',
    ])
    expect(HELPER_REQUEST_KINDS).toEqual([
      'status', 'list', 'snapshot', 'focus', 'click', 'double-click', 'drag',
      'type', 'key', 'scroll', 'wait', 'stop', 'lease.install', 'input.release',
    ])
    expect(CONTROL_KINDS).toEqual([
      'request.cancel', 'session.revoke', 'lease.revoke', 'parent.shutdown',
    ])
    expect(ERROR_CODES).toHaveLength(17)
    expect(() => assertProtocolManifest()).not.toThrow()
    expect(Object.isFrozen(BRIDGE_REQUEST_KINDS)).toBe(true)
    expect(Object.isFrozen(HELPER_REQUEST_KINDS)).toBe(true)
    expect(Object.isFrozen(CONTROL_KINDS)).toBe(true)
  })

  it('publishes every wire acceptance limit exactly once', () => {
    expect(PROTOCOL_LIMITS).toEqual({
      semanticTextBytes: 49_152,
      jsonPayloadBytes: 65_536,
      jsonFrameBytes: 65_537,
      pngBytes: 4_194_304,
      pngFrameBytes: 4_194_321,
      outerFrameBytes: 4_194_321,
      errorMessageBytes: 512,
      sessionIdBytes: 128,
      identifierBytes: 64,
      sha256Bytes: 64,
      appIdBytes: 256,
      windowIdBytes: 256,
      agentIdBytes: 256,
      urlBytes: 8_192,
      keyBytes: 64,
      selectValueBytes: 8_192,
      semanticRoleBytes: 128,
      semanticNameBytes: 1_024,
      appNameBytes: 256,
      windowTitleBytes: 1_024,
      browserTitleBytes: 2_048,
      surfaceIdBytes: 256,
      stringListItemBytes: 256,
      maxSafeInteger: Number.MAX_SAFE_INTEGER,
      maxStringListItems: 64,
      maxModifiers: 4,
      maxCoordinate: 1_000_000,
      maxWaitDurationMs: 10_000,
      maxLeaseCapabilities: 3,
      maxLeaseQuota: 1_000_000,
      maxIdleExpiresAfterMs: 300_000,
      maxHardExpiresAfterMs: 1_200_000,
      maxPngDimension: 100_000,
      maxSemanticRefs: 300,
      maxGrantableApps: 128,
      maxGrantableWindowsPerApp: 256,
      maxDeadlineAheadMs: 30_000,
      minHelperTimeoutMs: 1,
      maxHelperTimeoutMs: 30_000,
    })
  })

  it('keeps brands non-interchangeable and reuses SessionId', () => {
    expectTypeOf<RequestId>().not.toEqualTypeOf<ControlLeaseId>()
    expectTypeOf<BrowserRef>().not.toEqualTypeOf<ComputerRef>()
    expectTypeOf<BridgeRequest['sessionId']>().toEqualTypeOf<SessionId>()
    expect(BROWSER_REF).toContain('browser:')
    expect(COMPUTER_REF).toContain('computer:')
    expect(() => RequestId('1')).toThrow(/format/i)
    expect(() => ControlLeaseId('00000000-0000-4000-7000-000000000002')).toThrow(/format/i)
    expect(() => BrowserRef('computer:00000000000000000000000000000004')).toThrow(/format/i)
  })

  it('keeps Electron-only requests out of the child request union', () => {
    expectTypeOf<Extract<BridgeRequest, { requestKind: 'input.release' }>>().toBeNever()
    expectTypeOf<Extract<BridgeRequest, { requestKind: 'lease.install' }>>().toBeNever()
    expectTypeOf<Extract<HelperRequest, { requestKind: 'input.release' }>>().not.toBeNever()
  })

  it('rejects invalid wait and pointer combinations at the type boundary', () => {
    type InvalidDurationWait = {
      protocolVersion: 1
      messageKind: 'request'
      requestKind: 'browser.wait'
      requestId: typeof REQUEST_ID
      sessionId: typeof SESSION_ID
      deadlineUnixMs: number
      leaseId: typeof LEASE_ID
      leaseRevision: number
      mode: 'duration'
    }
    type InvalidPointer = {
      protocolVersion: 1
      messageKind: 'request'
      requestKind: 'computer.click'
      requestId: typeof REQUEST_ID
      sessionId: typeof SESSION_ID
      deadlineUnixMs: number
      leaseId: typeof LEASE_ID
      leaseRevision: number
      appId: string
      windowId: string
      snapshotRevision: number
      ref: typeof COMPUTER_REF
      x: number
      y: number
      button: 'left'
    }
    type InvalidHelperPointer = {
      protocolVersion: 1
      messageKind: 'request'
      requestKind: 'scroll'
      requestId: typeof REQUEST_ID
      sessionId: typeof SESSION_ID
      timeoutMs: number
      leaseId: typeof LEASE_ID
      leaseRevision: number
      appId: string
      windowId: string
      snapshotRevision: number
      ref: typeof COMPUTER_REF
      x: number
      y: number
      deltaX: number
      deltaY: number
    }
    expectTypeOf<InvalidDurationWait>().not.toExtend<BridgeRequest>()
    expectTypeOf<InvalidPointer>().not.toExtend<BridgeRequest>()
    expectTypeOf<InvalidHelperPointer>().not.toExtend<HelperRequest>()
  })
})

describe('strict JSON codec', () => {
  it('round-trips a valid request as detached frozen data', () => {
    const input = statusRequest()
    const frame = encodeJsonFrame(input)
    const decoded = decodeJsonFrame(frame)
    expect(decoded).toEqual(input)
    expect(decoded).not.toBe(input)
    expect(Object.isFrozen(decoded)).toBe(true)
  })

  it('freezes nested decoded arrays and objects', () => {
    const frame = encodeJsonFrame({
      protocolVersion: 1,
      messageKind: 'request',
      requestKind: 'browser.key',
      requestId: REQUEST_ID,
      sessionId: SESSION_ID,
      deadlineUnixMs: 2_000,
      leaseId: LEASE_ID,
      leaseRevision: 1,
      key: 'Enter',
      modifiers: ['Shift'],
    })
    const decoded = decodeJsonFrame(frame)
    expect(decoded).toMatchObject({ requestKind: 'browser.key' })
    if (decoded.messageKind !== 'request' || decoded.requestKind !== 'browser.key') throw new Error('wrong fixture kind')
    expect(Object.isFrozen(decoded.modifiers)).toBe(true)
  })

  it.each([
    ['duplicate top-level key', '{"protocolVersion":1,"protocolVersion":1,"messageKind":"request"}'],
    ['duplicate nested key', '{"protocolVersion":1,"messageKind":"response","requestId":"00000000-0000-4000-8000-000000000001","requestKind":"desktop.status","responseKind":"error","error":{"code":"INTERNAL","code":"BUSY","message":"x","retryable":false}}'],
    ['dangerous key', '{"protocolVersion":1,"messageKind":"request","requestKind":"desktop.status","requestId":"00000000-0000-4000-8000-000000000001","sessionId":"s","deadlineUnixMs":1,"__proto__":{}}'],
  ])('rejects %s before last-wins parsing', (_name, text) => {
    expect(() => decodeJsonFrame(jsonFrame(text))).toThrow(/duplicate|dangerous/i)
  })

  it('accepts only the four RFC 8259 whitespace bytes', () => {
    const encoded = new TextDecoder().decode(encodeJsonFrame(statusRequest()).subarray(1))
    expect(() => decodeJsonFrame(jsonFrame(`{\u00a0${encoded.slice(1)}`))).toThrow()
    expect(() => decodeJsonFrame(jsonFrame(`{\t\r\n ${encoded.slice(1)}`))).not.toThrow()
  })

  it.each([
    ['unknown field', { ...statusRequest(), extra: true }],
    ['missing field', { ...statusRequest(), requestId: undefined }],
    ['wrong type', { ...statusRequest(), deadlineUnixMs: '2000' }],
    ['unknown kind', { ...statusRequest(), requestKind: 'browser.evaluate' }],
    ['wrong version', { ...statusRequest(), protocolVersion: 2 }],
    ['null', null],
    ['array', []],
    ['primitive', 1],
  ])('rejects %s', (_name, value) => {
    const text = JSON.stringify(value)
    expect(() => decodeJsonFrame(jsonFrame(text))).toThrow()
  })

  it('enforces exact UTF-8 bounds and safe numeric values', () => {
    const semantic = '界'.repeat(PROTOCOL_LIMITS.semanticTextBytes / 3)
    const response = {
      protocolVersion: 1,
      messageKind: 'response',
      responseKind: 'ok',
      requestKind: 'browser.snapshot',
      requestId: REQUEST_ID,
      result: {
        surfaceId: 'surface-1',
        url: 'https://example.test/',
        title: 'Example',
        snapshotRevision: 1,
        semanticText: semantic,
        refs: [{ ref: BROWSER_REF, role: 'button', name: 'Go' }],
      },
    } as const
    expect(() => encodeJsonFrame(response)).not.toThrow()
    expect(() => encodeJsonFrame({
      ...response,
      result: { ...response.result, semanticText: `${semantic}a` },
    })).toThrow(/semantic/i)
    expect(() => encodeJsonFrame({ ...statusRequest(), deadlineUnixMs: Number.NaN })).toThrow(/deadline/i)
    expect(() => encodeJsonFrame({ ...statusRequest(), deadlineUnixMs: -0 })).toThrow(/deadline/i)
    expect(() => encodeJsonFrame({ ...statusRequest(), sessionId: '界'.repeat(43) as SessionId })).toThrow(/sessionId/i)
  })

  it('binds closed response results to requestKind', () => {
    const wrong = {
      protocolVersion: 1,
      messageKind: 'response',
      responseKind: 'ok',
      requestKind: 'desktop.status',
      requestId: REQUEST_ID,
      result: { stopped: true },
    }
    expect(() => encodeJsonFrame(wrong as never)).toThrow(/result|unknown field/i)
    expectTypeOf<typeof wrong>().not.toExtend<DesktopControlOkResponse>()
  })

  it('limits error messages by UTF-8 bytes', () => {
    const response = {
      protocolVersion: 1,
      messageKind: 'response',
      responseKind: 'error',
      requestKind: 'desktop.status',
      requestId: REQUEST_ID,
      error: { code: 'INTERNAL', message: '界'.repeat(170), retryable: false },
    } as const
    expect(() => encodeJsonFrame(response)).not.toThrow()
    expect(() => encodeJsonFrame({
      ...response,
      error: { ...response.error, message: `${response.error.message}界` },
    })).toThrow(/message/i)
  })

  it('validates bridge deadlines only when the caller supplies its current time', () => {
    expect(() => assertBridgeDeadline(statusRequest(), 1_000)).not.toThrow()
    expect(() => assertBridgeDeadline({ ...statusRequest(), deadlineUnixMs: 31_001 }, 1_000)).toThrow(/30 seconds/i)
    expect(() => assertBridgeDeadline({ ...statusRequest(), deadlineUnixMs: 999 }, 1_000)).toThrow(/current/i)
  })

  it('enforces helper timeout limits and Electron-only field matrices', () => {
    const release: HelperRequest = {
      protocolVersion: 1,
      messageKind: 'request',
      requestKind: 'input.release',
      requestId: REQUEST_ID,
      sessionId: SESSION_ID,
      timeoutMs: 1,
      keys: ['Shift'],
      buttons: ['left'],
    }
    expect(() => encodeJsonFrame(release)).not.toThrow()
    expect(() => encodeJsonFrame({ ...release, timeoutMs: 0 } as never)).toThrow(/timeoutMs/i)
    expect(() => encodeJsonFrame({ ...release, leaseId: LEASE_ID } as never)).toThrow(/leaseId/i)
  })
})

describe('binary framing', () => {
  it('accepts exact JSON/PNG limits and rejects one byte above them', () => {
    const requestText = JSON.stringify(statusRequest())
    const exactText = `${requestText}${' '.repeat(PROTOCOL_LIMITS.jsonPayloadBytes - requestText.length)}`
    const exactJson = jsonFrame(exactText)
    expect(exactJson).toHaveLength(PROTOCOL_LIMITS.jsonFrameBytes)
    expect(decodeJsonFrame(exactJson)).toEqual(statusRequest())
    expect(() => encodeLengthPrefixedFrame(exactJson)).not.toThrow()
    expect(() => decodeJsonFrame(jsonFrame(`${exactText} `))).toThrow(/payload/i)
    const oversizedJson = new Uint8Array(PROTOCOL_LIMITS.jsonFrameBytes + 1)
    oversizedJson[0] = 0x01
    expect(() => encodeLengthPrefixedFrame(oversizedJson)).toThrow()

    const exactPng = new Uint8Array(PROTOCOL_LIMITS.pngFrameBytes)
    exactPng[0] = 0x02
    expect(exactPng).toHaveLength(PROTOCOL_LIMITS.pngFrameBytes)
    expect(() => encodeLengthPrefixedFrame(exactPng)).not.toThrow()
    const oversizedPng = new Uint8Array(PROTOCOL_LIMITS.pngFrameBytes + 1)
    oversizedPng[0] = 0x02
    expect(() => encodeLengthPrefixedFrame(oversizedPng)).toThrow()
  })

  it('rejects zero and oversized prefixes before body allocation', () => {
    const decoder = new LengthPrefixedFrameDecoder()
    expect(() => decoder.push(Uint8Array.of(0, 0, 0, 0))).toThrow(/length/i)
    const tooLarge = PROTOCOL_LIMITS.pngFrameBytes + 1
    expect(() => new LengthPrefixedFrameDecoder().push(Uint8Array.of(
      (tooLarge >>> 24) & 0xff, (tooLarge >>> 16) & 0xff,
      (tooLarge >>> 8) & 0xff, tooLarge & 0xff,
    ))).toThrow(/length/i)
  })

  it('handles split headers, split bodies, and coalesced frames', () => {
    const first = encodeLengthPrefixedFrame(encodeJsonFrame(statusRequest()))
    const second = encodeLengthPrefixedFrame(encodeJsonFrame({
      ...statusRequest(), requestId: RequestId('00000000-0000-4000-8000-000000000006'),
    }))
    const stream = Uint8Array.from([...first, ...second])
    const decoder = new LengthPrefixedFrameDecoder()
    expect(decoder.push(stream.subarray(0, 2))).toEqual([])
    expect(decoder.push(stream.subarray(2, 7))).toEqual([])
    const frames = decoder.push(stream.subarray(7))
    expect(frames).toHaveLength(2)
    expect(decodeJsonFrame(frames[0]!)).toMatchObject({ requestId: REQUEST_ID })
    expect(() => decoder.finish()).not.toThrow()
  })
})

describe('PNG correlation and immutability', () => {
  it('correlates the immediate raw PNG frame and returns copies', async () => {
    const png = new Uint8Array(await readFile(resolve(import.meta.dirname, '../fixtures/tiny.png')))
    const metadataFrame = new Uint8Array(await readFile(resolve(import.meta.dirname, '../fixtures/browser-snapshot-json.bin')))
    const pngFrame = new Uint8Array(await readFile(resolve(import.meta.dirname, '../fixtures/browser-snapshot-png.bin')))
    const decoder = new DesktopControlFrameDecoder()
    expect(decoder.pushFrame(metadataFrame)).toEqual([])
    const [envelope] = decoder.pushFrame(pngFrame)
    expect(envelope?.png).toBeInstanceOf(ImmutablePng)
    expect(envelope?.png?.read()).toEqual(png)
    const first = envelope!.png!.read()
    first[0] = 0
    expect(envelope!.png!.read()[0]).toBe(0x89)
    expect(Object.isFrozen(envelope)).toBe(true)
    expect(Object.isFrozen(envelope!.message)).toBe(true)
    expect(encodePngFrame(TRANSFER_ID, png)).toEqual(pngFrame)
    expect(decodePngFrame(pngFrame).transferId).toBe(TRANSFER_ID)
  })

  it('fails closed on orphan, mismatch, invalid dimensions, and late metadata', async () => {
    const png = new Uint8Array(await readFile(resolve(import.meta.dirname, '../fixtures/tiny.png')))
    expect(() => new DesktopControlFrameDecoder().pushFrame(encodePngFrame(TRANSFER_ID, png))).toThrow(/orphan/i)
    const pending = new DesktopControlFrameDecoder()
    const metadataFrame = new Uint8Array(await readFile(resolve(import.meta.dirname, '../fixtures/browser-snapshot-json.bin')))
    pending.pushFrame(metadataFrame)
    expect(() => pending.pushFrame(encodePngFrame(
      PngTransferId('00000000-0000-4000-8000-000000000007'), png,
    ))).toThrow(/transfer/i)
    const late = new DesktopControlFrameDecoder()
    late.pushFrame(metadataFrame)
    expect(() => late.pushFrame(encodeJsonFrame(statusRequest()))).toThrow(/expected.*PNG/i)
    expect(() => new DesktopControlFrameDecoder().finish()).not.toThrow()
    expect(() => new DesktopControlFrameDecoder().pushFrame(Uint8Array.of(0x02))).toThrow()
  })

  it('accepts exactly 4,194,304 PNG bytes and rejects one more', async () => {
    const tiny = new Uint8Array(await readFile(resolve(import.meta.dirname, '../fixtures/tiny.png')))
    const exact = new Uint8Array(PROTOCOL_LIMITS.pngBytes)
    exact.set(tiny)
    expect(encodePngFrame(TRANSFER_ID, exact)).toHaveLength(PROTOCOL_LIMITS.pngFrameBytes)
    const oversized = new Uint8Array(PROTOCOL_LIMITS.pngBytes + 1)
    oversized.set(tiny)
    expect(() => encodePngFrame(TRANSFER_ID, oversized)).toThrow(/limit/i)
  })

  it.each([
    ['hash', { sha256: '0'.repeat(64) }, /hash/i],
    ['dimensions', { width: 2 }, /dimensions/i],
    ['byte length', { byteLength: 70 }, /byte length/i],
  ])('closes after a PNG %s mismatch', async (_name, override, expected) => {
    const png = new Uint8Array(await readFile(resolve(import.meta.dirname, '../fixtures/tiny.png')))
    const metadata = {
      protocolVersion: 1,
      messageKind: 'response',
      responseKind: 'ok',
      requestKind: 'browser.snapshot',
      requestId: REQUEST_ID,
      result: {
        surfaceId: 'surface-1',
        url: 'https://example.test/',
        title: 'Example',
        snapshotRevision: 1,
        semanticText: '',
        refs: [],
        image: {
          transferId: TRANSFER_ID,
          byteLength: png.byteLength,
          sha256: createHash('sha256').update(png).digest('hex'),
          width: 1,
          height: 1,
          ...override,
        },
      },
    } as const
    const decoder = new DesktopControlFrameDecoder()
    decoder.pushFrame(encodeJsonFrame(metadata))
    expect(() => decoder.pushFrame(encodePngFrame(TRANSFER_ID, png))).toThrow(expected)
    expect(() => decoder.pushFrame(encodeJsonFrame(statusRequest()))).toThrow(/closed/i)
  })

  it('closes when input ends after image metadata', async () => {
    const metadataFrame = new Uint8Array(await readFile(resolve(import.meta.dirname, '../fixtures/browser-snapshot-json.bin')))
    const decoder = new DesktopControlFrameDecoder()
    decoder.pushFrame(metadataFrame)
    expect(() => decoder.finish()).toThrow(/PNG/i)
    expect(() => decoder.pushFrame(metadataFrame)).toThrow(/closed/i)
  })
})

describe('published fixtures and forbidden vocabulary', () => {
  it('decodes and re-encodes every raw frame byte-for-byte', async () => {
    const names = ['status-request.bin', 'browser-snapshot-json.bin', 'browser-snapshot-png.bin']
    const inventory = (await readdir(resolve(import.meta.dirname, '../fixtures'))).filter(name => name.endsWith('.bin')).sort()
    expect(inventory).toEqual([...names].sort())
    for (const name of names) {
      const bytes = new Uint8Array(await readFile(resolve(import.meta.dirname, `../fixtures/${name}`)))
      if (bytes[0] === 0x01) expect(encodeJsonFrame(decodeJsonFrame(bytes))).toEqual(bytes)
      else {
        const decoded = decodePngFrame(bytes)
        expect(encodePngFrame(decoded.transferId, decoded.png.read())).toEqual(bytes)
      }
    }
  })

  it('contains no generic escape vocabulary in protocol source or manifest', async () => {
    const files = ['brand.ts', 'bridge.ts', 'helper.ts', 'fields.ts', 'codec.ts', 'index.ts', '../protocol-v1.json']
    const forbidden = [
      'command', 'script', 'selector', 'javascript', 'method', 'args', 'env',
      'cwd', 'path', 'channel', 'ipc', 'payload: unknown', 'data: unknown',
      'Record<', '[key: string]', '[key: number]',
    ]
    for (const file of files) {
      const source = await readFile(resolve(import.meta.dirname, `../src/${file}`), 'utf8')
      for (const word of forbidden) {
        const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const expression = word.includes(' ') || word.includes(':') || word.includes('[')
          ? new RegExp(escaped, 'iu')
          : new RegExp(`\\b${escaped}\\b`, 'iu')
        expect(source).not.toMatch(expression)
      }
    }
  })
})
