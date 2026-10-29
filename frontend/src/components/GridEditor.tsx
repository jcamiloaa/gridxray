import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { grids, type Complexity, type Design, type DesignLine, type DesignNode, type GridSummary, type SwitchKind } from '../api/client'
import { useI18n } from '../i18n'

const CELL = 62
const PAD = 26
const SUB = 'S'
type Tool = 'select' | 'node' | 'overhead' | 'underground' | 'erase'
type Sel = { kind: 'node'; key: string } | { kind: 'line'; index: number } | { kind: 'sub' } | null

const EMPTY: Design = { name: 'My network', substation_row: 2, nodes: [], lines: [], noise: 'realistic' }
const SWITCH_LETTER: Record<SwitchKind, string> = { tie: 'T', sectionalizer: 'S', recloser: 'R', fuse: 'F' }

const nextName = (nodes: DesignNode[]) => {
  let i = nodes.length + 1
  while (nodes.some((n) => n.name === `SS-${String(i).padStart(2, '0')}`)) i++
  return `SS-${String(i).padStart(2, '0')}`
}
/** The server explains problems in English; these are its sentences in Spanish. */
const ERRORS_ES: [RegExp, string][] = [
  [/^Add at least one secondary substation\.$/, 'Agrega al menos una subestación secundaria.'],
  [/^At most (\d+) secondary substations\.$/, 'Máximo $1 subestaciones secundarias.'],
  [/^Two secondary substations are both named (.+)\.$/, 'Dos subestaciones se llaman $1.'],
  [/^Two secondary substations are on the same block\.$/, 'Dos subestaciones están en la misma manzana.'],
  [/^A cable starts and ends at (.+)\.$/, 'Un cable empieza y termina en $1.'],
  [/^Two cables join (.+) and (.+)\.$/, 'Hay dos cables entre $1 y $2.'],
  [/^Connect at least one cable to the substation\.$/, 'Conecta al menos un cable a la subestación AT/MT.'],
  [/^No supply reaches (.+): connect them with a cable whose switch is closed\.$/, 'No llega energía a $1: conéctalas con un cable cuyo interruptor esté cerrado.'],
  [/^The closed cables form a loop\..*$/, 'Los cables cerrados forman un lazo. Las redes de distribución se operan radialmente: abre un interruptor del lazo (hazlo un enlace normalmente abierto).'],
]
const inSpanish = (e: string) => { for (const [re, es] of ERRORS_ES) if (re.test(e)) return e.replace(re, es); return e }

const samePair = (l: DesignLine, a: string, b: string) => (l.a === a && l.b === b) || (l.a === b && l.b === a)

/**
 * Network editor: secondary substations on city blocks, joined by overhead lines or underground
 * cables, with switches whose real position (and recorded position) you choose. The AI then
 * investigates it without seeing the wiring.
 */
