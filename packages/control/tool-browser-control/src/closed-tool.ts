/** Strict-root adapter for first-party tools whose model input is a security boundary. */

import {
  ToolArgsError,
  validateJsonSchemaValue,
  type JsonSchemaNode,
  type ToolDefinition,
} from '@deepseek-ai/dsh-tools'

/**
 * Close the implicit open parameter root produced by `defineTool`.
 *
 * The shared authoring helper intentionally leaves parameter roots open for
 * compatibility. Browser control cannot: an ignored `approved`, coordinate,
 * file, or grant-looking field would create a misleading authority channel.
 * This wrapper rejects every undeclared root field before the tool body runs
 * and applies the same schema softly to replay-only presenters.
 *
 * @param definition - A fully typed first-party tool definition.
 * @returns The same tool with a closed parameter root and hard execution gate.
 */
export function closeToolParameters(definition: ToolDefinition): ToolDefinition {
  const parameters = {
    ...definition.parameters,
    additionalProperties: false,
  } as JsonSchemaNode
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
        if (validate(args).length > 0) return undefined
        return presentCall(args)
      },
    },
    ...presentResult === undefined ? {} : {
      presentResult(args: unknown, result) {
        if (validate(args).length > 0) return undefined
        return presentResult(args, result)
      },
    },
    ...isConcurrencySafe === undefined ? {} : {
      isConcurrencySafe(args: unknown) {
        if (validate(args).length > 0) return false
        return isConcurrencySafe(args)
      },
    },
  }
}
