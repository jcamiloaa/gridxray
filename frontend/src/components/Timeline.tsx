import { useEffect, useRef } from 'react'
import type { RunEvent } from '../api/client'
import { useI18n } from '../i18n'

const TOOL_LABEL: Record<string, string> = {
  get_overview: 'Reads what the utility knows',
  get_evidence: 'Reviews the evidence so far',
  infer_tree: 'Builds a candidate topology',
  check_hypothesis: 'Checks a hypothesis against the physics',
  compare_hypotheses: 'Looks for the experiment that separates two hypotheses',
  request_review: 'Asks Muse Wonder for a second opinion',
  suggest_experiments: 'Ranks the most informative next experiments',
}

function Experiment({ e }: { e: RunEvent }) {
  const { t } = useI18n()
  const args = e.args as { kind: string; node?: string; delta_kw?: number; switch_id?: number; repeats?: number }
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
          <p>{drops.length ? `${t('Strongest response')}: ${drops.map(([n, v]) => `${n} ${(v * 1000).toFixed(2)}`).join(', ')} mpu/MW` : String(e.message)}</p>
        ) : <p>{String(e.message)}</p>}
        <small>{t('Budget left')}: {String(e.budget_remaining)}</small>
      </div>
    </li>
  )
}

/** Live log of the investigation: Spark's reasoning, experiments, hypotheses and Wonder's reviews. */
export function Timeline({ events, running }: { events: RunEvent[]; running: boolean }) {
  const { t } = useI18n()
  const end = useRef<HTMLLIElement>(null)
  useEffect(() => { end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }) }, [events.length])
  return (
    <ol className="timeline" aria-live="polite">
      {events.map((e, i) => {
        switch (e.kind) {
          case 'started':
            return <li key={i} className="tl tl--sys"><span className="tl__icon">▶</span><div><b>{t('Investigation started')}</b>
              <p>{String(e.nodes)} {t('secondary substations')} · {t('budget')} {String(e.budget)} {t('experiments')}</p></div></li>
          case 'message':
            return <li key={i} className="tl tl--msg"><span className="tl__icon tl__icon--spark">S</span><div><p>{String(e.text)}</p></div></li>
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
                <b>{t('Hypothesis')}</b><p>{String(e.statement)}</p>
                <span className="tl__conf"><i style={{ width: `${Math.round(Number(e.confidence) * 100)}%` }} /></span>
                <small>{t('Confidence')} {Math.round(Number(e.confidence) * 100)}%</small>
              </div></li>
            )
          case 'review_started':
            return <li key={i} className="tl tl--sys"><span className="tl__icon tl__icon--wonder">W</span><div><p>{t('Muse Wonder is reviewing the evidence')} ({String(e.trigger)})…</p></div></li>
          case 'review':
            return <li key={i} className="tl tl--review"><span className="tl__icon tl__icon--wonder">W</span><div>
              <b>{t('Muse Wonder · second opinion')}</b><p className="tl__pre">{String(e.advice)}</p></div></li>
          case 'result':
            return <li key={i} className="tl tl--result"><span className="tl__icon">✓</span><div>
              <b>{t('Result submitted')}</b><p>{String(e.summary)}</p></div></li>
          case 'resumed':
          case 'stopped':
          case 'recovered':
            return <li key={i} className="tl tl--sys"><span className="tl__icon">↻</span><div><p>{String(e.message)}</p></div></li>
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
