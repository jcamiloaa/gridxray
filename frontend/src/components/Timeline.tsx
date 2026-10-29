import { useEffect, useRef, useState } from 'react'
import type { RunEvent } from '../api/client'
import { useI18n } from '../i18n'
import { TOOL_LABEL } from './toolLabels'
import { AiInputDialog } from './AiInputDialog'
import { CrewVisit } from './CrewVisit'
import { Markdown } from './Markdown'

const CREW_KINDS = new Set(['crew_dispatched', 'crew_stage', 'field_photo', 'segmentation', 'field_reading'])


interface Rejection { limit: string; value?: number; threshold?: number; safe_kw?: number }

/** Plain-language reason for a rejected experiment: which operating limit, by how much, and a safe size. */
function WhyRejected({ e, what }: { e: RunEvent; what: string }) {
  const { t } = useI18n()
  const r = e.rejection as Rejection | undefined
  if (!r) return <p>{String(e.message ?? e.error ?? '')}</p>
  const vars = { what, value: r.value ?? '', threshold: r.threshold ?? '' }
  const key = `reject.${r.limit}`
  return (
    <div className="tl__why">
      <p><b>{t('Why?')}</b> {t(key, vars) === key ? String(e.message) : t(key, vars)}</p>
      <small>{t('reject.free')}{r.safe_kw ? ` ${t('reject.safe', { kw: r.safe_kw })}` : ''}</small>
    </div>
  )
}

const list = (names: string[]) => names.slice(0, 5).join(', ') + (names.length > 5 ? ` (+${names.length - 5})` : '')

/** What the experiment physically was and what it taught, in plain language. */
function WhatItIs({ e, args }: { e: RunEvent; args: { kind: string; node?: string; delta_kw?: number; switch_id?: number } }) {
  const { t } = useI18n()
  if (args.kind !== 'perturb_load') {
    const delta = Object.entries((e.delta_pu ?? {}) as Record<string, number>)
    const moved = delta.filter(([, v]) => Math.abs(v) > 0.0005).map(([n]) => n)
    return (
      <details className="tl__what"><summary>{t('What is this experiment?')}</summary>
        <p>{t('exp.switch', { id: args.switch_id ?? '' })}</p>
        <p>{moved.length ? t('exp.switch.moved', { nodes: list(moved) }) : t('exp.switch.none')}</p>
      </details>
    )
  }
  const drops = (e.drop_pu_per_mw ?? {}) as Record<string, number>
  const node = args.node ?? ''
  const own = drops[node]
  const max = Math.max(0, ...Object.values(drops))
  const others = Object.entries(drops).filter(([n]) => n !== node)
  const below = own ? others.filter(([, v]) => v >= own * 0.97).map(([n]) => n) : []
  const far = others.filter(([, v]) => v < max * 0.35).map(([n]) => n)
  const kw = Math.abs(args.delta_kw ?? 0)
  return (
    <details className="tl__what"><summary>{t('What is this experiment?')}</summary>
      <p>{t('exp.load', { kw, node, homes: Math.round(kw / 1.5) })}</p>
      <p>{t('exp.unit', { own: own ? (own * 1000).toFixed(1) : '—', node })}</p>
      {below.length > 0 && <p>{t('exp.below', { nodes: list(below), node })}</p>}
      {far.length > 0 && <p>{t('exp.far', { nodes: list(far) })}</p>}
    </details>
  )
}

function Experiment({ e }: { e: RunEvent }) {
  const { t } = useI18n()
  const args = (e.args ?? {}) as { kind: string; node?: string; delta_kw?: number; switch_id?: number; repeats?: number }
  const drops = Object.entries((e.drop_pu_per_mw ?? {}) as Record<string, number>).slice(0, 3)
  const what = args.kind === 'perturb_load'
    ? `${(args.delta_kw ?? 0) > 0 ? '+' : ''}${args.delta_kw} kW ${t('at')} ${args.node}`
    : `${t('operate switch')} #${args.switch_id}`
  return (
    <li className={`tl tl--exp${e.accepted ? '' : ' tl--rejected'}`}>
      <span className="tl__icon">⚡</span>
      <div>
        <b>{t('Experiment')} {e.accepted ? `#${e.experiment}` : `(${t('rejected')})`} · {what}</b>
        {e.accepted ? (
          <>
            <p>{drops.length ? `${t('Strongest response')}: ${drops.map(([n, v]) => `${n} ${(v * 1000).toFixed(2)}`).join(', ')} mpu/MW` : String(e.message)}</p>
            <WhatItIs e={e} args={args} />
          </>
        ) : <WhyRejected e={e} what={what} />}
        <small>{t('Budget left')}: {String(e.budget_remaining ?? '—')}</small>
      </div>
    </li>
  )
}

