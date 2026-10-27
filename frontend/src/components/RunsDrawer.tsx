import { useEffect, useState } from 'react'
import { listRuns, resumeRun, stopRun, type RunSummary } from '../api/client'
import { useI18n } from '../i18n'

const SOURCE_LABEL: Record<string, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard', cigre_mv: 'CIGRE MV', mv_oberrhein: 'MV Oberrhein' }

/** Every investigation of this session: open (live or replay), stop or resume. Refreshes while open. */
export function RunsDrawer({ onOpen, onClose }: { onOpen: (r: RunSummary) => void; onClose: () => void }) {
  const { t } = useI18n()
  const [runs, setRuns] = useState<RunSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const refresh = () => listRuns().then(setRuns, (e) => setError(String(e)))
  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 4000)
    return () => clearInterval(id)
  }, [])
  const act = async (fn: () => Promise<unknown>) => {
    try { await fn(); refresh() } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }
  return (
    <div className="dialog-backdrop" style={{ placeItems: 'stretch end', padding: 0 }} onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()} aria-label={t('Your investigations')}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>{t('Your investigations')}</h2>
          <button className="btn-ghost" onClick={onClose} aria-label={t('Close')}>✕</button>
        </div>
        <p className="explain">{t('runs.note')}</p>
        {error && <p className="error">{error}</p>}
        {runs && runs.length === 0 && <p className="muted">{t('runs.empty')}</p>}
        <ul className="runs-list">
          {runs?.map((r) => (
            <li key={r.id} className="card">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <b>{t(SOURCE_LABEL[r.source] ?? r.source)} · {t('Seed').toLowerCase()} {r.seed}</b>
                <span className={`pill run-pill run-pill--${r.status}`}>{t(r.status)}</span>
              </div>
              <div className="runs-list__meta">
                <span>{new Date(r.created_at).toLocaleString()}</span>
                <span>{t('Experiments')}: {r.experiments}/{r.budget}</span>
                {r.f1 !== null && <span>F1 <b>{r.f1.toFixed(2)}</b></span>}
                <span>{Math.round(r.tokens / 1000)}k tokens · ${r.cost_usd.toFixed(3)}</span>
              </div>
              <div className="row">
                <button onClick={() => onOpen(r)}>{t('Open')}</button>
                {r.status !== 'running' && <a className="btn-link" href={`/api/investigations/${r.id}/report`} target="_blank" rel="noreferrer">{t('Report')}</a>}
                {r.status === 'running' && <button onClick={() => act(() => stopRun(r.id))}>{t('Stop')}</button>}
                {(r.status === 'failed' || r.status === 'stopped') && (
                  <button className="btn-primary" onClick={() => act(async () => { await resumeRun(r.id); onOpen({ ...r, status: 'running' }) })}>{t('Resume')}</button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  )
}
