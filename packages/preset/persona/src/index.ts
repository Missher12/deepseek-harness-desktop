/**
 * A per-agent persona as a composable row.
 *
 * `dsh-system-prompt` owns the global persona as its own config, and registers
 * that section unconditionally — so this row is **scope-only**. Mounted inside
 * an agent preset it shadows the deployment persona for that one session,
 * exactly like the per-child persona `dsh-subagent` installs; mounted globally
 * it collides with the registry's own registration and fails loud.
 *
 * That constraint is the reason the row exists. An agent preset cannot mount
 * the prompt registry itself, so without a row of its own a preset could
 * change an agent's tools but never its identity.
 * @module @deepseek-ai/dsh-persona
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { PERSONA_PREFIX_SECTION, PERSONA_SUFFIX_SECTION } from '@deepseek-ai/dsh-system-prompt'

export { PERSONA_PREFIX_SECTION, PERSONA_SUFFIX_SECTION }

/** Cordis plugin name. */
export const name = 'persona'

/** The prompt registry this row contributes to. */
export const inject = ['systemPrompt']

/** Plugin config: the persona text this composition contributes. */
export interface Config {
  /**
   * Persona prose rendered as the `deployment:persona-prefix` section. A template:
   * complete `{{…}}` groups interpolate strictly against registered prompt
   * variables. Empty text drops the section at render, matching the registry.
   */
  prefix: string
  /**
   * Persona suffix template rendered after first-party guidance. Omitted or empty
   * text shadows the deployment suffix away; interpolation is strict.
   */
  suffix?: string
  /** Make the prefix the complete system prompt, suppressing the suffix and every other section. */
  complete?: boolean
  /** Suppress dynamic runtime-context snapshots for this persona's agent scope. */
  includeRuntimeContext?: boolean
}

/**
 * What a stored composition may spell: {@link Config}, or the same row written
 * before the persona text was called `text` rather than `prefix`.
 *
 * The old spelling stays accepted rather than rejected because the cost is
 * wildly asymmetric. A composition is a file on disk that no type checker
 * reads, one stale row fails the whole preset mount, and a preset the default
 * seat names fails EVERY new Session — so a rename would silently break
 * existing installations. `prefix` wins when a row carries both.
 */
interface PersonaConfigInput {
  /** Persona prose; the current name. */
  prefix?: string
  /** The former name of {@link PersonaConfigInput.prefix}. */
  text?: string
  suffix?: string
  complete?: boolean
  includeRuntimeContext?: boolean
}

/**
 * Raw shape before the legacy name is resolved: both spellings are declared
 * optional here, and the transform below is what makes exactly one of them
 * required — a rule no single object field can state.
 */
const PersonaConfigShape = z.object({
  prefix: z.string(),
  text: z.string(),
  suffix: z.string().default(''),
  complete: z.boolean().default(false),
  includeRuntimeContext: z.boolean().default(true),
})

/** Runtime schema for the persona row, with the `text` → `prefix` rename accepted. */
export const Config: z<Config> = z.transform(PersonaConfigShape, (value) => {
  // The declared shape cannot express "one of these two"; the cast restores the
  // optionality the schema metadata (not the field schema) actually enforces.
  const { prefix, text, suffix, complete, includeRuntimeContext } = value as PersonaConfigInput
  const resolved = prefix ?? text
  if (resolved === undefined) {
    // The historical field name is named here because that is the mistake this
    // message most often reports, and `$.prefix` alone does not explain it. The
    // path is stated rather than threaded: a transform callback receives only
    // the value, so there is no caller-supplied path to extend.
    throw new z.ValidationError(
      'missing required value (this field was named `text` before it was renamed to `prefix`)',
      { path: ['prefix'] },
    )
  }
  return {
    prefix: resolved,
    suffix: suffix ?? '',
    complete: complete ?? false,
    includeRuntimeContext: includeRuntimeContext ?? true,
  }
})

/**
 * Register the persona prefix and suffix sections for the mounting context's scope.
 * @param ctx - an agent scope context; an unscoped context collides with the
 * prompt registry's own persona registration and rejects.
 * @param config - the prefix, suffix, and complete-prompt policy.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.effect(() => ctx.systemPrompt.section({
    name: PERSONA_PREFIX_SECTION,
    order: ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'),
    text: config.prefix,
    ...(config.complete ? { complete: true } : {}),
  }), 'persona.section()')
  ctx.effect(() => ctx.systemPrompt.section({
    name: PERSONA_SUFFIX_SECTION,
    order: ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_SUFFIX'),
    text: config.suffix ?? '',
  }), 'persona.suffix()')
  if (!(config.includeRuntimeContext ?? true)) ctx.systemPrompt.suppressRuntimeContext()
}
