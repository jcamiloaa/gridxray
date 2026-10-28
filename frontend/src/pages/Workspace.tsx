import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createScenario, getActiveInvestigation, getTruth, sourceOf, type ObservableScenario, type RunSummary, type ScenarioSource, type Truth, type User } from '../api/client'
import { Brand } from '../components/Brand'
import { Icon } from '../components/Icon'
import { Info } from '../components/Info'
import { EvidenceView } from '../components/EvidenceView'
import { RunProgress } from '../components/RunProgress'
import { RunsDrawer } from '../components/RunsDrawer'
import { Timeline } from '../components/Timeline'
import { UsageDrawer } from '../components/UsageDrawer'
import { LanguageToggle, useI18n } from '../i18n'
import { SceneView } from '../scene/SceneView'
import { fromObservable, fromTruth } from '../scene/model'
import { voltageColor, voltageLabel } from '../scene/palette'
import { useInvestigation } from './useInvestigation'

interface SourceOption { key: string; source: ScenarioSource; title: string; text: string }

const SYNTHETIC: SourceOption[] = [
  { key: 'easy', source: { complexity: 'easy' }, title: 'Easy', text: '15 substations · 1 feeder · every point metered' },
  { key: 'medium', source: { complexity: 'medium' }, title: 'Medium', text: '30 substations · 2 feeders + tie · some readings missing' },
  { key: 'hard', source: { complexity: 'hard' }, title: 'Hard', text: '60 substations · 4 feeders · faulty meter · outdated records' },
]
const BENCHMARKS: SourceOption[] = [
  { key: 'cigre', source: { reference: 'cigre_mv' }, title: 'CIGRE MV benchmark', text: 'International reference network · 12 substations' },
]

