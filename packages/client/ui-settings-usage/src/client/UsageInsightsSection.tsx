import {
  useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode,
} from 'react'
import type { UsageInsightsSnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { buildParticleGrid, type ParticleChartMode } from './charts.ts'
import { formatCompactNumber, formatDuration, formatModel } from './format.ts'
import { readUsageSnapshot, writeUsageSnapshot } from './snapshot-cache.ts'
import css from './UsageInsightsSection.module.css'

/** Registration-side Remote and locale face used by the section. */
export interface UsageInsightsSectionInjected {
  /** Read one current all-history Host snapshot. */
  load: () => Promise<UsageInsightsSnapshot>
  /** Active locale id for numeric/date formatting. */
  locale: string
}

/** Full component props assembled by the Settings slot renderer. */
export type UsageInsightsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.usage'>
  & InjectFace<UsageInsightsSectionInjected>

type ViewState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | {
    readonly status: 'ready'
    readonly snapshot: UsageInsightsSnapshot
    readonly refreshing: boolean
    readonly stale: boolean
  }

type ChartMode = ParticleChartMode

const LOAD_TIMEOUT_MS = 15_000

/** Month label in the active UI locale. */
function monthLabel(date: string, locale: string): string {
  const [year, month] = date.split('-').map(Number) as [number, number]
  return new Intl.DateTimeFormat(locale, { month: 'short' }).format(new Date(Date.UTC(year, month - 1, 1)))
}

/** Scope date used by the visible particle tooltip. */
function particleDateLabel(date: string, locale: string, includeYear: boolean): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number]
  return new Intl.DateTimeFormat(locale, {
    ...(includeYear ? { year: 'numeric' as const } : {}),
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day)))
}

/** Fill the two bounded placeholders used by particle tooltip copy. */
function tooltipText(template: string, date: string, tokens: string): string {
  return template.replace('{date}', date).replace('{tokens}', tokens)
}

/** Replace bounded placeholders without exposing any Host error text. */
function partialText(
  template: string,
  sessions: number,
  samples: number,
): string {
  return template.replace('{sessions}', String(sessions)).replace('{samples}', String(samples))
}

/** Shared page heading kept stable across loading, ready, and error states. */
function PageHeader({ title, intro }: { title: string; intro: string }): ReactNode {
  return (
    <header className={css.pageHeader}>
      <h2 className={css.pageTitle}>{title}</h2>
      <p className={css.pageIntro}>{intro}</p>
    </header>
  )
}

/** Geometry-first placeholder used before the first local snapshot is available. */
function UsageSkeleton({ label, intro }: { label: string; intro: string }): ReactNode {
  return (
    <section
      className={`${css.section} ${css.skeleton}`}
      data-usage-skeleton
      aria-label={label}
      aria-busy="true"
    >
      <PageHeader title={label} intro={intro} />
      <div className={`${css.summary} ${css.skeletonSummary}`} aria-hidden="true">
        {Array.from({ length: 5 }, (_, index) => (
          <div className={`${css.metric} ${css.skeletonMetric}`} data-usage-skeleton-metric key={index}>
            <span className={css.skeletonBlock} />
            <span className={css.skeletonBlock} />
          </div>
        ))}
      </div>
      <div className={css.activityHeader} aria-hidden="true">
        <span className={`${css.skeletonBlock} ${css.skeletonHeading}`} />
        <div className={`${css.tabs} ${css.skeletonTabs}`}>
          {Array.from({ length: 3 }, (_, index) => (
            <span className={css.skeletonBlock} data-usage-skeleton-tab key={index} />
          ))}
        </div>
      </div>
      <div className={css.chartPanel} aria-hidden="true">
        <div className={css.chartFrame}>
          <div className={css.heatmapStage}>
            <div className={`${css.heatmap} ${css.skeletonParticles}`}>
              {Array.from({ length: 371 }, (_, index) => (
                <i
                  data-usage-skeleton-day
                  key={index}
                  style={{ '--usage-skeleton-index': index } as CSSProperties}
                />
              ))}
            </div>
          </div>
          <div className={`${css.months} ${css.skeletonMonths}`}>
            {Array.from({ length: 12 }, (_, index) => (
              <span className={css.skeletonBlock} data-usage-skeleton-month key={index} />
            ))}
          </div>
        </div>
      </div>
      <div className={`${css.detailsGrid} ${css.skeletonDetails}`} aria-hidden="true">
        <div data-usage-skeleton-detail>
          {Array.from({ length: 7 }, (_, index) => <span className={css.skeletonBlock} key={index} />)}
        </div>
        <div data-usage-skeleton-detail>
          {Array.from({ length: 7 }, (_, index) => <span className={css.skeletonBlock} key={index} />)}
        </div>
      </div>
    </section>
  )
}

