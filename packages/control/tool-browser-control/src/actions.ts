/** Closed model-facing action roster for the semantic BrowserControl service. */

import { BrowserRef, type KeyModifier } from '@deepseek-ai/dsh-browser-control'
import { PROTOCOL_LIMITS } from '@deepseek-ai/dsh-desktop-control-protocol'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { closeToolParameters } from './closed-tool.ts'
import type { BrowserToolController } from './controller.ts'
import { browserCall } from './presentation.ts'

const NAVIGATION_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    url: { type: 'string', required: true },
    snapshotRevision: { type: 'integer', required: true },
  },
} as const

const ACTION_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    acted: { type: 'boolean', const: true, required: true },
    snapshotRevision: { type: 'integer', required: true },
  },
} as const

const WAIT_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    waited: { type: 'boolean', const: true, required: true },
    snapshotRevision: { type: 'integer', required: true },
  },
} as const

const STOP_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: { stopped: { type: 'boolean', const: true, required: true } },
} as const

const renderJson = (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }]

function assertWait(mode: 'duration' | 'navigation' | 'loading-idle', durationMs: number | undefined): void {
  if (mode === 'duration') {
    if (durationMs === undefined) throw new Error('browser_wait duration mode requires duration_ms.')
    if (!Number.isSafeInteger(durationMs)
      || durationMs < PROTOCOL_LIMITS.minWaitDurationMs
      || durationMs > PROTOCOL_LIMITS.maxWaitDurationMs) {
      throw new Error('browser_wait duration_ms must be a safe integer from 0 through 10,000 milliseconds.')
    }
  } else if (durationMs !== undefined) {
    throw new Error(`browser_wait ${mode} mode does not accept duration_ms.`)
  }
}

function modifiers(value: KeyModifier[] | undefined): readonly KeyModifier[] {
  if (value === undefined) return []
  if (value.length > 4 || new Set(value).size !== value.length) {
    throw new Error('browser_key modifiers must contain at most one of each declared modifier.')
  }
  return value
}

function assertScrollDelta(name: 'delta_x' | 'delta_y', value: number): void {
  if (!Number.isSafeInteger(value) || Object.is(value, -0)
    || value < -PROTOCOL_LIMITS.maxCoordinate || value > PROTOCOL_LIMITS.maxCoordinate) {
    throw new Error(`browser_scroll ${name} must be a safe integer within the provider's bounded delta range.`)
  }
}

/**
 * Build all approval-free model schemas; persistent-surface authorization remains provider-owned.
 * @param controller turn-local Browser Control authority adapter.
 * @returns the closed non-snapshot Browser Control tool roster.
 */