export function GridEditor({ initial, gridId, onClose, onSaved }: {
  initial?: Design; gridId?: string; onClose: () => void; onSaved: (g: GridSummary) => void
}) {
  const { t, lang } = useI18n()
  const [d, setD] = useState<Design>(initial ?? EMPTY)
  const [tool, setTool] = useState<Tool>(initial ? 'select' : 'node')
  const [sel, setSel] = useState<Sel>(null)
  const [pending, setPending] = useState<string | null>(null) // first end of a cable being drawn
  const [errors, setErrors] = useState<string[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [tpl, setTpl] = useState<{ level: Complexity; seed: number }>({ level: 'easy', seed: 0 })
  const [hover, setHover] = useState<[number, number] | null>(null)

  const cols = Math.max(10, ...d.nodes.map((n) => n.cell[0] + 3))
  const rows = Math.max(6, d.substation_row + 2, ...d.nodes.map((n) => n.cell[1] + 2))
  const cellOf = (key: string): [number, number] => (key === SUB ? [-1, d.substation_row] : d.nodes.find((n) => n.key === key)?.cell ?? [0, 0])
  const xy = ([c, r]: [number, number]) => [PAD + (c + 1) * CELL + CELL / 2, PAD + r * CELL + CELL / 2] as const
  const nameOf = (key: string) => (key === SUB ? t('Substation') : d.nodes.find((n) => n.key === key)?.name ?? '?')

  // live check with the same rules the server applies
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      grids.validate(d).then((r) => setErrors(r.errors), () => setErrors(null))
    }, 250)
    return () => window.clearTimeout(timer.current)
  }, [d])

  const update = (fn: (x: Design) => Design) => { setD(fn); setSaveError(null) }
  const nodeAt = (c: number, r: number) => d.nodes.find((n) => n.cell[0] === c && n.cell[1] === r)

  const addLine = (a: string, b: string) => {
    if (a === b || d.lines.some((l) => samePair(l, a, b))) return
    update((x) => ({ ...x, lines: [...x.lines, { a, b, kind: tool === 'underground' ? 'underground' : 'overhead', switch: null }] }))
  }
  const removeNode = (key: string) => update((x) => ({ ...x, nodes: x.nodes.filter((n) => n.key !== key), lines: x.lines.filter((l) => l.a !== key && l.b !== key) }))
  const removeLine = (i: number) => update((x) => ({ ...x, lines: x.lines.filter((_, k) => k !== i) }))

  const clickCell = (c: number, r: number) => {
    const n = nodeAt(c, r)
    const target = c === -1 && r === d.substation_row ? SUB : n?.key
    if (tool === 'node') {
      if (c >= 0 && !n) {
        const key = `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
        update((x) => ({ ...x, nodes: [...x.nodes, { key, name: nextName(x.nodes), cell: [c, r], mount: 'kiosk', profile: 'residential', kw: 250, metered: true }] }))
        setSel({ kind: 'node', key })
      } else if (target) setSel(target === SUB ? { kind: 'sub' } : { kind: 'node', key: target })
      return
    }
    if (tool === 'overhead' || tool === 'underground') {
      if (!target) { setPending(null); return }
      if (pending && pending !== target) { addLine(pending, target); setPending(target) } // keep chaining from here
      else setPending(target)
      return
    }
    if (tool === 'erase') {
      if (target && target !== SUB) removeNode(target)
      return
    }
    // select: pick, or move the selected item to an empty block
    if (target) { setSel(target === SUB ? { kind: 'sub' } : { kind: 'node', key: target }); return }
    if (sel?.kind === 'node' && c >= 0) update((x) => ({ ...x, nodes: x.nodes.map((m) => (m.key === sel.key ? { ...m, cell: [c, r] } : m)) }))
    else if (sel?.kind === 'sub' && c === -1) update((x) => ({ ...x, substation_row: r }))
    else setSel(null)
  }
  const clickLine = (e: ReactMouseEvent, i: number) => {
    e.stopPropagation()
    if (tool === 'erase') removeLine(i)
    else { setSel({ kind: 'line', index: i }); setPending(null) }
  }

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, select, textarea')) return
      if (e.key === 'Escape') { setPending(null); setSel(null) }
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel) {
        if (sel.kind === 'node') removeNode(sel.key)
        if (sel.kind === 'line') removeLine(sel.index)
        setSel(null)
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })

  async function loadTemplate(level: Complexity | 'empty') {
    if (level === 'empty') { setD({ ...EMPTY, name: d.name }); setSel(null); return }
    try {
      setD(await grids.template(level, tpl.seed))
      setSel(null)
      setTool('select')
    } catch (e) { setSaveError(e instanceof Error ? e.message : String(e)) }
  }

  async function save() {
    setSaving(true)
    setSaveError(null)
    try {
      onSaved(gridId ? await grids.update(gridId, d) : await grids.create(d))
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const switches = d.lines.filter((l) => l.switch).length
  const outdated = d.lines.filter((l) => l.switch && l.switch.documented_closed !== null && l.switch.documented_closed !== l.switch.closed).length
  const selNode = sel?.kind === 'node' ? d.nodes.find((n) => n.key === sel.key) : undefined
  const selLine = sel?.kind === 'line' ? d.lines[sel.index] : undefined
  const setNode = (patch: Partial<DesignNode>) => selNode && update((x) => ({ ...x, nodes: x.nodes.map((n) => (n.key === selNode.key ? { ...n, ...patch } : n)) }))
  const setLine = (patch: Partial<DesignLine>) => sel?.kind === 'line' && update((x) => ({ ...x, lines: x.lines.map((l, k) => (k === sel.index ? { ...l, ...patch } : l)) }))

  // straight lines between substations: clearer to edit (the 3D view routes them along the streets)
  const paths = useMemo(() => d.lines.map((l) => {
    const [ax, ay] = xy(cellOf(l.a))
    const [bx, by] = xy(cellOf(l.b))
    return { d: `M${ax} ${ay}L${bx} ${by}`, mid: [(ax + bx) / 2, (ay + by) / 2] as [number, number] }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [d])

  const W = PAD * 2 + (cols + 1) * CELL
  const H = PAD * 2 + rows * CELL
  const TOOLS: { id: Tool; label: string; hint: string }[] = [
    { id: 'select', label: t('Select / move'), hint: t('editor.hint.select') },
    { id: 'node', label: t('+ Secondary substation'), hint: t('editor.hint.node') },
    { id: 'overhead', label: t('Overhead line'), hint: t('editor.hint.cable') },
    { id: 'underground', label: t('Underground cable'), hint: t('editor.hint.cable') },
    { id: 'erase', label: t('Erase'), hint: t('editor.hint.erase') },
  ]

  return createPortal(
    <div className="editor" role="dialog" aria-label={t('Network editor')}>
      <header className="editor__top">
        <b>{t('Design your network')}</b>
        <input className="editor__name" value={d.name} maxLength={60} onChange={(e) => update((x) => ({ ...x, name: e.target.value }))} aria-label={t('Network name')} />
        <span className="editor__tpl">
          {t('Start from')}
          <select value="" onChange={(e) => e.target.value && loadTemplate(e.target.value as Complexity | 'empty')}>
            <option value="">…</option>
            <option value="empty">{t('An empty city')}</option>
            <option value="easy">{t('Easy')}</option>
            <option value="medium">{t('Medium')}</option>
            <option value="hard">{t('Hard')}</option>
          </select>
          {t('seed')} <input type="number" min={0} value={tpl.seed} onChange={(e) => setTpl({ ...tpl, seed: Number(e.target.value) })} style={{ width: 56 }} />
        </span>
        <label className="editor__noise">{t('Meters')}
          <select value={d.noise} onChange={(e) => update((x) => ({ ...x, noise: e.target.value as Design['noise'] }))}>
            <option value="clean">{t('clean')}</option>
            <option value="realistic">{t('realistic')}</option>
            <option value="noisy">{t('noisy, some missing')}</option>
          </select>
        </label>
        <span className="grow" />
        <button onClick={onClose}>{t('Cancel')}</button>
        <button className="btn-primary" onClick={save} disabled={saving || !errors || errors.length > 0}>
          {saving ? t('Saving…') : t('Save and use')}
        </button>
      </header>

      <div className="editor__body">
        <nav className="editor__tools" aria-label={t('Tools')}>
          {TOOLS.map((x) => (
            <button key={x.id} aria-pressed={tool === x.id} onClick={() => { setTool(x.id); setPending(null) }} title={x.hint}
              className={`editor__tool editor__tool--${x.id}`}>{x.label}</button>
          ))}
          <p className="muted">{TOOLS.find((x) => x.id === tool)?.hint}</p>
          {pending && <p className="editor__pending">{t('Drawing from')} <b>{nameOf(pending)}</b> · Esc</p>}
        </nav>

        <div className="editor__canvas">
          <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} onMouseLeave={() => setHover(null)}>
            {/* city blocks; the substation column is outside the city, to the west */}
            {Array.from({ length: rows }, (_, r) => Array.from({ length: cols + 1 }, (_, k) => {
              const c = k - 1
              const isSub = c === -1
              const x = PAD + k * CELL
              const y = PAD + r * CELL
              const hot = hover && hover[0] === c && hover[1] === r
              return (
                <rect key={`${c}:${r}`} x={x + 3} y={y + 3} width={CELL - 6} height={CELL - 6} rx={6}
                  className={`editor__block${isSub ? ' editor__block--sub' : ''}${hot ? ' is-hot' : ''}`}
                  onMouseEnter={() => setHover([c, r])} onClick={() => clickCell(c, r)} />
              )
            }))}
            {paths.map((p, i) => {
              const l = d.lines[i]
              const open = l.switch && !l.switch.closed
              const selected = sel?.kind === 'line' && sel.index === i
              return (
                <g key={i} className="editor__line" onClick={(e) => clickLine(e, i)}>
                  <path d={p.d} className="editor__hit" />
                  <path d={p.d} className={`editor__wire editor__wire--${l.kind}${open ? ' is-open' : ''}${selected ? ' is-selected' : ''}`} />
                  {l.switch && (
                    <g transform={`translate(${p.mid[0]} ${p.mid[1]})`}>
                      <rect x={-9} y={-9} width={18} height={18} rx={3} className={`editor__sw${open ? ' is-open' : ''}`} />
                      <text y={4} textAnchor="middle" className="editor__sw-t">{SWITCH_LETTER[l.switch.kind]}</text>
                      {l.switch.documented_closed !== null && l.switch.documented_closed !== l.switch.closed && (
                        <g transform="translate(11 -11)"><circle r={7} className="editor__warn" /><text y={4} textAnchor="middle" className="editor__warn-t">!</text></g>
                      )}
                    </g>
                  )}
                </g>
              )
            })}
            {(() => {
              const [x, y] = xy([-1, d.substation_row])
              const on = sel?.kind === 'sub' || pending === SUB
              return (
                <g className="editor__node" onClick={() => clickCell(-1, d.substation_row)}>
                  <rect x={x - 24} y={y - 20} width={48} height={40} rx={6} className={`editor__subst${on ? ' is-selected' : ''}`} />
                  <text x={x} y={y + 4} textAnchor="middle" className="editor__subst-t">HV/MV</text>
                </g>
              )
            })()}
            {d.nodes.map((n) => {
              const [x, y] = xy(n.cell)
              const on = (sel?.kind === 'node' && sel.key === n.key) || pending === n.key
              return (
                <g key={n.key} className="editor__node" onClick={(e) => { e.stopPropagation(); clickCell(n.cell[0], n.cell[1]) }}>
                  {n.mount === 'pole'
                    ? <circle cx={x} cy={y} r={14} className={`editor__ss${on ? ' is-selected' : ''}`} />
                    : <rect x={x - 15} y={y - 13} width={30} height={26} rx={4} className={`editor__ss${on ? ' is-selected' : ''}`} />}
                  {n.metered && <circle cx={x + 12} cy={y - 11} r={4} className="editor__meter" />}
                  <text x={x} y={y + 27} textAnchor="middle" className="editor__ss-t">{n.name}</text>
                </g>
              )
            })}
          </svg>
        </div>

        <aside className="editor__side">
          <section className={`editor__check${errors && errors.length === 0 ? ' is-ok' : ''}`}>
            {errors === null ? <span className="muted">{t('Checking…')}</span>
              : errors.length === 0 ? (
                <b>✓ {t('The network works')}: {d.nodes.length} {t('substations')} · {d.lines.length} {t('cables')} · {switches} {t('switches')}
                  {outdated > 0 && <> · {outdated} {t('outdated records')}</>}</b>
              ) : (
                <><b>{t('To fix before saving')}</b><ul>{errors.map((e) => <li key={e}>{lang === 'es' ? inSpanish(e) : e}</li>)}</ul></>
              )}
          </section>
          {saveError && <p className="error">{saveError}</p>}

          {selNode && (
            <section className="editor__props">
              <h3>{t('Secondary substation')}</h3>
              <label>{t('Name')}<input value={selNode.name} maxLength={24} onChange={(e) => setNode({ name: e.target.value })} /></label>
              <label>{t('Type')}<select value={selNode.mount} onChange={(e) => setNode({ mount: e.target.value as DesignNode['mount'] })}>
                <option value="kiosk">{t('Kiosk (ground-mounted)')}</option><option value="pole">{t('Pole-mounted transformer')}</option></select></label>
              <label>{t('Customers')}<select value={selNode.profile} onChange={(e) => setNode({ profile: e.target.value as DesignNode['profile'] })}>
                <option value="residential">{t('residential')}</option><option value="commercial">{t('commercial')}</option></select></label>
              <label>{t('Peak load (kW)')}<input type="number" min={10} max={3000} step={10} value={selNode.kw} onChange={(e) => setNode({ kw: Math.max(10, Number(e.target.value)) })} /></label>
              <label className="row"><input type="checkbox" checked={selNode.metered} onChange={(e) => setNode({ metered: e.target.checked })} />{t('Has a smart meter')}</label>
              <button className="btn-ghost" onClick={() => { removeNode(selNode.key); setSel(null) }}>{t('Delete')}</button>
            </section>
          )}

          {selLine && (
            <section className="editor__props">
              <h3>{nameOf(selLine.a)} – {nameOf(selLine.b)}</h3>
              <div className="seg">
                <button aria-pressed={selLine.kind === 'overhead'} onClick={() => setLine({ kind: 'overhead' })}>{t('Overhead line')}</button>
                <button aria-pressed={selLine.kind === 'underground'} onClick={() => setLine({ kind: 'underground' })}>{t('Underground cable')}</button>
              </div>
              <label>{t('Switch on this section')}
                <select value={selLine.switch?.kind ?? ''} onChange={(e) => {
                  const kind = e.target.value as SwitchKind | ''
                  setLine({ switch: kind ? { kind, closed: kind !== 'tie', documented_closed: null } : null })
                }}>
                  <option value="">{t('none')}</option>
                  <option value="sectionalizer">{t('Sectionalizer (normally closed)')}</option>
                  <option value="recloser">{t('Recloser')}</option>
                  <option value="fuse">{t('Fuse cutout')}</option>
                  <option value="tie">{t('Tie switch (normally open)')}</option>
                </select>
              </label>
              {selLine.switch && (
                <>
                  <span className="editor__lbl">{t('Real position (what is in the field)')}</span>
                  <div className="seg">
                    <button aria-pressed={selLine.switch.closed} onClick={() => setLine({ switch: { ...selLine.switch!, closed: true } })}>{t('closed')}</button>
                    <button aria-pressed={!selLine.switch.closed} onClick={() => setLine({ switch: { ...selLine.switch!, closed: false } })}>{t('open')}</button>
                  </div>
                  <span className="editor__lbl">{t('What the records say')}</span>
                  <div className="seg">
                    <button aria-pressed={selLine.switch.documented_closed === null} onClick={() => setLine({ switch: { ...selLine.switch!, documented_closed: null } })}>{t('the same')}</button>
                    <button aria-pressed={selLine.switch.documented_closed === !selLine.switch.closed}
                      onClick={() => setLine({ switch: { ...selLine.switch!, documented_closed: !selLine.switch!.closed } })}>{t('the opposite (outdated)')}</button>
                  </div>
                  <small className="muted">{t('editor.records')}</small>
                </>
              )}
              <button className="btn-ghost" onClick={() => { removeLine(sel!.kind === 'line' ? sel!.index : -1); setSel(null) }}>{t('Delete')}</button>
            </section>
          )}

          {sel?.kind === 'sub' && (
            <section className="editor__props">
              <h3>{t('HV/MV substation')}</h3>
              <p className="muted">{t('editor.sub')}</p>
            </section>
          )}

          {!sel && (
            <section className="editor__props muted">
              <h3>{t('How it works')}</h3>
              <p>{t('editor.help')}</p>
            </section>
          )}
        </aside>
      </div>
    </div>,
    document.body,
  )
}
