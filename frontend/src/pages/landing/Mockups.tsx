// Product mockups for the landing page. Values are illustrative, not results of a real run.
import type { ReactNode } from 'react'
import { Icon } from '../../components/Icon'

/** A "scan plate": the product view framed like a radiograph, with registration corners. */
export function AppWindow({ path, title, badge, children, light = false }: {
  path: string; title: string; badge?: ReactNode; children: ReactNode; light?: boolean
}) {
  return (
    <div className="lx-window">
      <i className="lx-window__corner lx-window__corner--tl" /><i className="lx-window__corner lx-window__corner--tr" />
      <i className="lx-window__corner lx-window__corner--bl" /><i className="lx-window__corner lx-window__corner--br" />
      <div className="lx-window__head">
        <span className="lx-window__mark" aria-hidden="true"><Icon name="target" size={14} /></span>
        <span className="lx-window__path">gx/{path}</span>
        <span className="lx-window__title">{title}</span>
        {badge}
        <span className="lx-chip lx-chip--ghost">sim</span>
      </div>
      <div className={light ? 'lx-window__body lx-window__body--light' : 'lx-window__body'}>{children}</div>
    </div>
  )
}

export function Figure({ n, caption, children }: { n: string; caption: string; children: ReactNode }) {
  return (
    <figure className="lx-figure">
      {children}
      <figcaption><span className="lx-figure__n">Scan {n}</span><span>{caption}</span></figcaption>
    </figure>
  )
}

const Kpi = ({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'accent' | 'violet' }) => (
  <div className="lx-kpi">
    <span className="lx-kpi__label">{label}</span>
    <b className={tone ? `lx-kpi__value lx-kpi__value--${tone}` : 'lx-kpi__value'}>{value}</b>
    {sub && <span className="lx-kpi__sub">{sub}</span>}
  </div>
)

export function InvestigationMock() {
  const hyps = [
    { id: 'H1', text: 'K12 fed by F2 through S-7', p: 72, lead: true },
    { id: 'H2', text: 'K12 fed by F3, tie T-2 closed', p: 21 },
    { id: 'H3', text: 'K12 on F2, S-9 open', p: 7 },
  ]
  const feed = [
    { id: 'E-06', what: 'Raise load at K12 by 400 kW', res: 'ΔV at K11 −0.018 pu', tag: 'supports H1', ok: true },
    { id: 'E-05', what: 'Read K9 and K12 at 18:00 peak', res: 'K12 below K9 by 0.011 pu', tag: 'rules out H4', ok: true },
    { id: 'E-04', what: 'Open sectionalizer S-4 (1 step)', res: 'K3–K6 de-energised', tag: 'confirms F1 branch', ok: true },
  ]
  return (
    <AppWindow path="investigate" title="Run 014 · MV medium · seed 7"
      badge={<span className="lx-chip lx-chip--live"><i />live</span>}>
      <div className="lx-kpis">
        <Kpi label="Hypotheses" value="3" sub="open" />
        <Kpi label="Experiments" value="6" sub="of 12 budget" />
        <Kpi label="Links resolved" value="21/26" tone="accent" />
        <Kpi label="Confidence" value="84%" sub="current best" />
      </div>
      <div className="lx-split">
        <div className="lx-panel">
          <div className="lx-panel__head"><span>Hypotheses · K12</span><span className="lx-dim">posterior</span></div>
          {hyps.map((h) => (
            <div key={h.id} className="lx-hyp">
              <div className="lx-hyp__row">
                <span className={h.lead ? 'lx-tag lx-tag--accent' : 'lx-tag'}>{h.id}</span>
                <span className="lx-hyp__text">{h.text}</span>
                <b>{h.p}%</b>
              </div>
              <span className="lx-bar"><i style={{ width: `${h.p}%` }} className={h.lead ? 'is-lead' : ''} /></span>
            </div>
          ))}
        </div>
        <div className="lx-panel">
          <div className="lx-panel__head"><span>Experiment log</span><span className="lx-dim">Muse Spark</span></div>
          {feed.map((e) => (
            <div key={e.id} className="lx-feed">
              <span className="lx-feed__id">{e.id}</span>
              <div>
                <b>{e.what}</b>
                <span>{e.res} · <em>{e.tag}</em></span>
              </div>
              <span className="lx-feed__ok"><Icon name="check" size={14} /></span>
            </div>
          ))}
          <div className="lx-feed lx-feed--next">
            <span className="lx-feed__id">E-07</span>
            <div><b>Close tie T-2 for one step</b><span>designing next test…</span></div>
            <span className="lx-spinner" />
          </div>
        </div>
      </div>
    </AppWindow>
  )
}

