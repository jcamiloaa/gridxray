import { useMemo, useState } from 'react'
import type { RunEvent } from '../api/client'
import { useI18n } from '../i18n'
import { Icon } from './Icon'
import { ICON_PATHS } from './iconPaths'
import { TOOL_LABEL } from './toolLabels'

/** Who acts in the control room. */
type Actor = 'you' | 'spark' | 'wonder' | 'field' | 'grid' | 'checker'

interface Step {
  id: number
  actor: Actor
  to?: Actor // where the signal goes
  icon: string // line icon name (iconPaths)
  text: string // what the actor says or does, in plain words
  logic?: string // one line of the investigation's logic
}

const DESKS: Record<Actor, { x: number; label: string; sub: string; color: string; glyph: string }> = {
  you: { x: 50, label: 'You', sub: 'operator', color: '#5d6b7a', glyph: 'user' },
  spark: { x: 150, label: 'Muse Spark', sub: 'lead investigator', color: '#0e6e8c', glyph: 'S' },
  wonder: { x: 250, label: 'Muse Wonder', sub: 'second opinion', color: '#7c4ddb', glyph: 'W' },
  field: { x: 350, label: 'Field crew', sub: 'Image · SAM 3.1', color: '#f26b1d', glyph: 'truck' },
  grid: { x: 450, label: 'The network', sub: 'pandapower', color: '#1f6fb2', glyph: 'bolt' },
  checker: { x: 550, label: 'Checker', sub: 'no AI', color: '#17a673', glyph: 'check' },
}
const W = 600
const DESK_Y = 62

const clip = (s: string, n = 150) => (s.length > n ? `${s.slice(0, n).replace(/\s+\S*$/, '')}…` : s)

