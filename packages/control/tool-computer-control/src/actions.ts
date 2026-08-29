/** Closed model-facing roster for native ComputerControl. */

import type { Context } from '@deepseek-ai/cordis'
import { ComputerRef, type KeyModifier } from '@deepseek-ai/dsh-computer-control'
import {
  CONTROL_KEY_VALUES,
  PROTOCOL_LIMITS,
  type ControlKey,
} from '@deepseek-ai/dsh-desktop-control-protocol'
import { defineTool, type ToolDefinition, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import { closeToolParameters } from './closed-tool.ts'
import type { ComputerToolController } from './controller.ts'
import { computerCall } from './presentation.ts'
import { routeCanSeeImages } from './vision.ts'

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
const STATUS_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    viewing: { type: 'string', enum: ['granted', 'denied', 'unknown'], required: true },
    assistive: { type: 'string', enum: ['granted', 'denied', 'unknown'], required: true },
    supported: { type: 'boolean', required: true },
  },
} as const
const LIST_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    apps: {
      type: 'array', required: true,
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          appId: { type: 'string', required: true },
          name: { type: 'string', required: true },
          windows: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                windowId: { type: 'string', required: true },
                title: { type: 'string', required: true },
              },
            },
          },
        },
      },
    },
  },
} as const

const targetParameters = {
  app_id: { type: 'string', required: true, description: 'Application id from computer_list.' },
  window_id: { type: 'string', required: true, description: 'Window id paired with that application in computer_list.' },
} as const
const buttonParameter = {
  type: 'string', enum: ['left', 'middle', 'right'], description: 'Pointer button; defaults to left.',
} as const
const CONTROL_KEY_SET: ReadonlySet<string> = new Set(CONTROL_KEY_VALUES)
const MODEL_KEY_VALUES = Object.freeze([
  ...CONTROL_KEY_VALUES,
  ...CONTROL_KEY_VALUES.filter(value => /^[A-Z]$/.test(value)).map(value => value.toLowerCase()),
])
const renderJson = (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }]

function assertCoordinate(name: string, value: number): void {
  if (!Number.isFinite(value) || Object.is(value, -0)
    || value < PROTOCOL_LIMITS.minCoordinate || value > PROTOCOL_LIMITS.maxCoordinate) {
    throw new Error(`${name} is outside the bounded coordinate range.`)
  }
}

function assertDelta(name: string, value: number): void {
  if (!Number.isFinite(value) || Object.is(value, -0)
    || value < -PROTOCOL_LIMITS.maxCoordinate || value > PROTOCOL_LIMITS.maxCoordinate) {
    throw new Error(`${name} is outside the bounded delta range.`)
  }
}

function modifiers(value: KeyModifier[] | undefined): readonly KeyModifier[] {
  if (value === undefined) return []
  if (value.length > PROTOCOL_LIMITS.maxModifiers || new Set(value).size !== value.length) {
    throw new Error('computer_key modifiers must contain at most one of each declared modifier.')
  }
  return value
}

function controlKey(value: string): ControlKey {
  const canonical = /^[a-z]$/.test(value) ? value.toUpperCase() : value
  if (!CONTROL_KEY_SET.has(canonical)) {
    throw new Error('computer_key key is outside the closed keyboard vocabulary.')
  }
  return canonical as ControlKey
}

async function requireVision(ctx: Context, exec: ToolRunContext): Promise<void> {
  if (!await routeCanSeeImages(ctx, exec)) {
    throw new Error('Coordinate computer actions require the exact active route to support screenshot attachments.')
  }
}

function pointerTarget(args: { ref?: string; x?: number; y?: number }):
  | { ref: ReturnType<typeof ComputerRef> }
  | { x: number; y: number } {
  if (args.ref !== undefined) {
    if (args.x !== undefined || args.y !== undefined) throw new Error('A computer pointer target accepts either ref or x/y, never both.')
    return { ref: ComputerRef(args.ref) }
  }
  if (args.x === undefined || args.y === undefined) throw new Error('A computer pointer target requires a ref or both x and y.')
  assertCoordinate('x', args.x)
  assertCoordinate('y', args.y)
  return { x: args.x, y: args.y }
}

/**
 * Build status, list, actions, wait, and approval-free Stop.
 * @param ctx active Cordis context used for exact-route capability checks.
 * @param controller turn-local Computer Control authority adapter.
 * @returns the closed non-snapshot Computer Control tool roster.
 */
