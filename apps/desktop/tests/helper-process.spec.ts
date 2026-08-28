import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import {
  LengthPrefixedFrameDecoder,
  RequestId,
  SessionId,
  encodeJsonFrame,
  encodeLengthPrefixedFrame,
  type HelperRequest,
  type HelperInputReleaseRequest,
} from '@deepseek-ai/dsh-desktop-control-protocol'
import {
  NativeHelperProcess,
  NativeHelperProcessError,
  type SpawnNativeHelper,
} from '../src/control/helper-process.ts'

class FakeChild extends EventEmitter {
  readonly stdin = new PassThrough()
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  readonly kill = vi.fn(() => true)
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null

  exit(code = 0): void {
    this.exitCode = code
    this.emit('exit', code, null)
  }

  spawned(): void {
    this.emit('spawn')
  }

  closed(): void {
    this.emit('close', this.exitCode, this.signalCode)
  }
}

function asChild(child: FakeChild): ChildProcessWithoutNullStreams {
  return child as unknown as ChildProcessWithoutNullStreams
}

function statusRequest(requestId = '00000000-0000-4000-8000-000000000001'): HelperRequest {
  return {
    protocolVersion: 1,
    messageKind: 'request',
    requestKind: 'status',
    requestId: RequestId(requestId),
    sessionId: SessionId('session-1'),
    timeoutMs: 1_000,
  }
}

function inputReleaseRequest(): HelperInputReleaseRequest {
  return {
    protocolVersion: 1,
    messageKind: 'request',
    requestKind: 'input.release',
    requestId: RequestId('50000000-0000-4000-8000-000000000001'),
    sessionId: SessionId('session-1'),
    timeoutMs: 1_000,
    keys: ['A', 'Meta'],
    buttons: ['left'],
  }
}

function framedMessages(chunks: readonly Uint8Array[]): Record<string, unknown>[] {
  const decoder = new LengthPrefixedFrameDecoder()
  return chunks.flatMap(chunk => decoder.push(chunk)).map((frame) => {
    expect(frame[0]).toBe(0x01)
    return JSON.parse(new TextDecoder().decode(frame.subarray(1))) as Record<string, unknown>
  })
}