/** Turns the investigation's events into what each agent says and does. */
function useSteps(events: RunEvent[]): Step[] {
  const { t } = useI18n()
  return useMemo(() => {
    const steps: Step[] = []
    const add = (s: Omit<Step, 'id'>) => steps.push({ ...s, id: steps.length })
    for (const e of events) {
      switch (e.kind) {
        case 'started':
          add({ actor: 'you', to: 'spark', icon: 'clipboard', text: t('room.order').split('{n}').join(String(e.nodes)).split('{b}').join(String(e.budget)),
            logic: t('room.order.logic') })
          break
        case 'sealed':
          add({ actor: 'checker', icon: 'lock', text: t('room.sealed'), logic: t('room.sealed.logic') })
          break
        case 'reasoning':
          if (e.text) add({ actor: 'spark', icon: 'thought', text: clip(String(e.text)) })
          break
        case 'message':
          if (e.text) add({ actor: 'spark', icon: 'message', text: clip(String(e.text), 180) })
          break
        case 'tool_call': {
          const label = TOOL_LABEL[String(e.tool)]
          const to: Actor | undefined = e.tool === 'request_review' || e.tool === 'meta_inference' ? 'wonder'
            : e.tool === 'dispatch_crew' ? 'field' : e.tool === 'run_experiments' || e.tool === 'run_experiment' ? 'grid' : undefined
          if (label && e.tool !== 'run_experiments') add({ actor: 'spark', to, icon: 'wrench', text: t(label) })
          break
        }
        case 'experiment': {
          const a = (e.args ?? {}) as { kind?: string; node?: string; delta_kw?: number; switch_id?: number }
          const what = a.kind === 'perturb_load' ? t('room.load').split('{kw}').join(String(a.delta_kw)).split('{node}').join(String(a.node))
            : t('room.switch').split('{sw}').join(`SW-${a.switch_id}`)
          if (!e.accepted) {
            add({ actor: 'grid', to: 'spark', icon: 'ban', text: `${what}: ${t('refused by the network limits')}`, logic: t('room.rejected.logic') })
            break
          }
          const drops = Object.entries((e.drop_pu_per_mw ?? e.delta_pu ?? {}) as Record<string, number>).slice(0, 3)
          add({ actor: 'spark', to: 'grid', icon: 'bolt', text: `${t('Orders')}: ${what}` })
          add({ actor: 'grid', to: 'spark', icon: 'trend',
            text: drops.length ? `${t('room.response')}: ${drops.map(([n, v]) => `${n} ${(v * 1000).toFixed(1)}`).join(' · ')} mpu/MW` : String(e.message ?? ''),
            logic: a.kind === 'perturb_load' && drops.length
              ? t('room.exp.logic').split('{node}').join(String(a.node)).split('{top}').join(drops.map(([n]) => n).join(', '))
              : t('room.switch.logic') })
          break
        }
        case 'change_detected':
          add({ actor: 'grid', to: 'spark', icon: 'siren', text: t('room.change'), logic: t('room.change.logic') })
          break
        case 'intervention':
          add({ actor: 'you', to: 'grid', icon: 'wrench', text: t('room.intervention'), logic: t('room.intervention.logic') })
          break
        case 'hypothesis':
          add({ actor: 'spark', icon: 'bulb', text: `${clip(String(e.statement), 160)} (${Math.round(Number(e.confidence) * 100)}%)`,
            logic: `${t('Hypothesis')} · ${Math.round(Number(e.confidence) * 100)}%` })
          break
        case 'review_started':
          add({ actor: 'spark', to: 'wonder', icon: 'handshake', text: t('room.ask_wonder') })
          break
        case 'review':
          add({ actor: 'wonder', to: 'spark', icon: 'brain', text: clip(String(e.advice), 180), logic: t('room.review.logic') })
          break
        case 'meta_inference':
          add({ actor: 'wonder', to: 'spark', icon: 'ballot', text: t('room.vote').split('{n}').join(String(e.nodes_answered)), logic: t('room.vote.logic') })
          break
        case 'crew_dispatched':
          add({ actor: 'spark', to: 'field', icon: 'truck', text: t('room.crew').split('{node}').join(String(e.node)) })
          break
        case 'field_photo':
          add({ actor: 'field', icon: 'camera', text: t('room.photo') })
          break
        case 'segmentation':
          add({ actor: 'field', icon: 'scan', text: t('room.sam').split('{n}').join(String((e.objects as unknown[] | undefined)?.length ?? 0)) })
          break
        case 'field_reading':
          add({ actor: 'field', to: 'spark', icon: 'eye', text: `${t('room.reading')}: ${t(String(e.record_check ?? ''))}`, logic: t('room.reading.logic') })
          break
        case 'candidate': {
          const edges = (e.edges ?? []) as { basis: string }[]
          const measured = edges.filter((x) => x.basis === 'measured').length
          if (edges.length) add({ actor: 'spark', icon: 'tree', text: t('room.tree').split('{m}').join(String(measured)).split('{n}').join(String(edges.length)) })
          break
        }
        case 'result':
          add({ actor: 'spark', to: 'checker', icon: 'checkCircle', text: clip(String(e.summary), 180), logic: t('room.result.logic') })
          break
        case 'done': {
          const g = (e.score as { gridxray?: { correct_edges: number; total_edges: number } } | null)?.gridxray
          if (g) add({ actor: 'checker', icon: 'flag', text: t('room.score').split('{c}').join(String(g.correct_edges)).split('{n}').join(String(g.total_edges)) })
          break
        }
      }
    }
    return steps
  }, [events, t])
}

/**
 * The control room: the agents at their desks. The one acting lights up and speaks; signals fly
 * between desks (an order, a question to Wonder, an experiment sent to the network and its answer);
 * below, the investigation's logic in short lines.
 */