export function computerActionTools(ctx: Context, controller: ComputerToolController): ToolDefinition[] {
  const simple = (
    name: 'computer_focus',
    title: string,
    requestKind: 'computer.focus',
  ) => closeToolParameters(defineTool({
    name,
    description: 'Focus one app/window pair returned by computer_list. The provider revalidates process and window identity before acting.',
    parameters: targetParameters,
    output: { schema: ACTION_SCHEMA, render: renderJson },
    presentCall: () => computerCall(title),
    async execute(args, exec) {
      const result = await controller.act({ requestKind, appId: args.app_id, windowId: args.window_id }, exec)
      if (!('acted' in result)) throw new Error('ComputerControl returned the wrong action result.')
      return result
    },
  }))

  const click = (name: 'computer_click' | 'computer_double_click', requestKind: 'computer.click' | 'computer.double-click') =>
    closeToolParameters(defineTool({
      name,
      description: 'Activate a current accessibility ref, or bounded screenshot coordinates only for a vision-capable route. Protected targets remain provider-denied.',
      parameters: {
        ...targetParameters,
        ref: { type: 'string', description: 'Opaque ref from the latest computer_snapshot.' },
        x: { type: 'number', description: 'Window-relative x coordinate; vision routes only.' },
        y: { type: 'number', description: 'Window-relative y coordinate; vision routes only.' },
        button: buttonParameter,
      },
      output: { schema: ACTION_SCHEMA, render: renderJson },
      presentCall: () => computerCall(name === 'computer_click' ? 'Click computer target' : 'Double-click computer target'),
      async execute(args, exec) {
        const pointer = pointerTarget(args)
        if ('x' in pointer) await requireVision(ctx, exec)
        const result = await controller.act({
          requestKind, appId: args.app_id, windowId: args.window_id,
          ...pointer, button: args.button ?? 'left',
        }, exec)
        if (!('acted' in result)) throw new Error('ComputerControl returned the wrong action result.')
        return result
      },
    }))

  return [
    closeToolParameters(defineTool({
      name: 'computer_status',
      description: 'Read local Computer Use support plus Screen Viewing and Assistive Control permission states. This does not request permission or acquire control.',
      parameters: {}, output: { schema: STATUS_SCHEMA, render: renderJson },
      presentCall: () => computerCall('Check computer control'),
      execute: (_args, exec) => controller.status(exec),
    })),
    closeToolParameters(defineTool({
      name: 'computer_list',
      description: 'List only applications and windows currently eligible for an explicit user grant. It does not acquire control.',
      parameters: {}, output: { schema: LIST_SCHEMA, render: renderJson },
      presentCall: () => computerCall('List controllable applications'),
      async execute(_args, exec) {
        const result = await controller.list(exec)
        return { apps: result.apps.map(app => ({
          appId: app.appId,
          name: app.name,
          windows: app.windows.map(window => ({ windowId: window.windowId, title: window.title })),
        })) }
      },
    })),
    simple('computer_focus', 'Focus computer window', 'computer.focus'),
    click('computer_click', 'computer.click'),
    click('computer_double_click', 'computer.double-click'),
    closeToolParameters(defineTool({
      name: 'computer_drag',
      description: 'Drag between bounded window-relative coordinates only when the exact active route supports screenshot attachments.',
      parameters: {
        ...targetParameters,
        from_x: { type: 'number', required: true }, from_y: { type: 'number', required: true },
        to_x: { type: 'number', required: true }, to_y: { type: 'number', required: true },
        button: buttonParameter,
      },
      output: { schema: ACTION_SCHEMA, render: renderJson },
      presentCall: () => computerCall('Drag computer target'),
      async execute(args, exec) {
        for (const [name, value] of [['from_x', args.from_x], ['from_y', args.from_y], ['to_x', args.to_x], ['to_y', args.to_y]] as const) {
          assertCoordinate(name, value)
        }
        await requireVision(ctx, exec)
        const result = await controller.act({
          requestKind: 'computer.drag', appId: args.app_id, windowId: args.window_id,
          fromX: args.from_x, fromY: args.from_y, toX: args.to_x, toY: args.to_y,
          button: args.button ?? 'left',
        }, exec)
        if (!('acted' in result)) throw new Error('ComputerControl returned the wrong action result.')
        return result
      },
    })),
    closeToolParameters(defineTool({
      name: 'computer_type',
      description: 'Enter text into one current ordinary accessibility ref. Typed text is omitted from UI presentation and protected fields are provider-denied.',
      parameters: {
        ...targetParameters,
        ref: { type: 'string', required: true, description: 'Opaque ref from the latest computer_snapshot.' },
        text: { type: 'string', required: true },
      },
      output: { schema: ACTION_SCHEMA, render: renderJson },
      presentCall: () => computerCall('Type in computer application'),
      async execute(args, exec) {
        const result = await controller.act({
          requestKind: 'computer.type', appId: args.app_id, windowId: args.window_id,
          ref: ComputerRef(args.ref), text: args.text,
        }, exec)
        if (!('acted' in result)) throw new Error('ComputerControl returned the wrong action result.')
        return result
      },
    })),
    closeToolParameters(defineTool({
      name: 'computer_key',
      description: 'Send one provider-validated key chord to an authorized app/window. Only the Alt/Control/Meta/Shift modifier vocabulary is accepted.',
      parameters: {
        ...targetParameters,
        key: { type: 'string', enum: MODEL_KEY_VALUES, required: true },
        modifiers: { type: 'array', items: { type: 'string', enum: ['Alt', 'Control', 'Meta', 'Shift'] } },
      },
      output: { schema: ACTION_SCHEMA, render: renderJson },
      presentCall: args => computerCall('Press computer key', args.key),
      async execute(args, exec) {
        const result = await controller.act({
          requestKind: 'computer.key', appId: args.app_id, windowId: args.window_id,
          key: controlKey(args.key), modifiers: modifiers(args.modifiers),
        }, exec)
        if (!('acted' in result)) throw new Error('ComputerControl returned the wrong action result.')
        return result
      },
    })),
    closeToolParameters(defineTool({
      name: 'computer_scroll',
      description: 'Scroll a current accessibility ref, or bounded screenshot coordinates only for a vision-capable route.',
      parameters: {
        ...targetParameters,
        ref: { type: 'string', description: 'Opaque ref from the latest computer_snapshot.' },
        x: { type: 'number', description: 'Window-relative x coordinate; vision routes only.' },
        y: { type: 'number', description: 'Window-relative y coordinate; vision routes only.' },
        delta_x: { type: 'number', required: true }, delta_y: { type: 'number', required: true },
      },
      output: { schema: ACTION_SCHEMA, render: renderJson },
      presentCall: () => computerCall('Scroll computer window'),
      async execute(args, exec) {
        assertDelta('delta_x', args.delta_x)
        assertDelta('delta_y', args.delta_y)
        const pointer = pointerTarget(args)
        if ('x' in pointer) await requireVision(ctx, exec)
        const result = await controller.act({
          requestKind: 'computer.scroll', appId: args.app_id, windowId: args.window_id,
          ...pointer, deltaX: args.delta_x, deltaY: args.delta_y,
        }, exec)
        if (!('acted' in result)) throw new Error('ComputerControl returned the wrong action result.')
        return result
      },
    })),
    closeToolParameters(defineTool({
      name: 'computer_wait',
      description: 'Wait for a bounded duration on one authorized app/window. Duration is capped at 10,000 milliseconds.',
      parameters: { ...targetParameters, duration_ms: { type: 'integer', required: true } },
      output: { schema: WAIT_SCHEMA, render: renderJson },
      presentCall: args => computerCall('Wait for computer window', args.duration_ms),
      async execute(args, exec) {
        if (!Number.isSafeInteger(args.duration_ms) || args.duration_ms < PROTOCOL_LIMITS.minWaitDurationMs
          || args.duration_ms > PROTOCOL_LIMITS.maxWaitDurationMs) {
          throw new Error('computer_wait duration_ms must be a safe integer from 0 through 10,000 milliseconds.')
        }
        const result = await controller.act({
          requestKind: 'computer.wait', appId: args.app_id, windowId: args.window_id,
          durationMs: args.duration_ms,
        }, exec)
        if (!('waited' in result)) throw new Error('ComputerControl returned the wrong wait result.')
        return result
      },
    })),
    closeToolParameters(defineTool({
      name: 'computer_stop',
      description: 'Stop native Computer Use for the current official session and await cleanup. This action accepts no arguments and never requires approval.',
      parameters: {}, output: { schema: STOP_SCHEMA, render: renderJson },
      presentCall: () => computerCall('Stop computer control'),
      execute: (_args, exec) => controller.stop(exec),
    })),
  ]
}
