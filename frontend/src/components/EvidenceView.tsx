import { useEffect, useState } from 'react'
import { useI18n } from '../i18n'

interface Score { f1: number; experiments: number }
interface SummaryRow { level: string; runs: number; budget: number; calibration?: number; [method: string]: Score | number | string | undefined }
interface BenchRow { level: string; seed: number; budget: number; reviews: number; seconds: number; tokens: number; [m: string]: unknown }
interface Evidence {
  benchmark: { rows: BenchRow[]; summary: SummaryRow[] }
  tests: { total: number; passed: number; failed: number; seconds: number; tests: { name: string; area: string; outcome: string }[] } | null
  guarantees: { claim: string; how: string; tests: string[] }[]
  scoring: { metric: string; baselines: Record<string, string>; calibration: string }
  live_f1: { source: string; runs: number; mean_f1: number }[]
}

const METHODS = ['gridxray', 'heuristic', 'exhaustive', 'passive', 'geographic'] as const
const COLORS: Record<string, string> = { gridxray: '#0e6e8c', heuristic: '#e9a23b', exhaustive: '#6b7682', passive: '#a7b0ba', geographic: '#cfd6de' }
const LABEL: Record<string, string> = { gridxray: 'GridXray', heuristic: 'Same budget, no AI', exhaustive: 'Exhaustive', passive: 'Passive', geographic: 'Geographic' }

/** Everything a judge needs to trust the results: benchmark, tests, guarantees and the scoring method. */
export function EvidenceView({ onClose, page = false }: { onClose?: () => void; page?: boolean }) {
  const { t } = useI18n()
  const [ev, setEv] = useState<Evidence | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { fetch('/api/evidence').then((r) => r.json()).then(setEv, (e) => setErr(String(e))) }, [])
  const byName = new Map((ev?.tests?.tests ?? []).map((x) => [x.name.split('[')[0], x.outcome]))
  const areas = ev?.tests ? [...new Set(ev.tests.tests.map((x) => x.area))] : []

  return (
    <div className={page ? 'evidence-page' : 'dialog-backdrop'} onClick={onClose}>
      <section className={`evidence card${page ? ' evidence--page' : ''}`} role={page ? undefined : 'dialog'} aria-modal={page ? undefined : true}
        aria-label={t('Evidence')} onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div><span className="eyebrow">{t('For the judges')}</span><h2>{t('Evidence')}</h2></div>
          {onClose && !page && <button className="btn-ghost" onClick={onClose} aria-label={t('Close')}>✕</button>}
        </div>
        {err && <p className="error">{err}</p>}
        {!ev ? <p className="muted">…</p> : (
          <div className="evidence__grid">
            <div className="evidence__block evidence__block--wide">
              <h3>{t('Benchmark: real investigations with Muse Spark + Muse Wonder')}</h3>
              <p className="muted">{t('bench.intro')}</p>
              {ev.benchmark.summary.map((row) => (
                <div key={row.level} className="bench-level">
                  <b>{t(row.level[0].toUpperCase() + row.level.slice(1))} · {row.runs} {t('runs')} · {t('budget')} {row.budget}</b>
                  {METHODS.map((m) => {
                    const s = row[m] as Score | undefined
                    if (!s) return null
                    return (
                      <div key={m} className="bench-bar">
                        <span className="bench-bar__label">{t(LABEL[m])}</span>
                        <span className="bench-bar__track"><i style={{ width: `${s.f1 * 100}%`, background: COLORS[m] }} /></span>
                        <span className="bench-bar__val">{s.f1.toFixed(2)} <small>· {s.experiments} {t('exp.')}</small></span>
                      </div>
                    )
                  })}
                  {row.calibration !== undefined && <small className="muted">{t('Calibration')}: {Math.round(Number(row.calibration) * 100)}% {t('of wrong connections flagged as uncertain')}</small>}
                </div>
              ))}
              <details>
                <summary>{t('Every run')}</summary>
                <table className="usage-table">
                  <thead><tr><th>{t('Level')}</th><th>{t('Seed')}</th>{METHODS.map((m) => <th key={m}>{t(LABEL[m])}</th>)}<th>{t('Reviews')}</th><th>{t('Time')}</th></tr></thead>
                  <tbody>
                    {ev.benchmark.rows.map((r, i) => (
                      <tr key={i}><td>{r.level}</td><td>{r.seed}</td>
                        {METHODS.map((m) => { const s = r[m] as Score | null | undefined; return <td key={m}>{s ? s.f1.toFixed(2) : '—'}</td> })}
                        <td>{r.reviews}</td><td>{Math.round(r.seconds)} s</td></tr>
                    ))}
                  </tbody>
                </table>
              </details>
              <p className="explain">{t('bench.honest')}</p>
            </div>

            <div className="evidence__block">
              <h3>{t('How results are scored')}</h3>
              <p>{t(ev.scoring.metric)}</p>
              <dl className="evidence__dl">
                {Object.entries(ev.scoring.baselines).map(([k, v]) => <div key={k}><dt>{t(LABEL[k] ?? k)}</dt><dd>{t(v)}</dd></div>)}
                <div><dt>{t('Calibration')}</dt><dd>{t(ev.scoring.calibration)}</dd></div>
              </dl>
            </div>

            <div className="evidence__block">
              <h3>{t('Guarantees, each backed by a test')}</h3>
              <ul className="evidence__claims">
                {ev.guarantees.map((g) => {
                  const ok = g.tests.every((n) => byName.get(n) === 'passed')
                  return (
                    <li key={g.claim}>
                      <span className={`evidence__check${ok ? '' : ' evidence__check--off'}`}>{ok ? '✓' : '?'}</span>
                      <div><b>{t(g.claim)}</b><p>{t(g.how)}</p><small>{g.tests.join(' · ')}</small></div>
                    </li>
                  )
                })}
              </ul>
            </div>

            <div className="evidence__block evidence__block--wide">
              <h3>{t('Automated tests')}</h3>
              {ev.tests ? (
                <>
                  <p><span className="evidence__big">{ev.tests.passed}/{ev.tests.total}</span> {t('passing')} · {ev.tests.seconds} s</p>
                  <div className="evidence__areas">
                    {areas.map((a) => {
                      const items = ev.tests!.tests.filter((x) => x.area === a)
                      return (
                        <details key={a}>
                          <summary>{t(a)} · {items.filter((x) => x.outcome === 'passed').length}/{items.length}</summary>
                          <ul>{items.map((x) => <li key={x.name} className={x.outcome}>{x.outcome === 'passed' ? '✓' : '✗'} {x.name.replace(/^test_/, '').replace(/_/g, ' ')}</li>)}</ul>
                        </details>
                      )
                    })}
                  </div>
                </>
              ) : <p className="muted">{t('No test results yet.')}</p>}
            </div>

            {ev.live_f1.length > 0 && (
              <div className="evidence__block evidence__block--wide">
                <h3>{t('Investigations run on this server')}</h3>
                <div className="stats" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
                  {ev.live_f1.map((l) => <div key={l.source} className="stat"><b>{l.mean_f1.toFixed(2)}</b><span>{l.source} · {l.runs} {t('runs')} · F1</span></div>)}
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
