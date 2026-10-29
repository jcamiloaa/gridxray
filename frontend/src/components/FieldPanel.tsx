import { useCallback, useEffect, useState } from 'react'
import { field, type FieldView } from '../api/client'
import { useI18n } from '../i18n'
import { Info } from './Info'

/** The server explains refusals in English; these are its sentences in Spanish. */
const REFUSALS_ES: [RegExp, string][] = [
  [/^Not applied: it would close a loop.*$/, 'No se aplicó: cerraría un lazo. Abre otro interruptor del mismo lazo en la misma operación para mantener la red radial.'],
  [/^Not applied: (.+) would be left without supply$/, 'No se aplicó: $1 quedarían sin energía.'],
  [/^Not applied: voltage would leave the (.+) pu band \(min (.+)\)$/, 'No se aplicó: la tensión saldría de la banda $1 pu (mínimo $2).'],
  [/^Not applied: a line would be loaded to (.+)% of its rating$/, 'No se aplicó: una línea quedaría cargada al $1% de su capacidad.'],
  [/^Not applied: the power flow does not converge$/, 'No se aplicó: el flujo de carga no converge.'],
  [/^Not applied: fuses are not operated.*$/, 'No se aplicó: los fusibles no se maniobran.'],
]
const inSpanish = (e: string) => { for (const [re, es] of REFUSALS_ES) if (re.test(e)) return e.replace(re, es); return e }

/**
 * Live intervention: while the AI investigates, operate real switches or switch meters off, as
 * happens in a real network. The AI is not told: it has to notice from its own readings.
 */
export function FieldPanel({ runId, changes }: { runId: string; changes: number }) {
  const { t, lang } = useI18n()
  const [view, setView] = useState<FieldView | null>(null)
  const [toggle, setToggle] = useState<Set<number>>(new Set())
  const [off, setOff] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [open, setOpen] = useState(false)

  const load = useCallback(() => field.view(runId).then(setView, () => setView(null)), [runId])
  useEffect(() => {
    if (!open) return
    load()
    const id = window.setInterval(() => { if (!view) load() }, 2000) // until the investigator has its network
    return () => window.clearInterval(id)
  }, [open, load, view])
  useEffect(() => { if (open) load() }, [changes, open, load])

  const flip = (set: Set<number>, id: number) => { const n = new Set(set); if (n.has(id)) n.delete(id); else n.add(id); return n }

  async function apply() {
    setBusy(true)
    setMsg(null)
    try {
      await field.intervene(runId, [...toggle], [...off])
      setMsg({ ok: true, text: t('Applied in the field. The AI was not told: watch whether it notices.') })
      setToggle(new Set()); setOff(new Set())
      load()
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e)
      setMsg({ ok: false, text: lang === 'es' ? inSpanish(text) : text })
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return <button className="field-open" onClick={() => setOpen(true)}>⚡ {t('Intervene in the field')}</button>
  }
  const operable = view?.switches.filter((w) => w.kind !== 'fuse') ?? []
  return (
    <div className="field-panel">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <b>⚡ {t('Intervene in the field')}<Info>{t('field.info')}</Info></b>
        <button className="btn-link" onClick={() => setOpen(false)}>{t('Hide')}</button>
      </div>
      {!view ? <p className="muted">{t('Waiting for the investigation to load its network…')}</p> : (
        <>
          <span className="group-label">{t('Operate switches')}</span>
          <ul className="field-list">
            {operable.map((w) => {
              const chosen = toggle.has(w.id)
              const next = chosen ? !w.closed : w.closed
              return (
                <li key={w.id}>
                  <label className={chosen ? 'is-chosen' : ''}>
                    <input type="checkbox" checked={chosen} onChange={() => setToggle(flip(toggle, w.id))} />
                    <span><b>SW-{w.id}</b> {t(w.kind)} · {w.between.join(' – ')}</span>
                    <span className={`pill field-state field-state--${next ? 'closed' : 'open'}`}>
                      {chosen && <>{t(w.closed ? 'closed' : 'open')} → </>}{t(next ? 'closed' : 'open')}</span>
                  </label>
                </li>
              )
            })}
          </ul>
          <details>
            <summary className="group-label">{t('Switch meters off')} ({view.meters.filter((m) => m.offline).length} {t('offline')})</summary>
            <div className="field-meters">
              {view.meters.map((m) => (
                <label key={m.id} className={m.offline ? 'is-off' : off.has(m.id) ? 'is-chosen' : ''}>
                  <input type="checkbox" disabled={m.offline} checked={m.offline || off.has(m.id)} onChange={() => setOff(flip(off, m.id))} />{m.name}
                </label>
              ))}
            </div>
          </details>
          <small className="muted">{t('field.tip')}</small>
          <button className="btn-primary" onClick={apply} disabled={busy || (!toggle.size && !off.size)}>
            {busy ? t('Applying…') : t('Apply in the field')}
          </button>
          {msg && <p className={msg.ok ? 'field-ok' : 'error'}>{msg.text}</p>}
        </>
      )}
    </div>
  )
}