describe('NativeHelperProcess', () => {
  it('does not create a helper process while idle', () => {
    const spawn = vi.fn<SpawnNativeHelper>(() => { throw new Error('idle helper must not spawn') })

    const helper = new NativeHelperProcess({
      binaryPath: '/verified/computer-use-helper',
      spawn,
    })

    expect(helper.running).toBe(false)
    expect(spawn).not.toHaveBeenCalled()
    helper.sendControl({ protocolVersion: 1, messageKind: 'control', controlKind: 'parent.shutdown' })
    expect(spawn).not.toHaveBeenCalled()
  })

  it('spawns once on first request and correlates a split bounded response', async () => {
    const child = new FakeChild()
    const spawn = vi.fn<SpawnNativeHelper>(() => asChild(child))
    const helper = new NativeHelperProcess({
      binaryPath: '/verified/computer-use-helper',
      spawn,
    })
    const written = new Promise<Uint8Array>((resolve) => {
      child.stdin.once('data', (chunk: Buffer) => { resolve(new Uint8Array(chunk)) })
    })

    const pending = helper.request(statusRequest())
    const outbound = new LengthPrefixedFrameDecoder().push(await written)
    expect(outbound).toHaveLength(1)
    expect(spawn).toHaveBeenCalledWith('/verified/computer-use-helper', [], {
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const response = encodeLengthPrefixedFrame(encodeJsonFrame({
      protocolVersion: 1,
      messageKind: 'response',
      responseKind: 'ok',
      requestKind: 'status',
      requestId: statusRequest().requestId,
      result: { viewing: 'unknown', assistive: 'unknown', supported: false },
    }))
    child.stdout.write(response.subarray(0, 3))
    child.stdout.write(response.subarray(3))

    await expect(pending).resolves.toMatchObject({
      message: { requestKind: 'status', responseKind: 'ok' },
    })
    expect(spawn).toHaveBeenCalledOnce()
    expect(helper.running).toBe(true)
  })

  it('rejects mismatched responses and crashes with a bounded generic error', async () => {
    const child = new FakeChild()
    const helper = new NativeHelperProcess({
      binaryPath: '/verified/computer-use-helper',
      spawn: () => asChild(child),
    })
    const pending = helper.request(statusRequest())
    const response = encodeLengthPrefixedFrame(encodeJsonFrame({
      protocolVersion: 1,
      messageKind: 'response',
      responseKind: 'ok',
      requestKind: 'list',
      requestId: statusRequest().requestId,
      result: { apps: [] },
    }))
    child.stdout.write(response)

    await Promise.resolve()
    expect(helper.running).toBe(true)
    await expect(helper.request(statusRequest())).rejects.toEqual(expect.objectContaining({
      code: 'DISCONNECTED',
    }))
    child.exit()
    await expect(pending).rejects.toEqual(expect.objectContaining({
      code: 'DISCONNECTED',
      message: 'Native Computer Use helper disconnected.',
    }))
    expect(helper.running).toBe(false)
  })

  it('ends stdin on shutdown and waits for the exact owned child', async () => {
    const child = new FakeChild()
    const written: Uint8Array[] = []
    child.stdin.on('data', (chunk: Buffer) => { written.push(new Uint8Array(chunk)) })
    const helper = new NativeHelperProcess({
      binaryPath: '/verified/computer-use-helper',
      spawn: () => asChild(child),
    })
    const pending = helper.request(statusRequest())
    child.stdout.write(encodeLengthPrefixedFrame(encodeJsonFrame({
      protocolVersion: 1,
      messageKind: 'response',
      responseKind: 'ok',
      requestKind: 'status',
      requestId: statusRequest().requestId,
      result: { viewing: 'unknown', assistive: 'unknown', supported: false },
    })))
    await pending

    const shutdown = helper.shutdown()
    expect(child.stdin.writableEnded).toBe(true)
    expect(framedMessages(written).at(-1)).toEqual({
      protocolVersion: 1,
      messageKind: 'control',
      controlKind: 'parent.shutdown',
    })
    child.exit()
    await expect(shutdown).resolves.toBeUndefined()
    expect(helper.running).toBe(false)
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('exports a closed generic error shape', () => {
    const error = new NativeHelperProcessError('TIMEOUT')
    expect(error).toMatchObject({ code: 'TIMEOUT', message: 'Native Computer Use helper timed out.' })
  })

  it('rejects shutdown when the killed helper never exits and retains fail-closed ownership', async () => {
    const child = new FakeChild()
    child.kill.mockReturnValue(false)
    const helper = new NativeHelperProcess({
      binaryPath: '/verified/computer-use-helper',
      spawn: () => asChild(child),
      shutdownTimeoutMs: 1,
    })
    const pending = helper.request(statusRequest())
    const pendingFailure = expect(pending).rejects.toEqual(expect.objectContaining({ code: 'CANCELLED' }))

    await expect(helper.shutdown()).rejects.toEqual(expect.objectContaining({
      code: 'DISCONNECTED',
      message: 'Native Computer Use helper disconnected.',
    }))
    await pendingFailure
    expect(child.kill).toHaveBeenNthCalledWith(1, 'SIGTERM')
    expect(child.kill).toHaveBeenNthCalledWith(2, 'SIGKILL')
    expect(helper.running).toBe(true)
    await expect(helper.request(statusRequest())).rejects.toEqual(expect.objectContaining({
      code: 'DISCONNECTED',
    }))

    child.exit()
    expect(helper.running).toBe(false)
  })

  it('sends exact timeout and abort cancellation before settling and ignores late tombstoned replies', async () => {
    const child = new FakeChild()
    const written: Uint8Array[] = []
    child.stdin.on('data', (chunk: Buffer) => { written.push(new Uint8Array(chunk)) })
    const helper = new NativeHelperProcess({
      binaryPath: '/verified/computer-use-helper',
      spawn: () => asChild(child),
    })
    const timedRequest = { ...statusRequest(), timeoutMs: 1 }

    await expect(helper.request(timedRequest)).rejects.toEqual(expect.objectContaining({ code: 'TIMEOUT' }))
    expect(framedMessages(written)).toContainEqual({
      protocolVersion: 1,
      messageKind: 'control',
      controlKind: 'request.cancel',
      sessionId: 'session-1',
      requestId: timedRequest.requestId,
    })

    child.stdout.write(encodeLengthPrefixedFrame(encodeJsonFrame({
      protocolVersion: 1,
      messageKind: 'response',
      responseKind: 'ok',
      requestKind: 'status',
      requestId: timedRequest.requestId,
      result: { viewing: 'unknown', assistive: 'unknown', supported: false },
    })))
    expect(helper.running).toBe(true)

    const controller = new AbortController()
    const abortedRequest = statusRequest('00000000-0000-4000-8000-000000000002')
    const aborted = helper.request(abortedRequest, controller.signal)
    controller.abort()
    await expect(aborted).rejects.toEqual(expect.objectContaining({ code: 'CANCELLED' }))
    expect(framedMessages(written)).toContainEqual({
      protocolVersion: 1,
      messageKind: 'control',
      controlKind: 'request.cancel',
      sessionId: 'session-1',
      requestId: abortedRequest.requestId,
    })
  })

  it('releases ownership after an asynchronous pre-spawn error and permits one clean retry', async () => {
    const first = new FakeChild()
    const second = new FakeChild()
    const spawn = vi.fn<SpawnNativeHelper>()
      .mockReturnValueOnce(asChild(first))
      .mockReturnValueOnce(asChild(second))
    const helper = new NativeHelperProcess({
      binaryPath: '/verified/computer-use-helper',
      spawn,
    })
    const failed = helper.request(statusRequest())
    first.emit('error', new Error('ENOENT: SENSITIVE RAW PATH'))

    await expect(failed).rejects.toEqual(expect.objectContaining({
      code: 'DISCONNECTED',
      message: 'Native Computer Use helper disconnected.',
    }))
    expect(first.kill).not.toHaveBeenCalled()
    expect(helper.running).toBe(false)

    const retryRequest = statusRequest('00000000-0000-4000-8000-000000000002')
    const retry = helper.request(retryRequest)
    second.spawned()
    second.stdout.write(encodeLengthPrefixedFrame(encodeJsonFrame({
      protocolVersion: 1,
      messageKind: 'response',
      responseKind: 'ok',
      requestKind: 'status',
      requestId: retryRequest.requestId,
      result: { viewing: 'unknown', assistive: 'unknown', supported: false },
    })))
    await expect(retry).resolves.toMatchObject({ message: { responseKind: 'ok' } })
    expect(spawn).toHaveBeenCalledTimes(2)
  })

  it('retains a confirmed child and its pending request until the real close boundary', async () => {
    const child = new FakeChild()
    const helper = new NativeHelperProcess({
      binaryPath: '/verified/computer-use-helper',
      spawn: () => asChild(child),
    })
    let settled = false
    const pending = helper.request(statusRequest())
    void pending.catch(() => {}).finally(() => { settled = true })
    child.spawned()
    child.emit('error', new Error('started child failed'))

    await Promise.resolve()
    expect(settled).toBe(false)
    expect(helper.running).toBe(true)
    await expect(helper.request(statusRequest('00000000-0000-4000-8000-000000000002')))
      .rejects.toEqual(expect.objectContaining({ code: 'DISCONNECTED' }))

    child.closed()
    await expect(pending).rejects.toEqual(expect.objectContaining({ code: 'DISCONNECTED' }))
    expect(helper.running).toBe(false)
  })

  it('reports one unexpected confirmed-child exit but not idle, pre-spawn failure, or shutdown', async () => {
    const first = new FakeChild()
    const second = new FakeChild()
    const third = new FakeChild()
    const onUnexpectedExit = vi.fn()
    const helper = new NativeHelperProcess({
      binaryPath: '/verified/computer-use-helper',
      spawn: vi.fn<SpawnNativeHelper>()
        .mockReturnValueOnce(asChild(first))
        .mockReturnValueOnce(asChild(second))
        .mockReturnValueOnce(asChild(third)),
      onUnexpectedExit,
    })

    expect(onUnexpectedExit).not.toHaveBeenCalled()
    const preSpawn = helper.request(statusRequest())
    first.emit('error', new Error('ENOENT'))
    await expect(preSpawn).rejects.toEqual(expect.objectContaining({ code: 'DISCONNECTED' }))
    expect(onUnexpectedExit).not.toHaveBeenCalled()

    const crashed = helper.request(statusRequest('00000000-0000-4000-8000-000000000002'))
    second.spawned()
    second.exit(1)
    await expect(crashed).rejects.toEqual(expect.objectContaining({ code: 'DISCONNECTED' }))
    expect(onUnexpectedExit).toHaveBeenCalledOnce()

    const shuttingDown = helper.request(statusRequest('00000000-0000-4000-8000-000000000003'))
    third.spawned()
    const shutdown = helper.shutdown()
    await expect(shuttingDown).rejects.toEqual(expect.objectContaining({ code: 'CANCELLED' }))
    third.exit()
    await shutdown
    expect(onUnexpectedExit).toHaveBeenCalledOnce()
  })

  it('reports a confirmed link failure before rejecting its in-flight action', async () => {
    const child = new FakeChild()
    const order: string[] = []
    const helper = new NativeHelperProcess({
      binaryPath: '/verified/computer-use-helper',
      spawn: () => asChild(child),
      onUnexpectedExit: () => { order.push(helper.running ? 'crash-running' : 'crash-detached') },
    })
    const pending = helper.request(statusRequest()).catch((error: unknown) => {
      order.push('rejected')
      throw error
    })
    child.spawned()
    child.emit('error', new Error('confirmed link failed'))

    expect(order).toEqual([])
    child.closed()
    expect(order).toEqual(['crash-detached'])
    await expect(pending).rejects.toMatchObject({ code: 'DISCONNECTED' })
    expect(order).toEqual(['crash-detached', 'rejected'])
  })

  it('stops only after the last concurrent request and can spawn a new child later', async () => {
    const first = new FakeChild()
    const second = new FakeChild()
    const spawn = vi.fn<SpawnNativeHelper>()
      .mockReturnValueOnce(asChild(first))
      .mockReturnValueOnce(asChild(second))
    const written: Uint8Array[] = []
    first.stdin.on('data', (chunk: Buffer) => { written.push(new Uint8Array(chunk)) })
    const helper = new NativeHelperProcess({
      binaryPath: '/verified/computer-use-helper',
      spawn,
    })
    const firstRequest = statusRequest()
    const secondRequest = statusRequest('00000000-0000-4000-8000-000000000002')
    const pendingFirst = helper.request(firstRequest)
    const pendingSecond = helper.request(secondRequest)
    first.stdout.write(encodeLengthPrefixedFrame(encodeJsonFrame({
      protocolVersion: 1, messageKind: 'response', responseKind: 'ok',
      requestKind: 'status', requestId: firstRequest.requestId,
      result: { viewing: 'unknown', assistive: 'unknown', supported: false },
    })))
    await pendingFirst
    await helper.stopWhenIdle()
    expect(framedMessages(written)).not.toContainEqual(expect.objectContaining({ controlKind: 'parent.shutdown' }))

    first.stdout.write(encodeLengthPrefixedFrame(encodeJsonFrame({
      protocolVersion: 1, messageKind: 'response', responseKind: 'ok',
      requestKind: 'status', requestId: secondRequest.requestId,
      result: { viewing: 'unknown', assistive: 'unknown', supported: false },
    })))
    await pendingSecond
    const stopped = helper.stopWhenIdle()
    expect(framedMessages(written).at(-1)).toMatchObject({ controlKind: 'parent.shutdown' })
    first.exit()
    await stopped
    expect(helper.running).toBe(false)

    const next = helper.request(statusRequest('00000000-0000-4000-8000-000000000003'))
    second.stdout.write(encodeLengthPrefixedFrame(encodeJsonFrame({
      protocolVersion: 1, messageKind: 'response', responseKind: 'ok',
      requestKind: 'status', requestId: RequestId('00000000-0000-4000-8000-000000000003'),
      result: { viewing: 'unknown', assistive: 'unknown', supported: false },
    })))
    await next
    expect(spawn).toHaveBeenCalledTimes(2)
  })

  it('makes application shutdown permanent even when no child has started', async () => {
    const spawn = vi.fn<SpawnNativeHelper>(() => { throw new Error('must remain closed') })
    const helper = new NativeHelperProcess({ binaryPath: '/verified/computer-use-helper', spawn })

    await helper.shutdown()
    await expect(helper.request(statusRequest())).rejects.toMatchObject({ code: 'DISCONNECTED' })
    expect(spawn).not.toHaveBeenCalled()
  })

  it('uses one fresh helper for concurrent recovery after exact binary re-verification', async () => {
    const crashed = new FakeChild()
    const fresh = new FakeChild()
    const spawn = vi.fn<SpawnNativeHelper>()
      .mockReturnValueOnce(asChild(crashed))
      .mockReturnValueOnce(asChild(fresh))
    const readBinary = vi.fn(() => new Uint8Array([1, 2, 3]))
    const helper = new NativeHelperProcess({
      binaryPath: '/verified/computer-use-helper',
      spawn,
      lstatBinary: () => ({ isFile: () => true, isSymbolicLink: () => false }),
      readBinary,
    })
    const initial = helper.request(statusRequest())
    crashed.spawned()
    crashed.stdout.write(encodeLengthPrefixedFrame(encodeJsonFrame({
      protocolVersion: 1, messageKind: 'response', responseKind: 'ok',
      requestKind: 'status', requestId: statusRequest().requestId,
      result: { viewing: 'unknown', assistive: 'unknown', supported: true },
    })))
    await initial
    crashed.exit(1)

    const recoveryMessages: Record<string, unknown>[] = []
    const decoder = new LengthPrefixedFrameDecoder()
    fresh.stdin.on('data', (chunk: Buffer) => {
      for (const frame of decoder.push(new Uint8Array(chunk))) {
        const message = JSON.parse(new TextDecoder().decode(frame.subarray(1))) as Record<string, unknown>
        recoveryMessages.push(message)
        if (message.requestKind === 'input.release') {
          fresh.stdout.write(encodeLengthPrefixedFrame(encodeJsonFrame({
            protocolVersion: 1, messageKind: 'response', responseKind: 'ok',
            requestKind: 'input.release', requestId: inputReleaseRequest().requestId,
            result: { released: true },
          })))
        } else if (message.controlKind === 'parent.shutdown') fresh.exit()
      }
    })
    const first = helper.recoverInput(inputReleaseRequest())
    const second = helper.recoverInput(inputReleaseRequest())
    await Promise.all([first, second])

    expect(spawn).toHaveBeenCalledTimes(2)
    expect(readBinary).toHaveBeenCalledTimes(3)
    expect(recoveryMessages.map(message => message.requestKind ?? message.controlKind)).toEqual([
      'input.release', 'parent.shutdown',
    ])
  })

  it('retains fail-closed recovery when the binary changed or the held-input set is empty', async () => {
    const child = new FakeChild()
    const fresh = new FakeChild()
    let bytes = new Uint8Array([1])
    const spawn = vi.fn<SpawnNativeHelper>()
      .mockReturnValueOnce(asChild(child))
      .mockReturnValueOnce(asChild(fresh))
    const helper = new NativeHelperProcess({
      binaryPath: '/verified/computer-use-helper',
      spawn,
      lstatBinary: () => ({ isFile: () => true, isSymbolicLink: () => false }),
      readBinary: () => bytes,
    })
    const initial = helper.request(statusRequest())
    child.spawned()
    child.stdout.write(encodeLengthPrefixedFrame(encodeJsonFrame({
      protocolVersion: 1, messageKind: 'response', responseKind: 'ok',
      requestKind: 'status', requestId: statusRequest().requestId,
      result: { viewing: 'unknown', assistive: 'unknown', supported: true },
    })))
    await initial
    child.exit(1)
    bytes = new Uint8Array([2])

    await expect(helper.recoverInput(inputReleaseRequest())).rejects.toMatchObject({
      code: 'BINARY_MISMATCH',
      message: 'Native Computer Use helper binary did not match.',
    })
    await expect(helper.recoverInput({
      ...inputReleaseRequest(),
      requestId: RequestId('50000000-0000-4000-8000-000000000002'),
      keys: [],
      buttons: [],
    })).rejects.toMatchObject({ code: 'BINARY_MISMATCH' })
    expect(spawn).toHaveBeenCalledOnce()

    bytes = new Uint8Array([1])
    const retry = { ...inputReleaseRequest(), requestId: RequestId('50000000-0000-4000-8000-000000000003') }
    const decoder = new LengthPrefixedFrameDecoder()
    fresh.stdin.on('data', (chunk: Buffer) => {
      for (const frame of decoder.push(new Uint8Array(chunk))) {
        const message = JSON.parse(new TextDecoder().decode(frame.subarray(1))) as Record<string, unknown>
        if (message.requestKind === 'input.release') {
          fresh.stdout.write(encodeLengthPrefixedFrame(encodeJsonFrame({
            protocolVersion: 1, messageKind: 'response', responseKind: 'ok',
            requestKind: 'input.release', requestId: retry.requestId,
            result: { released: true },
          })))
        } else if (message.controlKind === 'parent.shutdown') fresh.exit()
      }
    })
    await expect(helper.recoverInput(retry)).resolves.toMatchObject({
      message: { responseKind: 'ok', requestKind: 'input.release' },
    })
    expect(spawn).toHaveBeenCalledTimes(2)
  })
})