export function Workspace({ user, onSignOut, onHome }: { user: User; onSignOut: () => void; onHome: () => void }) {
  const [choice, setChoice] = useState<SourceOption>(SYNTHETIC[1])
  const [seed, setSeed] = useState(0)
  const [scenario, setScenario] = useState<ObservableScenario | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [labels, setLabels] = useState(true)
  const [guide, setGuide] = useState(false)
  const [truth, setTruth] = useState<Truth | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [generated, setGenerated] = useState<{ source: ScenarioSource; seed: number } | null>(null)
  const [drawer, setDrawer] = useState<'runs' | 'usage' | 'evidence' | null>(null)
  // the investigation log can be resized by dragging its left edge; the width is remembered
  const [logWidth, setLogWidth] = useState(() => {
    try { return Number(localStorage.getItem('gridxray.logWidth')) || 380 } catch { return 380 }
  })
  const startResize = (e: ReactPointerEvent) => {
    e.preventDefault()
    const x0 = e.clientX
    const w0 = logWidth
    const move = (ev: PointerEvent) => setLogWidth(Math.min(820, Math.max(300, w0 + (x0 - ev.clientX))))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setLogWidth((w) => { try { localStorage.setItem('gridxray.logWidth', String(w)) } catch { /* convenience only */ } return w })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const { t, lang } = useI18n()

  const run = useInvestigation(scenario, generated)
  const [budget, setBudget] = useState(10)

  // open an investigation (live or finished): load its network, then follow or replay its events
  const pendingAttach = useRef<string | null>(null)
  async function openRun(r: { id: string; source: string; seed: number; budget: number }) {
    const source = sourceOf(r.source)
    const match = [...SYNTHETIC, ...BENCHMARKS].find((o) => JSON.stringify(o.source) === JSON.stringify(source))
    if (match) setChoice(match)
    setSeed(r.seed)
    setBudget(r.budget)
    setSelected(null); setTruth(null); setRevealed(false)
    pendingAttach.current = r.id
    setScenario(await createScenario(source, r.seed))
    setGenerated({ source, seed: r.seed })
  }
  // reattach to an investigation already running in this session (page reload, second tab)
  useEffect(() => {
    getActiveInvestigation().then((active) => { if (active) openRun(active) }, () => {})
     
  }, [])
  useEffect(() => {
    if (scenario && pendingAttach.current) {
      run.attach(pendingAttach.current)
      pendingAttach.current = null
    }
  }, [scenario, run])

  const model = useMemo(() => {
    if (!scenario) return null
    return revealed && truth ? fromTruth(scenario, truth) : fromObservable(scenario)
  }, [scenario, revealed, truth])

  async function toggleReveal() {
    if (!revealed && !truth && generated) {
      try {
        setTruth((await getTruth(generated.source, generated.seed)).truth)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        return
      }
    }
    setRevealed((r) => !r)
  }

  async function generate() {
    setBusy(true)
    setError(null)
    setSelected(null)
    setTruth(null)
    setRevealed(false)
    try {
      setScenario(await createScenario(choice.source, seed))
      setGenerated({ source: choice.source, seed })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const stats = useMemo(() => {
    if (!scenario) return null
    const metered = scenario.nodes.filter((n) => n.metered)
    const missing = metered.filter((n) => scenario.readings[n.id]?.vm_pu == null).length
    return {
      nodes: scenario.nodes.length,
      metered: metered.length,
      missing,
      ties: scenario.switches.filter((s) => s.kind === 'tie').length,
      sectionalizers: scenario.switches.filter((s) => s.kind === 'sectionalizer').length,
    }
  }, [scenario])

  const node = scenario?.nodes.find((n) => n.id === selected)
  const reading = node ? scenario?.readings[node.id] : undefined

  return (
    <div className="workspace">
      <header className="topbar">
        <button className="btn-ghost" onClick={onHome} aria-label="GridXray home" style={{ padding: 4 }}><Brand /></button>
        <nav className="stepper" aria-label="Progress">
          <ol>
            <li className={scenario ? 'done' : 'current'}><span className="dot">{scenario ? '✓' : 1}</span>{t('Build a grid')}</li>
            <li className={run.status === 'done' ? 'done' : scenario ? 'current' : ''}><span className="dot">{run.status === 'done' ? '✓' : 2}</span>{t('Investigate')}</li>
            <li className={run.compared ? 'done' : run.status === 'done' ? 'current' : ''}><span className="dot">{run.compared ? '✓' : 3}</span>{t('Reveal & compare')}</li>
          </ol>
        </nav>
        <div className="topbar__actions">
          <LanguageToggle />
          <a className="btn-ghost evidence-link" href="/evidence">{t('Evidence')}</a>
          <button className="btn-ghost" onClick={() => setDrawer('runs')}>{t('Runs')}</button>
          <button className="btn-ghost" onClick={() => setDrawer('usage')}>{t('Usage & settings')}</button>
          <button className="btn-ghost" onClick={() => setGuide(true)}>{t('Guide')}</button>
          <span className="muted" style={{ fontSize: '.9rem' }}>{user.name}{user.is_demo && ' · demo'}</span>
          <button onClick={onSignOut}>{t('Sign out')}</button>
        </div>
      </header>

      <div className="ws-body">
        <aside className="ws-panel">
          <div className="ws-section">
            <h2>{t('1 · Build a grid')}<Info>{t('build.info')}</Info></h2>
            <span className="group-label">{t('Synthetic networks')}</span>
            <div className="source-grid">
              {SYNTHETIC.map((o) => (
                <button key={o.key} className="source-option" aria-pressed={choice.key === o.key} onClick={() => setChoice(o)}>
                  <b>{t(o.title)}</b><span>{t(o.text)}</span>
                </button>
              ))}
            </div>
            <span className="group-label">{t('Published benchmarks')}</span>
            <div className="source-grid">
              {BENCHMARKS.map((o) => (
                <button key={o.key} className="source-option" aria-pressed={choice.key === o.key} onClick={() => setChoice(o)}>
                  <b>{t(o.title)}</b><span>{t(o.text)}</span>
                </button>
              ))}
            </div>
            <label className="row" style={{ fontSize: '.88rem', justifyContent: 'space-between' }}>
              <span className="row" style={{ gap: 6 }}>{t('Scenario seed')}<Info>{t('seed.info')}</Info></span>
              <input type="number" value={seed} min={0} onChange={(e) => setSeed(Number(e.target.value))} style={{ width: 100 }} />
            </label>
            <button className="btn-primary btn-lg" onClick={generate} disabled={busy}>
              {busy ? t('Solving power flow…') : scenario ? t('Generate a new grid') : t('Generate grid')}
            </button>
            {error && <p className="error" role="alert">{error}</p>}
          </div>

          {stats && scenario && (
            <div className="ws-section">
              <h2>{t('What the AI knows')}<Info>{t('knows.info')}</Info></h2>
              <div className="stats">
                <div className="stat"><b>{stats.nodes}</b><span>{t('Secondary substations')}</span></div>
                <div className="stat"><b>{stats.metered}</b><span>{t('Smart meters')}</span></div>
                <div className="stat"><b>{stats.missing}</b>
                  <span>{t('Missing readings')} <Info>{t('missing.info')}</Info></span></div>
                <div className="stat"><b>{stats.ties + stats.sectionalizers}</b>
                  <span>{t('Switches')} <Info>{stats.ties} tie switches (normally open links between feeders) and {stats.sectionalizers} sectionalizers. Their documented state may be wrong.</Info></span></div>
              </div>
            </div>
          )}

          {scenario && (
            <div className="ws-section">
              <h2>{t('Preview the real network')}<Info>{t('reveal.info')}</Info></h2>
              <button className={revealed ? 'btn-primary' : ''} onClick={toggleReveal} aria-pressed={revealed}>
                {revealed ? t('Hide true network') : t('Reveal true network (spoiler)')}
              </button>
            </div>
          )}

          <div className="ws-section">
            <h2>{t('2 · Investigate')}<Info>{t('investigate.info')}</Info></h2>
            {!scenario ? (
              <div className="locked">{t('Build a grid first.')}</div>
            ) : (
              <>
                <label className="row" style={{ fontSize: '.88rem', justifyContent: 'space-between' }}>
                  <span className="row" style={{ gap: 6 }}>{t('Experiment budget')}<Info>{t('budget.info')}</Info></span>
                  <select value={budget} onChange={(e) => setBudget(Number(e.target.value))} disabled={run.status === 'running'}>
                    {[5, 8, 10, 15, 20, 30].map((b) => <option key={b} value={b}>{b} {t('experiments')}</option>)}
                  </select>
                </label>
                <button className="btn-primary btn-lg" onClick={() => run.start(budget, lang)} disabled={run.status === 'running'}>
                  {run.status === 'running' ? t('Investigating…') : run.status === 'idle' ? t('Start investigation') : t('Run again')}
                </button>
                {run.status === 'running' && <button onClick={run.stop}>{t('Stop')}</button>}
                {run.status === 'failed' && run.runId && <button onClick={run.resume}>{t('Resume')}</button>}
                {run.status === 'running' && (
                  <div className="run-progress">
                    <span>{t('Experiments')} {run.experimentsUsed}/{run.budget || budget}</span>
                    <span className="run-progress__bar"><i style={{ width: `${(100 * run.experimentsUsed) / (run.budget || budget)}%` }} /></span>
                  </div>
                )}
                {run.error && <p className="error">{run.error}</p>}
                {run.score?.gridxray && (
                  <div className="score-card">
                    <b>{t('Verified result')}</b>
                    <table>
                      <thead><tr><th>{t('Against the real network')}</th><th>{t('Correct')}</th><th>F1</th><th>{t('Exp.')}</th></tr></thead>
                      <tbody>
                        <tr className="score-card__us"><td>GridXray</td><td>{run.score.gridxray.correct_edges}/{run.score.gridxray.total_edges}</td>
                          <td>{run.score.gridxray.f1.toFixed(2)}</td><td>{run.score.gridxray.experiments}</td></tr>
                      </tbody>
                    </table>
                    <small className="muted">{t('Scored against the real network by an independent checker with no AI involved.')} {run.score.gridxray.wrong_edges} {t('wrong')}
                      ({run.score.gridxray.wrong_and_flagged} {t('flagged as uncertain')}) · {run.score.steps} {t('steps')} · {run.score.reviews} {t('Wonder reviews')} · {Math.round(run.score.seconds ?? 0)} s
                      {run.score.usage ? ` · ${Math.round(run.score.usage.tokens / 1000)}k tokens · $${run.score.usage.cost_usd.toFixed(3)}` : ''}</small>
                    {run.runId && <a className="btn-link" href={`/api/investigations/${run.runId}/report?lang=${lang}`} target="_blank" rel="noreferrer">{t('Download report')}</a>}
                    <button onClick={() => setDrawer('evidence')} className="btn-ghost">{t('Evidence')}</button>
                    <button onClick={run.compare} disabled={run.compared}>{run.compared ? t('Compared with the real network') : t('Reveal & compare')}</button>
                  </div>
                )}
              </>
            )}
          </div>
        </aside>

        <section className="ws-stage" aria-label="3D network view">
          {model ? (
            <>
              <SceneView model={model} selected={selected} onSelect={setSelected} showLabels={labels} flow citySeed={scenario?.seed ?? 0}
                overlay={run.overlay}>
              {run.events.length > 0 && (
                <div className="ws-overlay ws-timeline card" aria-label={t('Investigation log')} style={{ width: logWidth }}>
                  <div className="ws-timeline__resize" onPointerDown={startResize} role="separator" aria-orientation="vertical"
                    aria-label={t('Drag to resize')} title={t('Drag to resize')} />
                  <div className="ws-timeline__head">
                    <b>{t('Investigation log')}</b>
                    <span className={`pill run-pill run-pill--${run.status}`}>{t(run.status)}</span>
                  </div>
                  {run.score?.gridxray && (
                    <div className="run-result">
                      <div className="run-result__head">
                        <span className="run-result__f1">{run.score.gridxray.f1.toFixed(2)}</span>
                        <span><b>{run.score.gridxray.correct_edges}/{run.score.gridxray.total_edges}</b> {t('real connections recovered')} · F1
                          <br /><small className="muted">{run.score.gridxray.experiments} {t('experiments')} · {run.score.gridxray.wrong_edges} {t('wrong')}, {
                            run.score.gridxray.wrong_and_flagged} {t('flagged as uncertain')}</small></span>
                      </div>
                      <div className="row" style={{ flexWrap: 'wrap' }}>
                        <button className="btn-primary" onClick={run.compare} disabled={run.compared}>{run.compared ? t('Compared with the real network') : t('Compare with the real network')}</button>
                        {run.runId && <a className="btn-link" href={`/api/investigations/${run.runId}/report?lang=${lang}`} target="_blank" rel="noreferrer">{t('Report')}</a>}
                      </div>
                      {run.seal && (
                        <div className={`seal-check seal-check--${run.seal.state}`}>
                          {run.seal.state === 'checking' ? t('Checking the seal…')
                            : run.seal.state === 'unavailable' ? `${t('Seal not checked')}: ${t(run.seal.reason)}`
                              : (
                                <>
                                  <b>{run.seal.state === 'ok' ? `✓ ${t('Seal verified in your browser')}` : `✗ ${t('Seal does not match')}`}</b>
                                  <small>{t('seal.verify')}</small>
                                  <code>{t('published')} {run.seal.commitment.slice(0, 16)}… · {t('recomputed')} {run.seal.recomputed.slice(0, 16)}…</code>
                                  {!run.seal.edgesMatch && <small>{t('The sealed topology differs from the revealed one.')}</small>}
                                </>
                              )}
                        </div>
                      )}
                      {run.comparison && (
                        <div className="compare">
                          <div className="compare__stats">
                            <span className="compare__ok">✓ {run.comparison.correct} {t('correct')}</span>
                            <span className="compare__bad">✗ {run.comparison.wrong.length} {t('wrong')}</span>
                            <button className={revealed ? 'btn-primary' : ''} onClick={toggleReveal}>{revealed ? t('Hide true network') : t('Show the real network')}</button>
                          </div>
                          <table className="compare__table">
                            <thead><tr><th>{t('Node')}</th><th>{t('AI said')}</th><th>{t('Real')}</th></tr></thead>
                            <tbody>
                              {run.comparison.rows.map((r) => (
                                <tr key={r.node} className={r.ok ? 'is-ok' : 'is-bad'}>
                                  <td>{r.node}</td><td>{r.ai}{r.flagged ? ' ?' : ''}</td><td>{r.ok ? '✓' : r.real}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          <small className="muted">{t('compare.note')}</small>
                        </div>
                      )}
                    </div>
                  )}
                  <RunProgress events={run.events} total={scenario?.nodes.length ?? 0} />
                  {run.overlay && (
                    <div className="ws-timeline__legend">
                      {run.compared ? (
                        <><span><i style={{ background: '#17a673' }} />{t('correct')}</span><span><i style={{ background: '#d64545' }} />{t('wrong')}</span>
                          <span><i style={{ background: '#8f99a4' }} />{t('missed')}</span></>
                      ) : (
                        <><span><i style={{ background: '#0e6e8c' }} />{t('confirmed by experiments')}</span><span><i style={{ background: '#e9a23b' }} />{t('inferred')}</span></>
                      )}
                    </div>
                  )}
                  <Timeline events={run.events} running={run.status === 'running'} />
                </div>
              )}
              <div className="ws-overlay ws-legend card">
                {revealed ? (
                  <span className="legend-note"><Icon name="eye" size={16} /><span><b>{t('True network revealed.')}</b> {t('reveal.note')}</span></span>
                ) : (
                  <span className="legend-note"><Icon name="eye" size={16} /><span><b>{t('Connections are hidden.')}</b> {t('hidden.note')}</span></span>
                )}
                {revealed && (
                  <>
                    <b>{t('Lines')}</b>
                    <span className="legend-row"><span className="legend-line" style={{ background: '#4a5561' }} />{t('Overhead line (on poles)')}</span>
                    <span className="legend-row"><span className="legend-line" style={{ background: '#6c4fa3' }} />{t('Underground cable')}</span>
                    <span className="legend-row"><span className="legend-line legend-line--dashed" />{t('Open point (tie / open switch)')}</span>
                  </>
                )}
                <b>{t('Meter readings')}</b>
                {[[0.99, '≥ 0.97 pu'], [0.94, '0.90–0.97 pu'], [0.85, '< 0.90 pu']].map(([v, range]) => (
                  <span key={v} className="legend-row"><span className="legend-swatch" style={{ background: voltageColor(v as number) }} />{t(voltageLabel(v as number))}
                    <span className="muted">{range}</span></span>
                ))}
                <span className="legend-row"><span className="legend-swatch" style={{ background: voltageColor(null) }} />{t('Missing reading')}</span>
                <span className="legend-row"><span className="legend-swatch" style={{ background: '#c3cad2', borderRadius: 3 }} />{t('No meter installed')}</span>
                <span className="muted" style={{ fontSize: '.78rem' }}>{t('kiosk.note')}</span>
              </div>
              <div className="ws-overlay ws-toolbar">
                <button onClick={() => setLabels((l) => !l)} aria-pressed={labels}>{labels ? t('Hide labels') : t('Show labels')}</button>
              </div>
              {node && (
                <div style={run.events.length ? { right: logWidth + 80 } : undefined} className={`ws-overlay ws-detail card`} role="dialog" aria-label={`${node.name} details`}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <h3>{node.name}</h3>
                    <button className="btn-ghost" onClick={() => setSelected(null)} aria-label="Close">✕</button>
                  </div>
                  <span className="muted" style={{ fontSize: '.85rem' }}>
                    {node.mount === 'pole' ? t('Pole-mounted transformer') : t('Ground-mounted kiosk')} · 20 kV → 400 V
                  </span>
                  {scenario?.devices.filter((d) => d.node === node.id).map((d) => (
                    <span key={d.id} className="pill" style={{ background: '#e4e9f7', color: '#1f3f8f' }}>
                      {d.kind === 'capacitor' ? `${t('Capacitor bank')} · ${d.rating.toFixed(0)} kvar` : `${t('Solar plant')} · ${(d.rating / 1000).toFixed(1)} MW`}
                    </span>
                  ))}
                  {node.metered ? (
                    <>
                      <span className="pill" style={{ background: `${voltageColor(reading?.vm_pu ?? null)}22`, color: voltageColor(reading?.vm_pu ?? null) }}>
                        <span className="legend-swatch" style={{ background: voltageColor(reading?.vm_pu ?? null), width: 8, height: 8 }} />
                        {t(voltageLabel(reading?.vm_pu ?? null))}
                      </span>
                      <dl className="kv">
                        <dt>{t('Voltage')}</dt><dd>{reading?.vm_pu != null ? `${reading.vm_pu.toFixed(4)} pu` : '—'}</dd>
                        <dt>{t('Active power')}</dt><dd>{reading?.p_kw != null ? `${reading.p_kw.toFixed(0)} kW` : '—'}</dd>
                        <dt>{t('Reactive power')}</dt><dd>{reading?.q_kvar != null ? `${reading.q_kvar.toFixed(0)} kvar` : '—'}</dd>
                        <dt>{t('Customer type')}</dt><dd style={{ textTransform: 'capitalize' }}>{node.load_profile ?? '—'}</dd>
                      </dl>
                      <p className="explain">
                        {reading?.vm_pu == null ? t('meter.missing') : t('meter.explain', { pct: (reading.vm_pu * 100).toFixed(1) })}
                      </p>
                    </>
                  ) : (
                    <p className="explain">{t('meter.none')}</p>
                  )}
                </div>
              )}
              </SceneView>
            </>
          ) : (
            <div className="ws-overlay ws-empty">
              <div className="card">
                <span className="icon-chip" style={{ margin: '0 auto' }}><Icon name="layers" /></span>
                <h2>{t('Start by building a grid')}</h2>
                <p className="muted">{t('empty.text')}</p>
              </div>
            </div>
          )}
        </section>
      </div>

      {drawer === 'runs' && <RunsDrawer onClose={() => setDrawer(null)} onOpen={(r: RunSummary) => { setDrawer(null); openRun(r) }} />}
      {drawer === 'usage' && <UsageDrawer onClose={() => setDrawer(null)} />}
      {drawer === 'evidence' && <EvidenceView onClose={() => setDrawer(null)} />}
      {guide && (
        <div className="dialog-backdrop" style={{ placeItems: 'stretch end', padding: 0 }} onClick={() => setGuide(false)}>
          <aside className="drawer" onClick={(e) => e.stopPropagation()} aria-label="Guide">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h2>{t('How to use the workspace')}</h2>
              <button className="btn-ghost" onClick={() => setGuide(false)} aria-label="Close">✕</button>
            </div>
            <ol className="guide-list">
              <li className="card"><div><b>Build a grid</b><p>Choose easy, medium or hard, or a benchmark network, then press Generate grid.</p></div></li>
              <li className="card"><div><b>Explore in 3D</b><p>Drag to rotate, scroll to zoom, right-drag to pan. Click a kiosk to read its meter.</p></div></li>
              <li className="card"><div><b>Read the colours</b><p>Green is normal voltage, amber is low but within the ±10 % limit, red is outside limits, grey means the reading is missing.</p></div></li>
              <li className="card"><div><b>Toggle the city</b><p>The building icon shows or hides the city map. Feeders follow the streets; each kiosk sits on the corner of the block it supplies.</p></div></li>
              <li className="card"><div><b>Investigate</b><p>Start an investigation: follow Spark's reasoning in the log, watch each experiment pulse on the map and the AI's tree grow (blue = confirmed, amber = inferred). Then Reveal & compare.</p></div></li>
            </ol>
            <p className="explain"><b>Where does the model stop?</b> At each secondary substation. GridXray models the
              20 kV medium-voltage network from the HV/MV substation to every kiosk. The low-voltage streets and homes
              behind a kiosk are represented by its total demand.</p>
            <p className="explain"><b>Why are there no cables?</b> Because the topology is hidden. Discovering it is the
              whole point: GridXray's AI will run experiments to find out which kiosk feeds which.</p>
          </aside>
        </div>
      )}
    </div>
  )
}