/** Live log of the investigation: Spark's reasoning, experiments, hypotheses and Wonder's reviews. */
export function Timeline({ events, running, runId = null }: { events: RunEvent[]; running: boolean; runId?: string | null }) {
  const { t } = useI18n()
  const end = useRef<HTMLLIElement>(null)
  const [audit, setAudit] = useState(false)
  useEffect(() => { end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }) }, [events.length])
  return (
    <ol className="timeline" aria-live="polite">
      {audit && <AiInputDialog events={events} onClose={() => setAudit(false)} />}
      {events.map((e, i) => {
        switch (e.kind) {
          case 'crew_dispatched':
            return <CrewVisit key={i} runId={runId} events={events.filter((x) => x.visit === e.visit && CREW_KINDS.has(x.kind))} />
          case 'sealed':
            return (
              <li key={i} className="tl tl--seal"><span className="tl__icon">🔒</span><div>
                <b>{t('Topology sealed before the AI starts')}</b>
                <p>{t('seal.text')}</p>
                <code className="tl__hash">{String(e.commitment)}</code>
                <button className="btn-link" onClick={() => setAudit(true)}>{t('See what the AI receives')}</button>
              </div></li>
            )
          case 'meta_inference':
            return (
              <li key={i} className="tl tl--review"><span className="tl__icon tl__icon--wonder">W</span><div>
                <b>{t('Muse Wonder · topology inferred from the data')}</b>
                <p>{String(e.nodes_answered)} {t('nodes answered')} · {(e.uncertain as unknown[]).length} {t('flagged uncertain')} · {t('one vote in the ensemble')}</p>
                {e.rationale ? <Markdown text={String(e.rationale)} /> : null}
              </div></li>
            )
          case 'started':
            return <li key={i} className="tl tl--sys"><span className="tl__icon">▶</span><div><b>{t('Investigation started')}</b>
              <p>{String(e.nodes)} {t('secondary substations')} · {t('budget')} {String(e.budget)} {t('experiments')}</p></div></li>
          case 'message':
            return <li key={i} className="tl tl--msg"><span className="tl__icon tl__icon--spark">S</span><div><Markdown text={String(e.text)} /></div></li>
          case 'reasoning':
            return <li key={i} className="tl tl--think"><span className="tl__icon">…</span><div><p>{String(e.text)}</p></div></li>
          case 'tool_call': {
            const label = TOOL_LABEL[String(e.tool)]
            return label ? <li key={i} className="tl tl--tool"><span className="tl__icon">›</span><div><p>{t(label)}</p></div></li> : null
          }
          case 'experiment':
            return <Experiment key={i} e={e} />
          case 'hypothesis':
            return (
              <li key={i} className="tl tl--hyp"><span className="tl__icon">💡</span><div>
                <b>{t('Hypothesis')}</b><Markdown text={String(e.statement)} />
                <span className="tl__conf"><i style={{ width: `${Math.round(Number(e.confidence) * 100)}%` }} /></span>
                <small>{t('Confidence')} {Math.round(Number(e.confidence) * 100)}%</small>
              </div></li>
            )
          case 'review_started':
            return <li key={i} className="tl tl--sys"><span className="tl__icon tl__icon--wonder">W</span><div><p>{t('Muse Wonder is reviewing the evidence')} ({String(e.trigger)})…</p></div></li>
          case 'review':
            return <li key={i} className="tl tl--review"><span className="tl__icon tl__icon--wonder">W</span><div>
              <b>{t('Muse Wonder · second opinion')}</b><Markdown text={String(e.advice)} /></div></li>
          case 'result':
            return <li key={i} className="tl tl--result"><span className="tl__icon">✓</span><div>
              <b>{t('Result submitted')}</b><Markdown text={String(e.summary)} /></div></li>
          case 'resumed':
          case 'stopped':
          case 'recovered':
            return <li key={i} className="tl tl--sys"><span className="tl__icon">↻</span><div><p>{String(e.message)}</p></div></li>
          case 'intervention': {
            const sws = (e.switches ?? []) as { id: number; kind: string; closed: boolean; between: string[] }[]
            const off = (e.meters_off ?? []) as string[]
            return (
              <li key={i} className="tl tl--intervention"><span className="tl__icon">⚡</span><div>
                <b>{t('You changed the real network')}</b>
                <ul>
                  {sws.map((w) => <li key={w.id}>SW-{w.id} ({t(w.kind)}, {w.between.join(' – ')}): {t('now')} <b>{t(w.closed ? 'closed' : 'open')}</b></li>)}
                  {off.length > 0 && <li>{t('Meters offline')}: {off.join(', ')}</li>}
                </ul>
                <p className="muted">{t('intervention.note')}</p>
                {e.commitment ? <code className="tl__hash">{String(e.commitment)}</code> : null}
              </div></li>
            )
          }
          case 'change_detected': {
            const shifts = Object.entries((e.largest_shifts_pu ?? {}) as Record<string, number>).slice(0, 5)
            const off = (e.meters_offline ?? []) as string[]
            return (
              <li key={i} className="tl tl--detected"><span className="tl__icon">👁</span><div>
                <b>{t('The AI noticed a change in the field')}</b>
                <p>{t('detected.note')}</p>
                {shifts.length > 0 && <p className="muted">{t('Largest voltage shifts')}: {shifts.map(([n, v]) => `${n} ${v > 0 ? '+' : ''}${(v * 1000).toFixed(1)} mpu`).join(' · ')}</p>}
                {off.length > 0 && <p className="muted">{t('Meters gone silent')}: {off.join(', ')}</p>}
                <small className="muted">{String(e.experiments_set_aside ?? 0)} {t('earlier experiments set aside')}</small>
              </div></li>
            )
          }
          case 'error':
            return <li key={i} className="tl tl--error"><span className="tl__icon">!</span><div><p>{String(e.message)}</p></div></li>
          default:
            return null
        }
      })}
      {running && <li className="tl tl--sys tl--pulse"><span className="tl__icon">●</span><div><p>{t('Muse Spark is thinking…')}</p></div></li>}
      <li ref={end} aria-hidden="true" />
    </ol>
  )
}
