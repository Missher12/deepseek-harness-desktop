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

const browserDockCommandTails = new WeakMap<DesktopBrowserApi, Promise<void>>()

function enqueueBrowserDockCommand(api: DesktopBrowserApi, command: () => Promise<void>): Promise<void> {
  const previous = browserDockCommandTails.get(api) ?? Promise.resolve()
  const next = previous.then(command, command)
  browserDockCommandTails.set(api, next.catch(() => {}))
  return next
}

function intersects(left: DOMRect, right: DOMRect): boolean {
  return left.left < right.right && left.right > right.left
    && left.top < right.bottom && left.bottom > right.top
}

function isRendered(element: Element, owner: Document): boolean {
  if (element.hasAttribute('hidden') || element.getAttribute('aria-hidden') === 'true') return false
  const style = owner.defaultView?.getComputedStyle(element)
  return style?.display !== 'none' && style?.visibility !== 'hidden' && style?.visibility !== 'collapse'
    && style?.opacity !== '0'
}

function isVisibleOccluder(element: Element, host: HTMLElement, hostRect: DOMRect, owner: Document): boolean {
  if (element === host || host.contains(element) || !isRendered(element, owner)) return false
  const rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0 && intersects(rect, hostRect)
}

/** Whether no DOM page surface can be punched through by the native Browser view. */
function isNativeBrowserHostExposed(element: HTMLElement, owner: Document = document): boolean {
  if (!element.isConnected || owner.visibilityState === 'hidden') return false
  const rect = element.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return false
  const modal = owner.querySelector('[aria-modal="true"]')
  if (modal !== null && isRendered(modal, owner)) return false
  const occluders = owner.querySelectorAll([
    '[role="dialog"]',
    '[role="tooltip"]',
    '[data-native-browser-occluder]',
    '[data-shell-overlay] > *',
  ].join(','))
  if ([...occluders].some(candidate => isVisibleOccluder(candidate, element, rect, owner))) return false
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
  const addressEditRevision = useRef(0)
  const addressEditing = useRef(false)
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
      if (request.kind === 'navigate') addressEditing.current = false
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
    let requestedVisibility: boolean | undefined
    let visibilityRevision = 0
    let visibilitySync = Promise.resolve()
    let lastVisibilityError: string | undefined
    let lastDockError: string | undefined
    let dockFailureCount = 0
    let dockRetryAfter = 0
    let addressHydrated = false
    let previousPhase = takeoverPhase.current
    let takeoverReady = api.getBrowserTakeoverStatus === undefined
    let emittedTakeoverStatus = false
    const equal = (left: DesktopBrowserBounds | undefined, right: DesktopBrowserBounds): boolean =>
      left !== undefined && left.x === right.x && left.y === right.y
      && left.width === right.width && left.height === right.height
    const reportVisibility = (visible: boolean): void => {
      if (visible === requestedVisibility) return
      requestedVisibility = visible
      visibilityRevision += 1
      const revision = visibilityRevision
      visibilitySync = enqueueBrowserDockCommand(api, async () => {
        await api.setWorkbenchBrowserDockVisibility?.(visible)
      }).then(() => {
        if (revision !== visibilityRevision || !isMounted() || lastVisibilityError === undefined) return
        const recovered = lastVisibilityError
        lastVisibilityError = undefined
        setError(current => current === recovered ? undefined : current)
      }, (reason: unknown) => {
        if (revision !== visibilityRevision) return
        requestedVisibility = undefined
        lastVisibilityError = reason instanceof Error ? reason.message : String(reason)
        if (isMounted()) setError(lastVisibilityError)
      })
    }
    const waitForCurrentVisibility = async (): Promise<void> => {
      while (isMounted()) {
        const current = visibilitySync
        await current
        if (current === visibilitySync) return
      }
    }
    const drain = async (): Promise<void> => {
      if (syncing) return
      syncing = true
      while (isMounted() && pending !== undefined) {
        const bounds = pending
        pending = undefined
        if (equal(previous, bounds)) continue
        try {
          await waitForCurrentVisibility()
          if (!isMounted()) break
          if (!isNativeBrowserHostExposed(element)) {
            reportVisibility(false)
            continue
          }
          if (takeoverPhase.current === 'human') {
            const editRevision = addressEditRevision.current
            const next = await api.showWorkbenchBrowser(bounds)
            if (isMounted()) {
              previous = bounds
              setSnapshot(next)
              if (!addressHydrated) {
                addressHydrated = true
                if (editRevision === addressEditRevision.current) setAddress(next.url)
              }
            }
          } else {
            await api.layoutWorkbenchBrowser?.(bounds)
            previous = bounds
          }
          dockFailureCount = 0
          dockRetryAfter = 0
          if (lastDockError !== undefined) {
            const recovered = lastDockError
            lastDockError = undefined
            if (isMounted()) setError(current => current === recovered ? undefined : current)
          }
        } catch (reason: unknown) {
          previous = undefined
          dockFailureCount += 1
          dockRetryAfter = dockFailureCount > 1 ? Date.now() + 250 : 0
          lastDockError = reason instanceof Error ? reason.message : String(reason)
          if (isMounted()) setError(lastDockError)
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
        dockFailureCount = 0
        dockRetryAfter = 0
      }
      const retryReady = Date.now() >= dockRetryAfter
      if (bounds.width > 0 && bounds.height > 0 && !equal(previous, bounds) && retryReady) {
        pending = bounds
        void drain()
      }
      frame = requestAnimationFrame(poll)
    }
    const unsubscribe = api.onWorkbenchBrowserState((next) => {
      setSnapshot(next)
      if (next.url !== '' && !addressEditing.current) setAddress(next.url)
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
      attributeFilter: ['aria-modal', 'aria-hidden', 'role', 'hidden', 'class', 'style'],
    })
    const handleDocumentVisibility = (): void => {
      if (document.visibilityState === 'hidden') {
        reportVisibility(false)
        return
      }
      previous = undefined
      addressHydrated = false
      reportVisibility(isNativeBrowserHostExposed(element))
    }
    document.addEventListener('visibilitychange', handleDocumentVisibility)
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
      document.removeEventListener('visibilitychange', handleDocumentVisibility)
      cancelAnimationFrame(frame)
      reportVisibility(false)
      void enqueueBrowserDockCommand(api, async () => { await api.hideWorkbenchBrowser() }).catch(() => {})
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
      <input disabled={controlled} value={address}
        onFocus={() => { addressEditing.current = true }}
        onBlur={() => {
          addressEditing.current = false
          if (snapshot.url !== '') setAddress(snapshot.url)
        }}
        onChange={(event) => {
          addressEditing.current = true
          addressEditRevision.current += 1
          setAddress(event.target.value)
        }} placeholder={t('browserPlaceholder')} />
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
