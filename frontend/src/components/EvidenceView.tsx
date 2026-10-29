import { useEffect, useState } from 'react'
import { money, pct } from '../money'
import { useI18n } from '../i18n'

interface Score { f1: number; experiments: number; correct_edges: number; total_edges: number; wrong_edges: number; wrong_and_flagged: number }
interface SummaryRow { level: string; runs: number; budget_by_level: number; correct: number; total: number; accuracy: number; f1: number; experiments: number; wrong: number; flagged: number; calibration: number; cost_usd?: number; seconds?: number; reviews?: number }
interface BenchRow { level: string; seed: number; budget: number; reviews: number; seconds: number; tokens: number; gridxray: Score | null; meta_inference?: boolean }
interface Evidence {
  benchmark: { rows: BenchRow[]; summary: SummaryRow[] }
  ablation: { with_wonder: SummaryRow[]; spark_only: SummaryRow[] } | null
  tests: { total: number; passed: number; failed: number; seconds: number; tests: { name: string; area: string; outcome: string }[] } | null
  guarantees: { claim: string; how: string; tests: string[] }[]
  scoring: { metric: string; methods: Record<string, string>; calibration: string }
  live_f1: { source: string; runs: number; mean_f1: number }[]
}

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
                  <b>{t(row.level[0].toUpperCase() + row.level.slice(1))} · {row.runs} {t('runs')} · {t('budget')} {row.budget_by_level}</b>
                  <div className="bench-bar">
                    <span className="bench-bar__label">{t('Real connections recovered')}</span>
                    <span className="bench-bar__track"><i style={{ width: `${row.accuracy * 100}%`, background: '#0e6e8c' }} /></span>
                    <span className="bench-bar__val">{row.correct}/{row.total} <small>· {Math.round(row.accuracy * 100)}%</small></span>
                  </div>
                  <div className="bench-bar">
                    <span className="bench-bar__label">{t('Wrong, flagged as uncertain')}</span>
                    <span className="bench-bar__track"><i style={{ width: `${row.calibration * 100}%`, background: '#e9a23b' }} /></span>
                    <span className="bench-bar__val">{row.flagged}/{row.wrong} <small>· {Math.round(row.calibration * 100)}%</small></span>
                  </div>
                  <small className="muted">F1 {pct(row.f1)} · {row.experiments} {t('exp.')}</small>
                </div>
              ))}
              <details>
                <summary>{t('Every run')}</summary>
                <table className="usage-table">
                  <thead><tr><th>{t('Level')}</th><th>{t('Seed')}</th><th>{t('Correct')}</th><th>F1</th><th>{t('Wrong')}</th><th>{t('Flagged')}</th><th>{t('Reviews')}</th><th>{t('Time')}</th></tr></thead>
                  <tbody>
                    {ev.benchmark.rows.map((r, i) => {
                      const g = r.gridxray
                      return (
                        <tr key={i}><td>{r.level}</td><td>{r.seed}</td>
                          <td>{g ? `${g.correct_edges}/${g.total_edges}` : '—'}</td><td>{g ? pct(g.f1) : '—'}</td>
                          <td>{g?.wrong_edges ?? '—'}</td><td>{g ? `${g.wrong_and_flagged}/${g.wrong_edges}` : '—'}</td>
                          <td>{r.reviews}</td><td>{Math.round(r.seconds)} s</td></tr>
                      )
                    })}
                  </tbody>
                </table>
              </details>
              <p className="explain">{t('bench.honest')}</p>
            </div>

            {ev.ablation && (
              <div className="evidence__block evidence__block--wide">
                <h3>{t('Ablation: Muse Spark alone vs Muse Spark + Muse Wonder')}</h3>
                <p className="muted">{t('ablation.intro')}</p>
                {ev.ablation.with_wonder.map((w) => {
                  const s1 = ev.ablation!.spark_only.find((x) => x.level === w.level)
                  if (!s1) return null
                  const arms: [string, SummaryRow, string][] = [[t('Spark alone'), s1, '#8f99a4'], [t('Spark + Wonder'), w, '#0e6e8c']]
                  return (
                    <div key={w.level} className="bench-level">
                      <b>{t(w.level[0].toUpperCase() + w.level.slice(1))} · {w.runs} {t('runs')} {t('each')} · {t('budget')} {w.budget_by_level}</b>
                      {arms.map(([label, row, color]) => (
                        <div key={label} className="bench-bar">
                          <span className="bench-bar__label">{label}</span>
                          <span className="bench-bar__track"><i style={{ width: `${row.accuracy * 100}%`, background: color }} /></span>
                          <span className="bench-bar__val">{row.correct}/{row.total} <small>· {Math.round(row.accuracy * 100)}% · F1 {pct(row.f1)}</small></span>
                        </div>
                      ))}
                      <small className="muted">
                        {t('Wrong, flagged as uncertain')}: {s1.flagged}/{s1.wrong} → {w.flagged}/{w.wrong} ·{' '}
                        {t('cost per run')}: {money(s1.cost_usd ?? 0)} → {money(w.cost_usd ?? 0)} ·{' '}
                        {t('time')}: {s1.seconds ?? 0} s → {w.seconds ?? 0} s · {t('Wonder reviews')}: {w.reviews ?? 0}
                      </small>
                    </div>
                  )
                })}
              </div>
            )}

            <div className="evidence__block">
              <h3>{t('How results are scored')}</h3>
              <p>{t(ev.scoring.metric)}</p>
              <dl className="evidence__dl">
                {Object.entries(ev.scoring.methods).map(([k, v]) => <div key={k}><dt>{t(k)}</dt><dd>{t(v)}</dd></div>)}
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
                  {ev.live_f1.map((l) => <div key={l.source} className="stat"><b>{pct(l.mean_f1)}</b><span>{l.source.startsWith('custom:') ? t('Designed network') : l.source} · {l.runs} {t('runs')} · F1</span></div>)}
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