export function ControlRoom({ events, running }: { events: RunEvent[]; running: boolean }) {
  const { t } = useI18n()
  const steps = useSteps(events)
  const [open, setOpen] = useState(true)
  const cur = steps[steps.length - 1]
  const logic = steps.filter((s) => s.logic).slice(-4)
  if (!cur) return null
  if (!open) return <button className="room-open" onClick={() => setOpen(true)}><Icon name="building" size={15} /> {t('Control room')}</button>
  const desk = DESKS[cur.actor]
  const target = cur.to ? DESKS[cur.to] : null
  const bubbleLeft = Math.min(78, Math.max(4, (desk.x / W) * 100 - 14))
  return (
    <div className="room card" aria-label={t('Control room')}>
      <div className="room__head">
        <b className="room__title"><Icon name="building" size={16} /> {t('Control room')}</b>
        {running && <span className="room__live">● {t('live')}</span>}
        <button className="btn-link" onClick={() => setOpen(false)}>{t('Hide')}</button>
      </div>
      <div className="room__stage">
        <div key={cur.id} className="room__bubble" style={{ left: `${bubbleLeft}%`, borderColor: desk.color }}>
          <span className="room__who" style={{ color: desk.color }}><Icon name={cur.icon} size={13} /> {t(desk.label)}</span>
          <span>{cur.text}</span>
        </div>
        <svg viewBox={`0 0 ${W} 120`} className="room__svg" role="img" aria-label={t('Agents at their desks')}>
          <rect x="6" y="88" width={W - 12} height="10" rx="5" className="room__floor" />
          {target && (
            <g key={`sig${cur.id}`}>
              <path id={`p${cur.id}`} d={`M${desk.x} ${DESK_Y - 8} Q${(desk.x + target.x) / 2} ${DESK_Y - 52} ${target.x} ${DESK_Y - 8}`}
                className="room__wire" style={{ stroke: desk.color }} />
              {[0, 0.25, 0.5].map((d) => (
                <circle key={d} r="4.5" fill={desk.color}>
                  <animateMotion dur="1.1s" begin={`${d}s`} repeatCount="indefinite"><mpath href={`#p${cur.id}`} /></animateMotion>
                </circle>
              ))}
            </g>
          )}
          {(Object.keys(DESKS) as Actor[]).map((a) => {
            const d = DESKS[a]
            const on = a === cur.actor
            const recv = a === cur.to
            return (
              <g key={a} className={`room__desk${on ? ' is-on' : ''}${recv ? ' is-recv' : ''}`}>
                {on && <circle cx={d.x} cy={DESK_Y} r="24" fill={d.color} className="room__halo" />}
                <rect x={d.x - 30} y={DESK_Y + 14} width="60" height="12" rx="3" className="room__table" />
                <rect x={d.x + 8} y={DESK_Y + 2} width="18" height="12" rx="2" className={`room__screen${on || recv ? ' is-lit' : ''}`} style={on || recv ? { fill: d.color } : undefined} />
                <circle cx={d.x - 6} cy={DESK_Y} r="15" fill={d.color} className="room__avatar" />
                {d.glyph in ICON_PATHS
                  ? <path d={ICON_PATHS[d.glyph as keyof typeof ICON_PATHS]} transform={`translate(${d.x - 13.2} ${DESK_Y - 7.2}) scale(0.6)`}
                      fill="none" stroke="#fff" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
                  : <text x={d.x - 6} y={DESK_Y + 5} textAnchor="middle" className="room__glyph">{d.glyph}</text>}
                <text x={d.x} y={DESK_Y + 40} textAnchor="middle" className="room__name">{t(d.label)}</text>
                <text x={d.x} y={DESK_Y + 52} textAnchor="middle" className="room__sub">{t(d.sub)}</text>
              </g>
            )
          })}
        </svg>
      </div>
      {logic.length > 0 && (
        <ol className="room__logic">
          {logic.map((s) => <li key={s.id}><span className="room__ico" style={{ color: DESKS[s.actor].color }}><Icon name={s.icon} size={14} /></span>{s.logic}</li>)}
        </ol>
      )}
    </div>
  )
}
