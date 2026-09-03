import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  InputTriggerLauncherCandidate, InputTriggerLauncherSource,
} from '../contract/input.ts'

/** Localized labels owned by the composer's fixed Add actions. */
export interface ComposerAddCopy {
  readonly files: string
  readonly filesDescription: string
  readonly image: string
  readonly imageDescription: string
  readonly section: string
}

/** Localized section labels projected over existing launcher candidates. */
export interface ComposerAddLaunchCopy {
  readonly addSection: string
  readonly commandsSection: string
  readonly pluginsSection: string
}

interface ComposerAddCandidateRequest {
  readonly query: string
  readonly quoted?: boolean
  readonly position: 'leading' | 'inline'
  readonly signal: AbortSignal
}

interface ComposerAddPick {
  readonly candidate: InputTriggerLauncherCandidate
  readonly session: { readonly sessionId: SessionId }
  readonly position: 'leading' | 'inline'
  readonly via: 'menu' | 'space' | 'enter'
  readonly action?: 'pick' | 'drill'
  readonly span: { readonly start: number; readonly end: number; readonly draftRev: number }
}

const imagePickers = new Map<SessionId, () => void>()

/**
 * Bind the native image chooser currently mounted for one session.
 * @param sessionId - Session whose composer owns the chooser.
 * @param open - Callback that opens the existing image file input.
 * @returns An idempotent disposer for this exact binding.
 */
export function bindComposerImagePicker(sessionId: SessionId, open: () => void): () => void {
  imagePickers.set(sessionId, open)
  return () => {
    if (imagePickers.get(sessionId) === open) imagePickers.delete(sessionId)
  }
}

/**
 * Fixed actions owned by the composer but rendered by the shared Add launcher.
 * @param copy - Localized row and section copy.
 * @returns A launcher-only input-trigger source for the fixed actions.
 */
export function createComposerAddSource(copy: ComposerAddCopy) {
  return {
    trigger: '/',
    name: 'composer-add',
    launcherOnly: true,
    showGroupTitle: false,
    candidates: (
      { sessionId }: { readonly sessionId: SessionId },
      _request?: ComposerAddCandidateRequest,
    ) => Promise.resolve([
      {
        name: copy.files,
        value: 'files',
        description: copy.filesDescription,
        section: copy.section,
      },
      ...imagePickers.has(sessionId)
        ? [{
          name: copy.image,
          value: 'image',
          description: copy.imageDescription,
          section: copy.section,
        }]
        : [],
    ]),
    onPick: ({ candidate, session }: ComposerAddPick) => {
      if (candidate.value === 'files') return { text: '@', continue: true }
      if (candidate.value === 'image') {
        imagePickers.get(session.sessionId)?.()
        return 'handled'
      }
      return undefined
    },
  }
}

/**
 * Launcher composition whose promotion and sectioning remain presentation-only.
 * @param copy - Localized names for the projected sections.
 * @returns Existing sources in the fixed Add, Commands, Plugins order.
 */
export function composerAddLauncherSources(copy: ComposerAddLaunchCopy): readonly InputTriggerLauncherSource[] {
  const featured = ['goal', 'plan'] as const
  const featuredName = (name: string): name is typeof featured[number] =>
    featured.includes(name as typeof featured[number])
  return [
    { name: 'composer-add' },
    {
      name: 'command',
      project: (items: readonly InputTriggerLauncherCandidate[]) => {
        const promoted = featured.flatMap(name => items.filter(item => item.name === name))
        const remaining = items.filter(item => !featuredName(item.name))
        return [...promoted, ...remaining].map(item => ({
          ...item,
          section: featuredName(item.name) ? copy.addSection : copy.commandsSection,
        }))
      },
    },
    {
      name: 'skill',
      project: items => items.map(item => ({ ...item, section: copy.pluginsSection })),
    },
  ]
}
