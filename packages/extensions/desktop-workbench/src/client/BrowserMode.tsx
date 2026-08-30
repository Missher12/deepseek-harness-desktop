import { useEffect, useRef, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { NS } from './locales.ts'
import css from './BrowserMode.module.css'

type Props = PropsLocale<typeof NS>
interface DesktopBrowserBounds { x: number; y: number; width: number; height: number }
type DesktopBrowserRequest = { kind: 'navigate'; value: string } | { kind: 'back' | 'forward' | 'reload' | 'stop' }
interface DesktopBrowserSnapshot {
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  error: string | null
}
interface BrowserTakeoverStatus {
  phase: 'human' | 'given' | 'agent' | 'stopping'
  signedInWarning: true
}
interface DesktopBrowserApi {
  showWorkbenchBrowser(bounds: DesktopBrowserBounds): Promise<DesktopBrowserSnapshot>
  layoutWorkbenchBrowser?(bounds: DesktopBrowserBounds): Promise<void>
  setWorkbenchBrowserDockVisibility?(visible: boolean): Promise<void>
  hideWorkbenchBrowser(): Promise<void>
  controlWorkbenchBrowser(request: DesktopBrowserRequest): Promise<DesktopBrowserSnapshot>
  onWorkbenchBrowserState(listener: (snapshot: DesktopBrowserSnapshot) => void): () => void
  giveWorkbenchBrowserToAgent?(): Promise<BrowserTakeoverStatus>
  stopAgentBrowser?(): Promise<BrowserTakeoverStatus>
  getBrowserTakeoverStatus?(): Promise<BrowserTakeoverStatus>
  onBrowserTakeoverStatus?(listener: (status: BrowserTakeoverStatus) => void): () => void
}

function desktopApi(): DesktopBrowserApi | undefined {
  return (window as unknown as { dshDesktop?: DesktopBrowserApi }).dshDesktop
}

/** Whether no DOM page surface can be punched through by the native Browser view. */
function isNativeBrowserHostExposed(element: HTMLElement, owner: Document = document): boolean {
  if (!element.isConnected || owner.visibilityState === 'hidden'
    || owner.querySelector('[aria-modal="true"]') !== null) return false
  const rect = element.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return false
  if (typeof owner.elementFromPoint !== 'function') return true
  const insetX = Math.min(8, rect.width / 4)
  const insetY = Math.min(8, rect.height / 4)
  const points = [
    [rect.left + rect.width / 2, rect.top + rect.height / 2],
    [rect.left + insetX, rect.top + insetY],
    [rect.right - insetX, rect.top + insetY],
    [rect.left + insetX, rect.bottom - insetY],
    [rect.right - insetX, rect.bottom - insetY],
  ] as const
  return points.every(([x, y]) => {
    const top = owner.elementFromPoint(x, y)
    return top !== null && element.contains(top)
  })
}

export function BrowserMode({ t }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const [address, setAddress] = useState('')
  const [snapshot, setSnapshot] = useState<DesktopBrowserSnapshot>({
    url: '', title: '', loading: false, canGoBack: false, canGoForward: false, error: null,
  })
  const [error, setError] = useState<string>()
  const [takeover, setTakeover] = useState<BrowserTakeoverStatus>({ phase: 'human', signedInWarning: true })
  const takeoverPhase = useRef(takeover.phase)
  takeoverPhase.current = takeover.phase
  const invoke = async (request: DesktopBrowserRequest) => {
    const api = desktopApi()
    if (api === undefined) { setError(t('browserDesktopOnly')); return }
    try {
      const next = await api.controlWorkbenchBrowser(request)
      setSnapshot(next)
      if (next.url !== '') setAddress(next.url)
    } catch (reason: unknown) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }
  useEffect(() => {
    const api = desktopApi()
    const element = host.current
    if (api === undefined || element === null) { setError(t('browserDesktopOnly')); return }
    let frame = 0
    const lifecycle = { mounted: true }
    const isMounted = (): boolean => lifecycle.mounted
    let syncing = false
    let pending: DesktopBrowserBounds | undefined
    let previous: DesktopBrowserBounds | undefined
    let reportedVisibility: boolean | undefined
    let visibilitySync = Promise.resolve()
    let previousPhase = takeoverPhase.current
    let takeoverReady = api.getBrowserTakeoverStatus === undefined
    let emittedTakeoverStatus = false
    const equal = (left: DesktopBrowserBounds | undefined, right: DesktopBrowserBounds): boolean =>
      left !== undefined && left.x === right.x && left.y === right.y
      && left.width === right.width && left.height === right.height
    const reportVisibility = (visible: boolean): void => {
      if (visible === reportedVisibility) return
      reportedVisibility = visible
      visibilitySync = visibilitySync.then(async () => {
        await api.setWorkbenchBrowserDockVisibility?.(visible)
      }).catch((reason: unknown) => {
        if (isMounted()) setError(reason instanceof Error ? reason.message : String(reason))
      })
    }
    const drain = async (): Promise<void> => {
      if (syncing) return
      syncing = true
      while (isMounted() && pending !== undefined) {
        const bounds = pending
        pending = undefined
        try {
          await visibilitySync
          if (takeoverPhase.current === 'human') {
            const next = await api.showWorkbenchBrowser(bounds)
            if (isMounted()) setSnapshot(next)
          } else {
            await api.layoutWorkbenchBrowser?.(bounds)
          }
        } catch (reason: unknown) {
          if (isMounted()) setError(reason instanceof Error ? reason.message : String(reason))
        }
      }
      syncing = false
    }
    const poll = () => {
      const rect = element.getBoundingClientRect()
      const bounds: DesktopBrowserBounds = { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      reportVisibility(isNativeBrowserHostExposed(element))
      if (!takeoverReady) {
        frame = requestAnimationFrame(poll)
        return
      }
      if (takeoverPhase.current !== previousPhase) {
        previousPhase = takeoverPhase.current
        previous = undefined
      }
      if (bounds.width > 0 && bounds.height > 0 && !equal(previous, bounds)) {
        previous = bounds
        pending = bounds
        void drain()
      }
      frame = requestAnimationFrame(poll)
    }
    const unsubscribe = api.onWorkbenchBrowserState((next) => {
      setSnapshot(next)
      if (next.url !== '') setAddress(next.url)
    })
    const applyTakeoverStatus = (status: BrowserTakeoverStatus, emitted: boolean): void => {
      if (!emitted && emittedTakeoverStatus) return
      if (emitted) emittedTakeoverStatus = true
      takeoverReady = true
      takeoverPhase.current = status.phase
      if (isMounted()) setTakeover(status)
    }
    const unsubscribeTakeover = api.onBrowserTakeoverStatus?.((status) => {
      applyTakeoverStatus(status, true)
    }) ?? (() => {})
    const visibilityObserver = new MutationObserver(() => {
      reportVisibility(isNativeBrowserHostExposed(element))
    })
    visibilityObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-modal', 'hidden'],
    })
    void api.getBrowserTakeoverStatus?.().then((status) => {
      applyTakeoverStatus(status, false)
    }, (reason: unknown) => {
      takeoverReady = true
      if (isMounted()) setError(reason instanceof Error ? reason.message : String(reason))
    })
    frame = requestAnimationFrame(poll)
    return () => {
      lifecycle.mounted = false
      unsubscribe()
      unsubscribeTakeover()
      visibilityObserver.disconnect()
      cancelAnimationFrame(frame)
      reportVisibility(false)
      void visibilitySync.then(async () => { await api.hideWorkbenchBrowser() }).catch(() => {})
    }
  }, [t])
  const give = async () => {
    const api = desktopApi()
    if (api?.giveWorkbenchBrowserToAgent === undefined) { setError(t('browserDesktopOnly')); return }
    if (!window.confirm(t('browserGiveWarning'))) return
    try {
      setError(undefined)
      setTakeover(await api.giveWorkbenchBrowserToAgent())
    } catch (reason: unknown) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }
  const stopAgent = async () => {
    const api = desktopApi()
    if (api?.stopAgentBrowser === undefined) { setError(t('browserDesktopOnly')); return }
    const previous = takeover
    setTakeover({ phase: 'stopping', signedInWarning: true })
    try {
      setError(undefined)
      setTakeover(await api.stopAgentBrowser())
    } catch (reason: unknown) {
      setTakeover(previous)
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }
  const controlled = takeover.phase !== 'human'
  return <div className={css.browser}>
    <form className={css.toolbar} onSubmit={(event) => { event.preventDefault(); void invoke({ kind: 'navigate', value: address }) }}>
      <button type="button" aria-label={t('back')} disabled={controlled || !snapshot.canGoBack} onClick={() => { void invoke({ kind: 'back' }) }}>‹</button>
      <button type="button" aria-label={t('forward')} disabled={controlled || !snapshot.canGoForward} onClick={() => { void invoke({ kind: 'forward' }) }}>›</button>
      <button type="button" aria-label={snapshot.loading ? t('stop') : t('reload')} disabled={controlled}
        onClick={() => { void invoke({ kind: snapshot.loading ? 'stop' : 'reload' }) }}>{snapshot.loading ? '×' : '↻'}</button>
      <input disabled={controlled} value={address} onChange={(event) => { setAddress(event.target.value) }} placeholder={t('browserPlaceholder')} />
      {takeover.phase === 'human'
        ? <button className={css.takeoverButton} type="button" aria-label={t('browserGive')} onClick={() => { void give() }}>{t('browserGive')}</button>
        : <button className={css.takeoverButton} type="button"
          aria-label={takeover.phase === 'stopping' ? t('browserStopping') : t('browserStopAgent')}
          disabled={takeover.phase === 'stopping'} onClick={() => { void stopAgent() }}>
          {takeover.phase === 'stopping' ? t('browserStopping') : t('browserStopAgent')}
        </button>}
    </form>
    <div className={css.status}>
      <span>{controlled ? t(takeover.phase === 'given' ? 'browserAgentWaiting' : 'browserAgentActive') : snapshot.title || t('browserNewTab')}</span>
      {(error ?? snapshot.error) && <strong>{error ?? snapshot.error}</strong>}
    </div>
    <div ref={host} className={css.host} data-native-browser-host><span>{t('browserNewTab')}</span></div>
  </div>
}
