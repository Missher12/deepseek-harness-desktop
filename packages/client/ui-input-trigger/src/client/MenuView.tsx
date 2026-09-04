/**
 * Trigger candidate menu: renders the InputTriggerService menu store into the
 * conversation.input.overlay anchor. Closed state renders null (the overlay
 * slot stays mounted); groups render in roster order under localized title
 * rows. A pending group keeps showing the items it already had (the reducer
 * retains them across a query refinement) and falls back to two skeleton
 * rows only while it has none; pointer picks route back through
 * the service (combobox pattern — focus never leaves the textarea, so rows
 * are mousedown-handled and the highlight is exposed via
 * aria-activedescendant on the listbox). A source publishing crumbs gets a
 * breadcrumb header pinned above the scrolling list.
 */
import { Fragment, useEffect, useRef, useSyncExternalStore } from 'react'
import clsx from 'clsx'
import {
  IconChevronRightOutline14, IconCordisPluginOutline14, IconGoalOutline16, IconImageOutline16,
  IconPaperclipOutline16, IconSkillOutline16, IconThinkOutline16, ReferenceIcon,
  useAnchoredMaxHeight,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './MenuView.module.css'
import type { MenuViewInjected } from './slots.ts'
import type { MenuKey } from './locales.ts'
import type { InputTriggerCandidateIcon } from '../types.ts'

/** Full menu props: injected face + the locale seat. */
export type MenuViewProps = MenuViewInjected & PropsLocale<'slash.menu'>

/** Design cap on the list height (figma SLASH 39:26572 MenuDropdown). */
const MAX_HEIGHT = 320

/** DOM id of one option row (the aria-activedescendant target). */
function optionId(source: string, index: number): string {
  return `dsh-slash-option-${source}-${index}`
}

/**
 * React identity for one rendered candidate. The DOM id remains positional for
 * aria-activedescendant, but a stale-while-revalidate row must be replaced when
 * a new query settles a different candidate into the same position. Otherwise
 * an already-resolved pointer locator can click the new positional handler
 * while still carrying the old row's accessible name.
 */
function optionKey(source: string, index: number, name: string, value?: string): string {
  return JSON.stringify([source, index, name, value])
}

/** Map the closed candidate vocabulary to one consistent menu glyph. */
function candidateIcon(icon: InputTriggerCandidateIcon | undefined) {
  switch (icon) {
    case 'goal': return <IconGoalOutline16 />
    case 'plan': return <IconThinkOutline16 />
    case 'skill': return <IconSkillOutline16 />
    case 'plugin': return <IconCordisPluginOutline14 size={16} />
    case 'file':
    case 'folder':
    case 'session': return <ReferenceIcon kind={icon} size={16} />
    case undefined: return undefined
  }
}

/**
 * Render the candidate menu overlay entry.
 * @param props - injected face (the menu store and the pick route); `t` rides the standard locale seat.
 * @returns the dropdown while open; null while closed.
 */
export function MenuView({ menu, launcher, headers, onPick, onCrumb, onHover, onDismiss, t }: MenuViewProps) {
  const state = useSyncExternalStore(
    fn => menu.subscribe(fn),
    () => menu.getSnapshot(),
  )
  const launcherName = useSyncExternalStore(
    fn => launcher.subscribe(fn),
    () => launcher.getSnapshot(),
  )
  const composerAdd = launcherName === 'composer-add'
  const crumbs = useSyncExternalStore(
    fn => headers.subscribe(fn),
    () => headers.getSnapshot(),
  )
  const listRef = useRef<HTMLDivElement>(null)
  // The list is bottom-anchored above the composer; clamp the design cap to
  // the space above it, re-measured on every store update (the anchor moves
  // when the composer grows).
  const maxHeight = useAnchoredMaxHeight(listRef, MAX_HEIGHT, state)
  const highlight = state.open ? state.highlight : null
  // Focus stays in the textarea (combobox pattern), so the browser never
  // scrolls the active option into view on keyboard moves — do it here.
  useEffect(() => {
    if (highlight === null) return
    document.getElementById(optionId(highlight.source, highlight.index))
      ?.scrollIntoView({ block: 'nearest' })
  }, [highlight])
  // Dismiss on pointer outside the menu AND outside the composer card
  // (clicking the textarea or bottom bar must not close the menu).
  useEffect(() => {
    if (!state.open) return
    const onPointerDown = (ev: PointerEvent): void => {
      if (!(ev.target instanceof Node)) return
      if (listRef.current?.contains(ev.target)) return
      const composerCard = listRef.current?.closest('[data-composer-card]')
      if (composerCard?.contains(ev.target)) return
      onDismiss()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => { document.removeEventListener('pointerdown', onPointerDown, true) }
  }, [state.open, onDismiss])
  if (!state.open) return null

  let previousSection: string | undefined
  return (
    <div
      ref={listRef}
      className={clsx(css.menu, composerAdd && css.composerAdd)}
      style={{ maxHeight }}
      data-composer-add-menu={composerAdd || undefined}
      data-trigger-menu=""
    >
      {state.groups.map((group) => {
        const trail = crumbs.get(group.source)
        return trail === undefined ? null : (
          <nav key={group.source} className={css.crumbs} aria-label={t('crumbs.aria')}>
            {trail.map((crumb, index) => (
              <Fragment key={`${String(index)}-${crumb.value}`}>
                {index > 0 && <span className={css.crumbSeparator} aria-hidden><IconChevronRightOutline14 /></span>}
                <button
                  type="button"
                  className={clsx(css.crumb, crumb.current === true && css.crumbCurrent)}
                  aria-current={crumb.current === true ? 'location' : undefined}
                  disabled={crumb.current === true}
                  // mousedown, not click: the composer keeps focus, same as a row.
                  onMouseDown={(ev) => {
                    ev.preventDefault()
                    onCrumb(group.source, index)
                  }}
                >
                  {crumb.label}
                </button>
              </Fragment>
            ))}
          </nav>
        )
      })}
      <div
        className={clsx(css.viewport, composerAdd && css.addViewport)}
        role="listbox"
        aria-label={t('suggestions.aria')}
        aria-activedescendant={highlight !== null ? optionId(highlight.source, highlight.index) : undefined}
      >
        {state.groups.map(group => (group.status === 'ready' && group.items.length === 0)
          ? null
          : (
            <Fragment key={group.source}>
              {/* Source names key the dictionary open-endedly: the lookup chain
                  returns an unknown key verbatim, so an unregistered source
                  shows its raw name — hence the cast past the typed key union. */}
              {composerAdd || group.showGroupTitle === false || group.items.some(item => item.section !== undefined)
                ? null
                : <div className={css.groupTitle} role="presentation" data-source={group.source}>{t(group.source as MenuKey)}</div>}
              {group.status === 'pending' && group.items.length === 0
                ? (
                  <div role="status" aria-label={t('loading')} data-source={group.source}>
                    <div className={css.skeletonRow}><span className={css.skeletonBar} style={{ width: '32%' }} /></div>
                    <div className={css.skeletonRow}><span className={css.skeletonBar} style={{ width: '48%' }} /></div>
                  </div>
                )
                : group.items.map((item, index) => {
                  const active = highlight !== null && highlight.source === group.source && highlight.index === index
                  const showSection = item.section !== undefined && (composerAdd
                    ? item.section !== previousSection
                    : item.section !== group.items[index - 1]?.section)
                  if (composerAdd && item.section !== undefined) previousSection = item.section
                  const icon = composerAdd && group.source === 'composer-add'
                    ? item.value === 'image' ? <IconImageOutline16 /> : <IconPaperclipOutline16 />
                    : candidateIcon(item.icon)
                  return (
                    <Fragment key={optionKey(group.source, index, item.name, item.value)}>
                      {showSection
                        ? <div className={css.sectionTitle} role="presentation" data-add-section={composerAdd || undefined}>{item.section}</div>
                        : null}
                      <button
                        id={optionId(group.source, index)}
                        type="button"
                        role="option"
                        aria-selected={active}
                        className={clsx(css.item, composerAdd && css.addItem, active && css.active)}
                        // mousedown, not click: the textarea keeps focus (combobox
                        // pattern) — preventing default stops the focus steal, and the
                        // pick runs before any blur-driven teardown.
                        onMouseDown={(ev) => {
                          ev.preventDefault()
                          onPick(group.source, index)
                        }}
                        // mousemove, not mouseenter: real pointer motion moves the
                        // shared highlight; keyboard scrolling rows under a resting
                        // pointer must not steal it back.
                        onMouseMove={active ? undefined : () => { onHover(group.source, index) }}
                      >
                        {icon !== undefined && <span className={css.itemIcon} aria-hidden>{icon}</span>}
                        <span className={css.itemName}>{item.name}</span>
                        {item.description !== undefined && <span className={css.itemDescription}>{item.description}</span>}
                        {item.drill === true && (
                          <span className={css.trailing}>
                            {/* Visual hint only: Tab drills the highlighted row (the
                                keyboard twin of the chevron, which owns the aria label). */}
                            <span className={css.drillHintText} aria-hidden>{t('drill.hint')}</span>
                            <kbd className={css.drillHint} aria-hidden>{t('drill.key')}</kbd>
                            <span
                              role="button"
                              aria-label={t('drill.aria')}
                              className={css.drill}
                              // mousedown so the composer keeps focus, same as the row;
                              // stopPropagation keeps the row's settling pick out of it.
                              onMouseDown={(ev) => {
                                ev.preventDefault()
                                ev.stopPropagation()
                                onPick(group.source, index, 'drill')
                              }}
                            >
                              <IconChevronRightOutline14 />
                            </span>
                          </span>
                        )}
                      </button>
                    </Fragment>
                  )
                })}
            </Fragment>
          ))}
      </div>
    </div>
  )
}