/** Five equal summary cells at the top of the page. */
function Summary({ snapshot, locale, t }: {
  snapshot: UsageInsightsSnapshot
  locale: string
  t: UsageInsightsSectionProps['t']
}): ReactNode {
  const metrics = [
    [snapshot.summary.totalTokens === null ? '—' : formatCompactNumber(snapshot.summary.totalTokens, locale), t('totalTokens')],
    [snapshot.summary.peakDailyTokens === null ? '—' : formatCompactNumber(snapshot.summary.peakDailyTokens, locale), t('peakTokens')],
    [snapshot.summary.longestSessionMs === null ? '—' : formatDuration(snapshot.summary.longestSessionMs, locale), t('longestSession')],
    [String(snapshot.summary.currentStreakDays), t('currentStreak')],
    [String(snapshot.summary.longestStreakDays), t('longestStreak')],
  ]
  return (
    <dl className={css.summary}>
      {metrics.map(([value, label]) => (
        <div className={css.metric} key={label}>
          <dd>{value}</dd>
          <dt>{label}</dt>
        </div>
      ))}
    </dl>
  )
}

/** Daily, weekly, and cumulative chart body over one immutable snapshot. */
function ActivityChart({ snapshot, mode, locale, t }: {
  snapshot: UsageInsightsSnapshot
  mode: ChartMode
  locale: string
  t: UsageInsightsSectionProps['t']
}): ReactNode {
  const baselineTokens = useMemo(() => {
    if (snapshot.summary.totalTokens === null) return 0
    const visibleTokens = snapshot.activity.reduce((sum, day) => sum + day.tokens, 0)
    return Math.max(0, snapshot.summary.totalTokens - visibleTokens)
  }, [snapshot.activity, snapshot.summary.totalTokens])
  const weeks = useMemo(
    () => buildParticleGrid(snapshot.activity, mode, baselineTokens),
    [baselineTokens, snapshot.activity, mode],
  )
  const [tooltip, setTooltip] = useState<{
    edge: 'left' | 'middle' | 'right'
    text: string
    x: string
  } | null>(null)
  const monthStarts = snapshot.activity.filter((day, index) => (
    index === 0 || day.date.slice(0, 7) !== snapshot.activity[index - 1]?.date.slice(0, 7)
  ))
  const summary = mode === 'daily' ? t('dailySummary') : mode === 'weekly' ? t('weeklySummary') : t('cumulativeSummary')
  useEffect(() => { setTooltip(null) }, [mode])
  const showTooltip = (particle: (typeof weeks)[number][number], index: number): void => {
    const date = particleDateLabel(particle.labelDate, locale, mode !== 'daily')
    const template = t(mode === 'daily' ? 'dailyTooltip' : mode === 'weekly' ? 'weeklyTooltip' : 'cumulativeTooltip')
    setTooltip({
      edge: index < 8 ? 'left' : index > 44 ? 'right' : 'middle',
      text: tooltipText(template, date, formatCompactNumber(particle.tokens, locale)),
      x: `${(index + 0.5) / weeks.length * 100}%`,
    })
  }
  return (
    <div className={css.chartFrame} role="img" aria-label={summary}>
      <div className={css.heatmapStage} onMouseLeave={() => { setTooltip(null) }}>
        {tooltip === null ? null : (
          <div
            className={css.tooltip}
            data-edge={tooltip.edge}
            role="tooltip"
            style={{ '--usage-tooltip-x': tooltip.x } as CSSProperties}
          >
            {tooltip.text}
          </div>
        )}
        <div className={css.heatmap} aria-hidden="true">
          {weeks.map((week, index) => (
            <div className={css.heatmapWeek} key={week[0].date}>
              {week.map(particle => (
                <span
                  className={css.day}
                  data-activity-day={particle.date}
                  data-display-tokens={particle.tokens}
                  data-level={particle.level}
                  data-particle-mode={mode}
                  data-period-end={particle.periodEnd}
                  data-period-start={particle.periodStart}
                  key={particle.date}
                  onMouseEnter={() => { showTooltip(particle, index) }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className={css.months} aria-hidden="true">
        {monthStarts.slice(-12).map(day => <span key={day.date}>{monthLabel(day.date, locale)}</span>)}
      </div>
    </div>
  )
}

/** Render the privacy-minimal all-history usage dashboard. */
export function UsageInsightsSection({ load, locale, t }: UsageInsightsSectionProps): ReactNode {
  const [request, setRequest] = useState(0)
  const [mode, setMode] = useState<ChartMode>('daily')
  const [state, setState] = useState<ViewState>(() => {
    const cached = readUsageSnapshot()
    return cached === undefined
      ? { status: 'loading' }
      : { status: 'ready', snapshot: cached, refreshing: true, stale: false }
  })
  const panelId = useId()
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const modes: ChartMode[] = ['daily', 'weekly', 'cumulative']

  useEffect(() => {
    let current = true
    const fail = (): void => {
      setState(previous => previous.status === 'ready'
        ? { ...previous, refreshing: false, stale: true }
        : { status: 'error' })
    }
    const timeout = window.setTimeout(fail, LOAD_TIMEOUT_MS)
    void Promise.resolve().then(() => load()).then(
      (snapshot) => {
        if (!current) return
        window.clearTimeout(timeout)
        writeUsageSnapshot(snapshot)
        setState({ status: 'ready', snapshot, refreshing: false, stale: false })
      },
      () => {
        if (!current) return
        window.clearTimeout(timeout)
        fail()
      },
    )
    return () => {
      current = false
      window.clearTimeout(timeout)
    }
  }, [load, request])

  const retry = (): void => {
    setState(previous => previous.status === 'ready'
      ? { ...previous, refreshing: true, stale: false }
      : { status: 'loading' })
    setRequest(value => value + 1)
  }

  const selectFromKey = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    let next: number | undefined
    if (event.key === 'ArrowRight') next = (index + 1) % modes.length
    else if (event.key === 'ArrowLeft') next = (index + modes.length - 1) % modes.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = modes.length - 1
    if (next === undefined) return
    event.preventDefault()
    setMode(modes[next] as ChartMode)
    tabRefs.current[next]?.focus()
  }

  if (state.status === 'loading') return <UsageSkeleton label={t('section')} intro={t('sectionIntro')} />
  if (state.status === 'error') {
    return (
      <section className={css.section} aria-label={t('section')}>
        <PageHeader title={t('section')} intro={t('sectionIntro')} />
        <div className={css.failure}>
          <p role="alert">{t('error')}</p>
          <button type="button" onClick={retry}>{t('retry')}</button>
        </div>
      </section>
    )
  }
  const { snapshot } = state
  const insightRows = [
    [t('cacheHitRate'), snapshot.insights.cacheHitRate === null ? '—' : `${Math.round(snapshot.insights.cacheHitRate * 100)}%`],
    [t('mostUsedModel'), formatModel(snapshot.insights.mostUsedModel)],
    [t('mostUsedEffort'), snapshot.insights.mostUsedReasoningEffort ?? '—'],
    [t('exploredSkills'), String(snapshot.insights.uniqueSkills)],
    [t('totalTools'), formatCompactNumber(snapshot.insights.totalToolCalls, locale)],
    [t('chatDays'), formatCompactNumber(snapshot.insights.chatDays, locale)],
  ]
  return (
    <section className={css.section} aria-label={t('section')} aria-busy={state.refreshing}>
      <PageHeader title={t('section')} intro={t('sectionIntro')} />
      <Summary snapshot={snapshot} locale={locale} t={t} />
      {state.stale ? (
        <div className={css.refreshNotice} data-usage-refresh-stale role="status">
          <span>{t('refreshFailed')}</span>
          <button type="button" onClick={retry}>{t('retry')}</button>
        </div>
      ) : null}
      {snapshot.omittedSessions > 0 || snapshot.incompleteUsageSamples > 0 ? (
        <p className={css.partial} role="status">
          {partialText(t('partial'), snapshot.omittedSessions, snapshot.incompleteUsageSamples)}
        </p>
      ) : null}
      {snapshot.sessionCount === 0 ? <p className={css.empty}>{t('empty')}</p> : null}
      <div className={css.activityHeader}>
        <h3>{t('tokenActivity')}</h3>
        <div className={css.tabs} role="tablist" aria-label={t('tokenActivity')}>
          {modes.map((item, index) => (
            <button
              key={item}
              ref={(node) => { tabRefs.current[index] = node }}
              id={`${panelId}-${item}-tab`}
              type="button"
              role="tab"
              aria-selected={mode === item}
              aria-controls={`${panelId}-panel`}
              tabIndex={mode === item ? 0 : -1}
              onClick={() => { setMode(item) }}
              onKeyDown={(event) => { selectFromKey(event, index) }}
            >
              {t(item)}
            </button>
          ))}
        </div>
      </div>
      <div className={css.chartPanel} id={`${panelId}-panel`} role="tabpanel" aria-labelledby={`${panelId}-${mode}-tab`}>
        <ActivityChart snapshot={snapshot} mode={mode} locale={locale} t={t} />
      </div>
      <div className={css.detailsGrid}>
        <div>
          <h3>{t('activityInsights')}</h3>
          <dl className={css.insights}>
            {insightRows.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd title={value}>{value}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div>
          <h3>{t('mostUsedFeatures')}</h3>
          {snapshot.features.length === 0 ? <p className={css.noFeatures}>{t('noFeatures')}</p> : (
            <ol className={css.features}>
              {snapshot.features.map(feature => (
                <li key={`${feature.kind}:${feature.name}`}>
                  <span className={css.featureBadge} data-kind={feature.kind}>
                    {t(feature.kind === 'skill' ? 'skillBadge' : 'toolBadge')}
                  </span>
                  <strong title={feature.name}>{feature.name}</strong>
                  <span>{formatCompactNumber(feature.count, locale)} {t('runs')}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </section>
  )
}
