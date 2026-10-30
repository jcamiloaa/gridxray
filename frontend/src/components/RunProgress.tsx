import type { RunEvent } from '../api/client'
import { money } from '../money'
import { useI18n } from '../i18n'

/** Visual progress of a live investigation: budget slots, reconstruction curve, confidence and cost. */
export function RunProgress({ events, total }: { events: RunEvent[]; total: number }) {
  const { t } = useI18n()
  const initial = (events.find((e) => e.kind === 'started')?.budget as number | undefined) ?? 0
  // the planning agent may add experiments after a field failure: the latest figure counts
  const budget = ([...events].reverse().find((e) => e.kind === 'replan' || e.kind === 'started')?.budget as number | undefined) ?? 0
  const added = Math.max(0, budget - initial)
  const experiments = events.filter((e) => e.kind === 'experiment')
  // field-crew visits spend budget too: they show as a camera slot
  const accepted = events.filter((e) => (e.kind === 'experiment' && e.accepted) || e.kind === 'field_reading')
  const candidates = events.filter((e) => e.kind === 'candidate')
  const series = candidates.map((c) => {
    const edges = (c.edges as { basis: string }[]) ?? []
    const confirmed = edges.filter((e) => e.basis === 'measured' || e.basis === 'proposed').length
    return { confirmed, inferred: edges.length - confirmed }
  })
  const last = series[series.length - 1]
  const conf = [...events].reverse().find((e) => e.kind === 'hypothesis')?.confidence as number | undefined
  const usage = [...events].reverse().find((e) => e.kind === 'usage') as { tokens?: number; cost_usd?: number } | undefined

  const W = 300
  const H = 64
  const n = Math.max(1, total)
  const x = (i: number) => (series.length <= 1 ? W : (i / (series.length - 1)) * W)
  const y = (v: number) => H - (v / n) * H
  const area = (key: 'confirmed' | 'inferred') => {
    if (!series.length) return ''
    const top = series.map((s, i) => `${x(i)},${y(key === 'confirmed' ? s.confirmed : s.confirmed + s.inferred)}`)
    const base = key === 'confirmed' ? series.map((_, i) => `${x(i)},${H}`).reverse()
      : series.map((s, i) => `${x(i)},${y(s.confirmed)}`).reverse()
    return `M${top.join(' L')} L${base.join(' L')} Z`
  }

  return (
    <div className="run-viz">
      <div className="run-viz__row">
        <span className="run-viz__label">{t('Experiment budget used')}</span>
        <span className="run-viz__num">{accepted.length}/{budget || '—'}
          {added > 0 && <small className="run-viz__added" title={t('Experiments added by the planning agent after a field failure')}> (+{added} {t('planner')})</small>}</span>
      </div>
      <div className="budget-slots" aria-label={`${accepted.length} of ${budget} experiments`}>
        {Array.from({ length: Math.max(budget, accepted.length) }, (_, i) => {
          const e = accepted[i]
          const args = e?.args as { node?: string; switch_id?: number } | undefined
          if (e?.kind === 'field_reading') return <span key={i} className="slot slot--done slot--crew" title={`${t('Field crew')} · ${String(e.node)}`}>📷</span>
          return <span key={i} className={`slot${e ? ' slot--done' : ''}${i >= initial && added ? ' slot--added' : ''}`} title={e ? (args?.node ?? `switch ${args?.switch_id}`) : ''}>
            {e ? (args?.node?.replace('SS-', '') ?? 'SW') : ''}</span>
        })}
        {experiments.filter((e) => !e.accepted).map((_, i) => <span key={`r${i}`} className="slot slot--rejected">×</span>)}
      </div>

      <div className="run-viz__row" style={{ marginTop: 8 }}>
        <span className="run-viz__label">{t('Reconstruction')}</span>
        <span className="run-viz__num">{last ? `${last.confirmed}/${total} ${t('confirmed')}` : '—'}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="run-viz__chart" preserveAspectRatio="none" role="img"
        aria-label="Confirmed and inferred connections after each step">
        <path d={area('inferred')} fill="#f4cf8a" />
        <path d={area('confirmed')} fill="#0e6e8c" />
      </svg>
      <div className="run-viz__legend">
        <span><i style={{ background: '#0e6e8c' }} />{t('confirmed by experiments')}</span>
        <span><i style={{ background: '#f4cf8a' }} />{t('inferred')}</span>
      </div>

      <div className="run-viz__stats">
        <div><b>{conf !== undefined ? `${Math.round(conf * 100)}%` : '—'}</b><span>{t('Latest confidence')}</span></div>
        <div><b>{usage?.tokens ? `${Math.round(usage.tokens / 1000)}k` : '—'}</b><span>{t('Tokens')}</span></div>
        <div><b>{usage?.cost_usd !== undefined ? money(usage.cost_usd) : '—'}</b><span>{t('Cost')}</span></div>
      </div>
    </div>
  )
}
