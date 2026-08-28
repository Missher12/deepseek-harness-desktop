/** Strict-root adapter for Computer Use tool inputs. */

import {
  ToolArgsError,
  validateJsonSchemaValue,
  type JsonSchemaNode,
  type ToolDefinition,
} from '@deepseek-ai/dsh-tools'

/** Close a model parameter root and validate it before privileged dispatch. */
export function closeToolParameters(definition: ToolDefinition): ToolDefinition {
  const parameters = { ...definition.parameters, additionalProperties: false } as JsonSchemaNode
  const validate = (args: unknown) => validateJsonSchemaValue(parameters, args, '')
  const execute = definition.execute.bind(definition)
  const presentCall = definition.presentCall?.bind(definition)
  const presentResult = definition.presentResult?.bind(definition)
  const isConcurrencySafe = definition.isConcurrencySafe?.bind(definition)
  return {
    ...definition,
    parameters: parameters as unknown as Record<string, unknown>,
    async execute(args, exec) {
      const violations = validate(args)
      if (violations.length > 0) throw new ToolArgsError(violations)
      return execute(args, exec)
    },
    ...presentCall === undefined ? {} : {
      presentCall(args: unknown) {
        return validate(args).length === 0 ? presentCall(args) : undefined
      },
    },
    ...presentResult === undefined ? {} : {
      presentResult(args: unknown, result) {
        return validate(args).length === 0 ? presentResult(args, result) : undefined
      },
    },
    ...isConcurrencySafe === undefined ? {} : {
      isConcurrencySafe(args: unknown) {
        return validate(args).length === 0 && isConcurrencySafe(args)
      },
    },
  }
}