function MiniTopo({ variant }: { variant: 'a' | 'b' }) {
  const k = [[40, 30], [100, 30], [160, 30], [100, 90], [160, 90], [220, 60]]
  const a = [[0, 1], [1, 2], [1, 3], [3, 4], [2, 5]]
  const b = [[0, 1], [1, 2], [1, 3], [3, 4], [4, 5]]
  const edges = variant === 'a' ? a : b
  const diff = variant === 'a' ? '2-5' : '4-5'
  return (
    <svg viewBox="0 0 250 120" className="lx-topo">
      <line x1={10} y1={30} x2={40} y2={30} stroke="#a78bfa" strokeWidth={2} />
      <rect x={2} y={22} width={14} height={16} rx={3} fill="#a78bfa" />
      {edges.map(([s, t]) => {
        const hot = `${s}-${t}` === diff
        return <line key={`${s}-${t}`} x1={k[s][0]} y1={k[s][1]} x2={k[t][0]} y2={k[t][1]}
          stroke={hot ? '#ff8a3d' : '#5c5852'} strokeWidth={hot ? 2.4 : 1.6} strokeDasharray={hot ? '5 4' : undefined} />
      })}
      {k.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={6} fill="#15151a" stroke={i === 5 ? '#ff8a3d' : '#8a857d'} strokeWidth={1.6} />)}
      <text x={222} y={84} className="lx-topo__label">K12</text>
    </svg>
  )
}

export function ReviewMock() {
  return (
    <AppWindow path="review" title="Second opinion"
      badge={<span className="lx-chip lx-chip--violet">Muse Wonder</span>}>
      <div className="lx-alert">
        <Icon name="alert" size={16} />
        <div><b>Two topologies still fit the data</b><span>Residuals within meter noise after 6 experiments.</span></div>
      </div>
      <div className="lx-split">
        <div className="lx-panel lx-panel--tight">
          <div className="lx-panel__head"><span>Candidate A</span><span className="lx-dim">residual 0.004 pu</span></div>
          <MiniTopo variant="a" />
        </div>
        <div className="lx-panel lx-panel--tight">
          <div className="lx-panel__head"><span>Candidate B</span><span className="lx-dim">residual 0.005 pu</span></div>
          <MiniTopo variant="b" />
        </div>
      </div>
      <div className="lx-panel">
        <div className="lx-panel__head"><span>Proposed line of inquiry</span><span className="lx-tag lx-tag--violet">new</span></div>
        <p className="lx-quote">
          “Both candidates assume S-9 matches its record. Close tie T-2 for one step and read K9 and K12: A predicts
          ΔV ≈ +0.031 pu at K12, B predicts ≈ 0. One experiment settles it.”
        </p>
        <div className="lx-actions">
          <span className="lx-btn-sm lx-btn-sm--primary"><Icon name="play" size={12} />Run experiment</span>
          <span className="lx-btn-sm">Return to Spark</span>
        </div>
      </div>
    </AppWindow>
  )
}

export function VerifyMock() {
  const rows = [
    { label: 'Links recovered', found: 25, real: 26 },
    { label: 'Switch states correct', found: 4, real: 4 },
    { label: 'Errors flagged uncertain', found: 1, real: 1 },
  ]
  return (
    <AppWindow path="verify" title="Scorecard · Run 014"
      badge={<span className="lx-chip lx-chip--ok"><Icon name="check" size={11} />verified</span>}>
      <div className="lx-kpis">
        <Kpi label="Topology accuracy" value="96%" sub="25 of 26 links" tone="accent" />
        <Kpi label="Uncertain" value="1" sub="flagged, not guessed" />
        <Kpi label="Experiments" value="7" sub="of 8 budget" />
        <Kpi label="Records wrong" value="1" sub="T-2 found closed" tone="violet" />
      </div>
      <div className="lx-panel">
        <div className="lx-panel__head">
          <span>Found vs the real network</span>
          <span className="lx-legend"><i className="is-ai" />GridXray <i />Real network</span>
        </div>
        {rows.map((r) => (
          <div key={r.label} className="lx-cmp">
            <span>{r.label}</span>
            <div className="lx-cmp__bars">
              <span className="lx-bar"><i className="is-lead" style={{ width: `${(100 * r.found) / r.real}%` }} /></span>
              <span className="lx-bar"><i style={{ width: '100%' }} /></span>
            </div>
            <b>{r.found}/{r.real}</b>
          </div>
        ))}
      </div>
      <div className="lx-checks">
        <span><Icon name="check" size={13} />Ground truth sealed</span>
        <span><Icon name="check" size={13} />No LLM in verifier</span>
        <span><Icon name="check" size={13} />Seed reproducible</span>
      </div>
    </AppWindow>
  )
}
