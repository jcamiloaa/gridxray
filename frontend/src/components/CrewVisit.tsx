import { useState } from 'react'
import { createPortal } from 'react-dom'
import type { RunEvent } from '../api/client'
import { useI18n } from '../i18n'

interface SamObject { label: string; id: number; box: [number, number, number, number]; score: number; mask: { w: number; h: number; path: string } }
interface Reading { switch_present?: boolean; switch_state?: string; switch_tag?: string | null; site_tag?: string | null; mount?: string; line?: string; equipment?: string[]; confidence?: number; notes?: string }

const COLORS: Record<string, string> = { kiosk: '#3b82f6', switch: '#e9a23b', transformer: '#0e9fd8', insulator: '#a46ee0', tag: '#17a673', cable: '#d64545', 'kiosk door': '#5b6673', pole: '#8a6a4a' }

/** The photo with SAM 3.1's masks and boxes drawn over it, in the picture's own pixel space. */
function SegmentedPhoto({ src, w, h, objects, show }: { src: string; w: number; h: number; objects: SamObject[]; show: boolean }) {
  return (
    <div className="crew__photo">
      <img src={src} alt="" width={w} height={h} />
      {show && (
        <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
          {objects.map((o, i) => {
            const [x1, y1, x2, y2] = o.box
            const c = COLORS[o.label] ?? '#ffffff'
            return (
              <g key={i}>
                {o.mask.path && (
                  <path d={o.mask.path} fill={c} fillOpacity={o.label === 'kiosk' ? 0.18 : 0.5} fillRule="evenodd" stroke={c} strokeWidth={2.5}
                    transform={`translate(${x1} ${y1}) scale(${(x2 - x1) / o.mask.w} ${(y2 - y1) / o.mask.h})`} vectorEffect="non-scaling-stroke" />
                )}
                <rect x={x1} y={y1} width={x2 - x1} height={y2 - y1} fill="none" stroke={c} strokeWidth={2} strokeDasharray="8 5" />
                <rect x={x1 + 2} y={y1 + 2} width={Math.max(70, o.label.length * 10 + 46)} height={22} fill={c} rx={4} />
                <text x={x1 + 8} y={y1 + 18} fill="#fff" fontSize={14} fontWeight={700}>{o.label} {Math.round(o.score * 100)}%</text>
              </g>
            )
          })}
        </svg>
      )}
    </div>
  )
}

/** One field visit, live: Muse Image draws the site, SAM 3.1 segments it, Muse Spark reads it. */
export function CrewVisit({ events, runId }: { events: RunEvent[]; runId: string | null }) {
  const { t } = useI18n()
  const [show, setShow] = useState(true)
  const [zoom, setZoom] = useState(false)
  const start = events.find((e) => e.kind === 'crew_dispatched')!
  const photo = events.find((e) => e.kind === 'field_photo')
  const seg = events.find((e) => e.kind === 'segmentation')
  const read = events.find((e) => e.kind === 'field_reading')
  const stage = [...events].reverse().find((e) => e.kind === 'crew_stage')?.stage as string | undefined
  const objects = (seg?.objects ?? []) as SamObject[]
  const reading = (read?.reading ?? {}) as Reading
  const src = photo?.media_id && runId ? `/api/investigations/${runId}/media/${String(photo.media_id)}` : null
  const steps = [
    { key: 'photo', label: t('Photo'), model: 'Muse Image', done: photo, detail: photo && `${photo.seconds} s` },
    { key: 'segment', label: t('Segmentation'), model: 'SAM 3.1', done: seg, detail: seg && `${objects.length} ${t('objects')} · ${seg.seconds} s` },
    { key: 'read', label: t('Reading'), model: 'Muse Spark', done: read, detail: read && `${read.seconds} s` },
  ]
  const counts = objects.reduce<Record<string, number>>((m, o) => ({ ...m, [o.label]: (m[o.label] ?? 0) + 1 }), {})
  const check = String(read?.record_check ?? '')
  const outdated = check.startsWith('RECORD OUTDATED')

  return (
    <li className="tl tl--crew"><span className="tl__icon">🚐</span><div>
      <b>{t('Field crew sent to')} {String(start.node)}{start.auto ? <span className="pill crew__auto">{t('automatic')}</span> : null}</b>
      <p className="muted">{String(start.reason ?? '')}</p>
      <ol className="crew__steps">
        {steps.map((s) => (
          <li key={s.key} className={s.done ? 'is-done' : stage === s.key ? 'is-active' : ''}>
            <span>{s.done ? '✓' : stage === s.key ? '●' : '○'}</span>
            <div><b>{s.label}</b> <small>{s.model}</small>{s.detail ? <small> · {s.detail}</small> : stage === s.key ? <small> · {t('working…')}</small> : null}</div>
          </li>
        ))}
      </ol>
      {photo && (src ? (
        <>
          <button className="crew__frame" onClick={() => setZoom(true)} title={t('Enlarge')}>
            <SegmentedPhoto src={src} w={Number(photo.w)} h={Number(photo.h)} objects={objects} show={show && !!seg} />
          </button>
          {seg && (
            <div className="crew__legend">
              {Object.entries(counts).map(([l, n]) => <span key={l}><i style={{ background: COLORS[l] ?? '#888' }} />{t(l)} ×{n}</span>)}
              <button className="btn-link" onClick={() => setShow((v) => !v)}>{show ? t('Hide segmentation') : t('Show segmentation')}</button>
            </div>
          )}
        </>
      ) : <p className="muted">{t('Photo not stored for this run.')}</p>)}
      {!photo && stage === 'photo' && <div className="crew__placeholder">{t('Muse Image is drawing the site…')}</div>}
      {read && (
        <div className={`crew__reading${outdated || read.fault ? ' is-outdated' : ''}`}>
          {reading.switch_present && <span className={`pill crew__state crew__state--${reading.switch_state}`}>{reading.switch_tag ?? t('Switch')}: {t(String(reading.switch_state))}</span>}
          <span>{reading.mount ? t(reading.mount) : ''}{reading.line ? ` · ${t(reading.line)}` : ''}{reading.confidence ? ` · ${t('confidence')} ${Math.round(reading.confidence * 100)}%` : ''}</span>
          <b className="crew__check">{outdated ? '⚠ ' : '✓ '}{t(check.startsWith('RECORD OUTDATED') ? 'Record outdated' : check)}{outdated ? `: ${check.split(': ')[1] ?? ''}` : ''}</b>
          {read.fault ? <b className="crew__fault">🔥 {t('Fault seen: the smart meter is damaged')}</b> : null}
          {reading.notes && <small>{reading.notes}</small>}
        </div>
      )}
      {photo && (
        <details className="tl__what"><summary>{t('How is this photo made?')}</summary>
          <p>{t('crew.how')}</p>
          <pre className="crew__prompt">{String(photo.prompt)}</pre>
        </details>
      )}
      {zoom && src && photo && createPortal(
        <div className="dialog-backdrop" onClick={() => setZoom(false)}>
          <div className="crew__zoom" onClick={(e) => e.stopPropagation()}>
            <SegmentedPhoto src={src} w={Number(photo.w)} h={Number(photo.h)} objects={objects} show={show && !!seg} />
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <button className="btn-link" onClick={() => setShow((v) => !v)}>{show ? t('Hide segmentation') : t('Show segmentation')}</button>
              <button className="btn-ghost" onClick={() => setZoom(false)}>✕</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div></li>
  )
}
