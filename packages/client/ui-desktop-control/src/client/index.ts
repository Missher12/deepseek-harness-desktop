import type { BoundActions, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { createElement } from 'react'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { DesktopControlCapsule, DesktopControlSettings } from './components.tsx'
import {
  isDesktopControlBridge,
  isDesktopControlUiSnapshot,
  type DesktopControlUiMutation,
} from './contracts.ts'
import { createDesktopControlStore } from './store.ts'
import { en, zh, type DesktopControlLabels, type DesktopControlLocaleKey } from './locales.ts'

type StoreHandle = ReturnType<typeof createDesktopControlStore>
type Bound = BoundActions<StoreHandle>
type CapsuleInjected = { stop(): void }
type SettingsInjected = { mutate(mutation: DesktopControlUiMutation): void }
type CapsuleProps = PropsRuntime<'layout.status'> & PropsStore<StoreHandle> & PropsLocale<'desktop.control'> & CapsuleInjected
type SettingsProps = PropsRuntime<'settings.section'> & PropsStore<StoreHandle> & PropsLocale<'desktop.control'> & SettingsInjected

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'desktop.control': DesktopControlLocaleKey }
}

const NS = 'desktop.control'

function localized(t: CapsuleProps['t']): DesktopControlLabels {
  return Object.fromEntries(Object.keys(en).map(key => [key, t(key as DesktopControlLocaleKey)])) as DesktopControlLabels
}

function CapsuleSeat(props: CapsuleProps) {
  return createElement(DesktopControlCapsule, {
    snapshot: props.useStore(state => state.snapshot), onStop: () => { props.stop() }, labels: localized(props.t),
  })
}

function SettingsSeat(props: SettingsProps) {
  return createElement(DesktopControlSettings, {
    snapshot: props.useStore(state => state.snapshot),
    onMutation: (mutation) => { props.mutate(mutation) },
    labels: localized(props.t),
  })
}

export const inject = ['slots', 'locale']

export function apply(ctx: ClientContext): void {
  const bridge: unknown = (window as unknown as { readonly dshDesktop?: unknown }).dshDesktop
  if (!isDesktopControlBridge(bridge)) return
  ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'ui-desktop-control: dictionaries')
  const bound = new Set<Bound>()
  const sync = (value: unknown): void => {
    if (!isDesktopControlUiSnapshot(value)) return
    for (const actions of bound) actions.sync(value)
  }
  const invoke = (operation: () => Promise<unknown>): void => { void operation().then(sync).catch(() => undefined) }
  const bind = (actions: Bound): (() => void) => {
    bound.add(actions)
    invoke(() => bridge.getComputerControlStatus())
    return () => { bound.delete(actions) }
  }
  const off = bridge.onComputerControlStatus(sync)
  ctx.effect(() => off, 'ui-desktop-control: Desktop status subscription')
  ctx.slots.inject('layout.status', () => ctx.slots.register({
    name: 'layout.status', id: 'desktop-control-status', order: 10, store: createDesktopControlStore, locale: NS,
    inject: (actions: Bound): CapsuleInjected => {
      ctx.effect(() => bind(actions), 'ui-desktop-control: bind status store')
      return { stop: () => { invoke(() => bridge.stopComputerControl()) } }
    },
  }, CapsuleSeat))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'desktop-control', order: 90,
    label: () => ctx.locale.bind(NS)('section'), store: createDesktopControlStore, locale: NS,
    inject: (actions: Bound): SettingsInjected => {
      ctx.effect(() => bind(actions), 'ui-desktop-control: bind settings store')
      return { mutate: (mutation) => { invoke(() => bridge.setComputerControlSetting(mutation)) } }
    },
  }, SettingsSeat))
}
