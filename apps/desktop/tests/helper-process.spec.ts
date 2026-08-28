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
}

function asChild(child: FakeChild): ChildProcessWithoutNullStreams {
  return child as unknown as ChildProcessWithoutNullStreams
}

function statusRequest(): HelperRequest {
  return {
    protocolVersion: 1,
    messageKind: 'request',
    requestKind: 'status',
    requestId: RequestId('00000000-0000-4000-8000-000000000001'),
    sessionId: SessionId('session-1'),
    timeoutMs: 1_000,
  }
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

    await expect(pending).rejects.toEqual(expect.objectContaining({
      code: 'DISCONNECTED',
      message: 'Native Computer Use helper disconnected.',
    }))
    expect(helper.running).toBe(true)
    await expect(helper.request(statusRequest())).rejects.toEqual(expect.objectContaining({
      code: 'DISCONNECTED',
    }))
    child.exit()
    expect(helper.running).toBe(false)
  })

  it('ends stdin on shutdown and waits for the exact owned child', async () => {
    const child = new FakeChild()
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
})