export function browserActionTools(controller: BrowserToolController): ToolDefinition[] {
  return [
    closeToolParameters(defineTool({
      name: 'browser_navigate',
      description: 'Navigate the controlled browser to a URL. Electron validates the initial URL and every redirect; page JavaScript and navigation can still have ordinary external effects.',
      parameters: { url: { type: 'string', required: true, description: 'Absolute destination URL.' } },
      output: { schema: NAVIGATION_SCHEMA, render: renderJson },
      presentCall: args => browserCall('Navigate browser', args.url),
      async execute(args, exec) {
        const result = await controller.act({ requestKind: 'browser.navigate', url: args.url }, exec)
        if (!('url' in result)) throw new Error('BrowserControl returned the wrong navigation result.')
        return result
      },
    })),
    closeToolParameters(defineTool({
      name: 'browser_click',
      description: 'Activate one current semantic browser ref. Password, OTP, payment, file, upload, and other protected targets are denied by the BrowserControl provider; ordinary page actions may still trigger page JavaScript or external effects.',
      parameters: { ref: { type: 'string', required: true, description: 'Opaque ref from the latest browser_snapshot.' } },
      output: { schema: ACTION_SCHEMA, render: renderJson },
      presentCall: () => browserCall('Click browser element'),
      async execute(args, exec) {
        const result = await controller.act({ requestKind: 'browser.click', ref: BrowserRef(args.ref) }, exec)
        if (!('acted' in result)) throw new Error('BrowserControl returned the wrong action result.')
        return result
      },
    })),
    closeToolParameters(defineTool({
      name: 'browser_type',
      description: 'Enter text into one current semantic browser ref. Protected password, OTP, payment, file, and upload targets are denied by the BrowserControl provider. Text is intentionally omitted from UI presentation.',
      parameters: {
        ref: { type: 'string', required: true, description: 'Opaque ref from the latest browser_snapshot.' },
        text: { type: 'string', required: true, description: 'Text to enter into the ordinary non-sensitive target.' },
      },
      output: { schema: ACTION_SCHEMA, render: renderJson },
      presentCall: () => browserCall('Type in browser'),
      async execute(args, exec) {
        const result = await controller.act({ requestKind: 'browser.type', ref: BrowserRef(args.ref), text: args.text }, exec)
        if (!('acted' in result)) throw new Error('BrowserControl returned the wrong action result.')
        return result
      },
    })),
    closeToolParameters(defineTool({
      name: 'browser_key',
      description: 'Send one closed key chord to the controlled browser. The protocol accepts only a key plus the Alt/Control/Meta/Shift modifier vocabulary; no selector, coordinate, file, or authority input exists.',
      parameters: {
        key: { type: 'string', required: true, description: 'Provider-validated key name.' },
        modifiers: {
          type: 'array',
          items: { type: 'string', enum: ['Alt', 'Control', 'Meta', 'Shift'] },
          description: 'Optional unique modifier keys.',
        },
      },
      output: { schema: ACTION_SCHEMA, render: renderJson },
      presentCall: args => browserCall('Press browser key', args.key),
      async execute(args, exec) {
        const result = await controller.act({ requestKind: 'browser.key', key: args.key, modifiers: modifiers(args.modifiers) }, exec)
        if (!('acted' in result)) throw new Error('BrowserControl returned the wrong action result.')
        return result
      },
    })),
    closeToolParameters(defineTool({
      name: 'browser_select',
      description: 'Choose one value on a current semantic browser ref. File and upload controls remain provider-denied.',
      parameters: {
        ref: { type: 'string', required: true, description: 'Opaque ref from the latest browser_snapshot.' },
        value: { type: 'string', required: true, description: 'Provider-validated option value.' },
      },
      output: { schema: ACTION_SCHEMA, render: renderJson },
      presentCall: () => browserCall('Select browser option'),
      async execute(args, exec) {
        const result = await controller.act({ requestKind: 'browser.select', ref: BrowserRef(args.ref), value: args.value }, exec)
        if (!('acted' in result)) throw new Error('BrowserControl returned the wrong action result.')
        return result
      },
    })),
    closeToolParameters(defineTool({
      name: 'browser_scroll',
      description: 'Scroll the controlled page or one current semantic ref by bounded integer deltas. This tool never accepts screen coordinates.',
      parameters: {
        ref: { type: 'string', description: 'Optional opaque ref from the latest browser_snapshot.' },
        delta_x: { type: 'integer', required: true, description: 'Horizontal scroll delta.' },
        delta_y: { type: 'integer', required: true, description: 'Vertical scroll delta.' },
      },
      output: { schema: ACTION_SCHEMA, render: renderJson },
      presentCall: () => browserCall('Scroll browser'),
      async execute(args, exec) {
        assertScrollDelta('delta_x', args.delta_x)
        assertScrollDelta('delta_y', args.delta_y)
        const result = await controller.act({
          requestKind: 'browser.scroll',
          ...(args.ref === undefined ? {} : { ref: BrowserRef(args.ref) }),
          deltaX: args.delta_x,
          deltaY: args.delta_y,
        }, exec)
        if (!('acted' in result)) throw new Error('BrowserControl returned the wrong action result.')
        return result
      },
    })),
    closeToolParameters(defineTool({
      name: 'browser_wait',
      description: 'Wait only for a duration, navigation, or loading-idle condition. Duration waits are capped at 10,000 milliseconds.',
      parameters: {
        mode: { type: 'string', enum: ['duration', 'navigation', 'loading-idle'], required: true },
        duration_ms: { type: 'integer', description: 'Required only for duration mode; 0 through 10,000.' },
      },
      output: { schema: WAIT_SCHEMA, render: renderJson },
      presentCall: args => browserCall('Wait for browser', args.mode),
      async execute(args, exec) {
        assertWait(args.mode, args.duration_ms)
        const body = args.mode === 'duration'
          ? { requestKind: 'browser.wait' as const, mode: args.mode, durationMs: args.duration_ms as number }
          : { requestKind: 'browser.wait' as const, mode: args.mode }
        const result = await controller.act(body, exec)
        if (!('waited' in result)) throw new Error('BrowserControl returned the wrong wait result.')
        return result
      },
    })),
    ...(['browser_back', 'browser_forward', 'browser_reload'] as const).map(name => closeToolParameters(defineTool({
      name,
      description: `${name === 'browser_back' ? 'Move backward' : name === 'browser_forward' ? 'Move forward' : 'Reload'} in the controlled browser. Ordinary page navigation and JavaScript may have external effects.`,
      parameters: {},
      output: { schema: NAVIGATION_SCHEMA, render: renderJson },
      presentCall: () => browserCall(name === 'browser_back' ? 'Go back in browser' : name === 'browser_forward' ? 'Go forward in browser' : 'Reload browser'),
      async execute(_args, exec) {
        const requestKind = name.replace('_', '.') as 'browser.back' | 'browser.forward' | 'browser.reload'
        const result = await controller.act({ requestKind }, exec)
        if (!('url' in result)) throw new Error('BrowserControl returned the wrong navigation result.')
        return result
      },
    }))),
    closeToolParameters(defineTool({
      name: 'browser_stop',
      description: 'Stop browser takeover for the current official session and await provider cleanup. This action never requires approval and accepts no arguments.',
      parameters: {},
      output: { schema: STOP_SCHEMA, render: renderJson },
      presentCall: () => browserCall('Stop browser control'),
      execute: (_args, exec) => controller.stop(exec),
    })),
  ]
}
