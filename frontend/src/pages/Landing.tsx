import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { User } from '../api/client'
import { Brand, ByZynplex } from '../components/Brand'
import { Icon } from '../components/Icon'
import type { CalloutSpec } from '../scene/GridScene'
import { SceneView } from '../scene/SceneView'
import { ChainDiagram } from './landing/ChainDiagram'
import { HeroCity } from './landing/HeroCity'
import { DEMO_GRID } from './landing/demoGrid'
import { COPY, LANGS, type Lang } from './landing/i18n'
import { AppWindow, Figure, InvestigationMock, ReviewMock, VerifyMock } from './landing/Mockups'
import './landing/landing.css'

const KEY_TARGETS: CalloutSpec['target'][] = ['hv', 'transformer', 'busbar', 'feeder', 'kiosk', 'meter', 'tie', 'flow']
const CALLOUTS: CalloutSpec[] = KEY_TARGETS.map((target, i) => ({ n: i + 1, target }))
const LOOP_ICONS = ['eye', 'brain', 'flask', 'users', 'check']
const GROUND_ICONS = ['layers', 'lock', 'shield']
const ICONS = {
  lab: ['layers', 'lock', 'activity', 'map'],
  investigate: ['flask', 'target', 'history', 'spark'],
  review: ['alert', 'brain', 'flask'],
  verify: ['check', 'gauge', 'switch', 'shield'],
  benefits: ['map', 'shield', 'alert', 'gauge'],
}
const NAV_IDS = ['platform', 'lab', 'investigate', 'verify', 'scope', 'guide'] as const
const FOOTER_LINKS = { platform: ['#lab', '#investigate', '#review', '#verify'], learn: ['#chain', '#scope', '#guide', '#glossary'] }
const LANG_KEY = 'gridxray.lang'

/** Landing language: English unless the visitor picked Spanish before. */
function useLang(): [Lang, (l: Lang) => void] {
  const [lang, setLang] = useState<Lang>(() => {
    try { return localStorage.getItem(LANG_KEY) === 'es' ? 'es' : 'en' } catch { return 'en' }
  })
  useEffect(() => { document.documentElement.lang = lang }, [lang])
  const pick = (l: Lang) => {
    setLang(l)
    try { localStorage.setItem(LANG_KEY, l) } catch { /* storage unavailable: keep it for this visit */ }
  }
  return [lang, pick]
}

function LangSwitch({ lang, onPick, label }: { lang: Lang; onPick: (l: Lang) => void; label: string }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) }
  }, [open])
  return (
    <div className="lx-lang" ref={box}>
      <button className="lx-btn lx-btn--text lx-lang__btn" aria-haspopup="listbox" aria-expanded={open} aria-label={label}
        onClick={() => setOpen(!open)}>
        <Icon name="globe" size={16} /><span>{LANGS.find((l) => l.id === lang)!.label}</span>
      </button>
      {open && (
        <ul className="lx-lang__menu" role="listbox" aria-label={label}>
          {LANGS.map((l) => (
            <li key={l.id}>
              <button role="option" aria-selected={l.id === lang} onClick={() => { onPick(l.id); setOpen(false) }}>
                <span className="lx-mono">{l.label}</span>{l.name}{l.id === lang && <Icon name="check" size={14} />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Adds `is-in` to every [data-reveal] element as it scrolls into view. */
function useReveal(root: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = root.current
    if (!el) return
    el.classList.add('lx--reveal')
    let pending = [...el.querySelectorAll('[data-reveal]')]
    let frame = 0
    // Scroll-driven rather than IntersectionObserver: anchor jumps reveal everything they pass.
    const check = () => {
      frame = 0
      const edge = window.innerHeight * 0.92
      pending = pending.filter((n) => {
        if (n.getBoundingClientRect().top > edge) return true
        n.classList.add('is-in')
        return false
      })
    }
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(check) }
    check()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [root])
}

/** The id of the section currently under the nav bar. */
function useActiveSection(ids: string[]) {
  const [active, setActive] = useState('')
  useEffect(() => {
    const onScroll = () => {
      let cur = ''
      for (const id of ids) {
        const s = document.getElementById(id)
        if (s && s.getBoundingClientRect().top < 140) cur = id
      }
      setActive(cur)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [ids])
  return active
}

const Eyebrow = ({ children }: { children: ReactNode }) => <span className="lx-eyebrow">{children}</span>

function PillarHead({ n, kicker, title, lead }: { n: string; kicker: string; title: ReactNode; lead: string }) {
  return (
    <div className="lx-pillar__head">
      <span className="lx-pillar__kicker"><span className="lx-pillar__num" aria-hidden="true">{n}</span><span>{kicker}</span></span>
      <h2>{title}</h2>
      <p className="lx-lead">{lead}</p>
    </div>
  )
}

function FeatureList({ items, icons }: { items: { title: string; text: string }[]; icons: string[] }) {
  return (
    <ul className="lx-features">
      {items.map((f, i) => (
        <li key={f.title}>
          <span className="lx-icon"><Icon name={icons[i]} size={18} /></span>
          <div><b>{f.title}</b><p>{f.text}</p></div>
        </li>
      ))}
    </ul>
  )
}

const navIds = [...NAV_IDS]

export function Landing({ user, onOpenWorkspace, onSignIn }: {
  user: User | null; onOpenWorkspace: () => void; onSignIn: () => void
}) {
  const [lang, setLang] = useLang()
  const t = COPY[lang]
  const [active, setActive] = useState<number | null>(null)
  const [menu, setMenu] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useReveal(root)
  const current = useActiveSection(navIds)
  const enter = user ? onOpenWorkspace : onSignIn
  const enterLabel = user ? t.nav.openWorkspace : t.hero.enter
  const pillar = (n: string, p: { kicker: string; title: string; lead: string }, title: ReactNode = p.title) =>
    <PillarHead n={n} kicker={p.kicker} title={title} lead={p.lead} />

  return (
    <div className="lx" ref={root}>
      <header className="lx-nav">
        <div className="lx-nav__inner">
          <a href="#top" className="lx-nav__brand" aria-label="GridXray"><Brand size={24} /></a>
          <nav aria-label="Sections" className={menu ? 'lx-nav__links is-open' : 'lx-nav__links'}>
            {NAV_IDS.map((id) => (
              <a key={id} href={`#${id}`} className={current === id ? 'is-active' : ''} onClick={() => setMenu(false)}>{t.nav[id]}</a>
            ))}
          </nav>
          <div className="lx-nav__actions">
            <ByZynplex />
            <LangSwitch lang={lang} onPick={setLang} label={t.nav.language} />
            {!user && <button className="lx-btn lx-btn--text" onClick={onSignIn}>{t.nav.signIn}</button>}
            <button className="lx-btn lx-btn--primary lx-btn--sm" onClick={enter}>{user ? t.nav.openWorkspace : t.nav.tryDemo}</button>
            <button className="lx-btn lx-btn--icon lx-nav__menu" aria-label={t.nav.menu} aria-expanded={menu} onClick={() => setMenu(!menu)}>
              <Icon name={menu ? 'x' : 'menu'} />
            </button>
          </div>
        </div>
      </header>

      <section className="lx-hero" id="top">
        <HeroCity />
        <div className="lx-hero__veil" aria-hidden="true" />
        <div className="lx-wrap lx-hero__content">
          <Eyebrow>{t.hero.eyebrow}</Eyebrow>
          <h1>{t.hero.title[0]}<br />{t.hero.title[1]}</h1>
          <p className="lx-hero__lead">
            {t.hero.lead[0]}<b>{t.hero.lead[1]}</b>{t.hero.lead[2]}<b>{t.hero.lead[3]}</b>{t.hero.lead[4]}
          </p>
          <div className="lx-hero__cta">
            <button className="lx-btn lx-btn--primary" onClick={enter}>{enterLabel}<Icon name="arrow" size={16} /></button>
            <a className="lx-btn lx-btn--outline" href="#platform">{t.hero.explore}</a>
          </div>
        </div>
        <a href="#problem" className="lx-hero__scroll" aria-label={t.hero.scroll}><i /></a>
      </section>

      <div className="lx-stats">
        <div className="lx-wrap"><div className="lx-hero__stats" data-reveal>
          {t.stats.map(([v, l, s]) => <div key={v + l}><b>{v}</b><span>{l}</span><small>{s}</small></div>)}
        </div></div>
      </div>

      <div className="lx-strip">
        <div className="lx-wrap lx-strip__inner">
          <span className="lx-mono lx-dim">{t.builtWith}</span>
          {['Meta Muse Spark', 'Meta Muse Wonder', 'pandapower', 'CIGRE MV benchmark', 'MV Oberrhein', 'React Three Fiber'].map((x) => <span key={x}>{x}</span>)}
        </div>
      </div>

      <section className="lx-section" id="problem">
        <div className="lx-wrap">
          <div className="lx-head" data-reveal>
            <Eyebrow>{t.problem.eyebrow}</Eyebrow>
            <h2>{t.problem.title}</h2>
            <p className="lx-lead">{t.problem.lead}</p>
          </div>
          <div className="lx-problems">
            {t.problem.items.map((it, i) => (
              <div key={i} className="lx-problem" data-reveal>
                <span className="lx-mono">{String(i + 1).padStart(2, '0')}</span><h3>{it.title}</h3><p>{it.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="lx-section" id="platform">
        <div className="lx-wrap">
          <div className="lx-head lx-head--center" data-reveal>
            <Eyebrow>{t.platform.eyebrow}</Eyebrow>
            <h2>{t.platform.title}</h2>
            <p className="lx-lead">{t.platform.lead}</p>
          </div>
          <div className="lx-loop" data-reveal>
            <ol className="lx-loop__track">
              {t.platform.loop.map((st, i) => (
                <li key={i} className="lx-step">
                  <span className="lx-step__node"><Icon name={LOOP_ICONS[i]} size={20} /></span>
                  <span className="lx-step__n">{String(i + 1).padStart(2, '0')}</span>
                  <b>{st.title}</b><span>{st.sub}</span>
                </li>
              ))}
            </ol>
            <p className="lx-loop__return"><Icon name="history" size={14} />{t.platform.repeats}</p>
            <div className="lx-loop__ground">
              {t.platform.ground.map((g, i) => {
                const inner = <>
                  <span className="lx-ground__k">{g.k}</span>
                  <b><Icon name={GROUND_ICONS[i]} size={16} />{g.title}</b>
                  <span>{g.text}</span>
                </>
                return i === 0 ? (
                  <a key={i} href="#lab" className="lx-ground lx-ground--link">
                    {inner}<span className="lx-ground__go">{t.platform.openLab} <Icon name="arrow" size={14} /></span>
                  </a>
                ) : <div key={i} className="lx-ground">{inner}</div>
              })}
            </div>
          </div>
        </div>
      </section>

      <section className="lx-section lx-section--alt" id="lab">
        <div className="lx-wrap">
          <div className="lx-pillar lx-pillar--stack">
            <div data-reveal>{pillar('01', t.lab, <>{t.lab.titleBreak[0]}<br />{t.lab.titleBreak[1]}</>)}</div>
            <div data-reveal><FeatureList items={t.lab.features} icons={ICONS.lab} /></div>
          </div>
          <div data-reveal>
            <Figure n="01" caption={t.lab.caption}>
              <AppWindow path="lab" title={t.lab.window} light
                badge={<span className="lx-chip lx-chip--ok"><Icon name="check" size={11} />{t.lab.converged}</span>}>
                <div className="lx-explorer">
                  <div className="lx-explorer__scene">
                    <SceneView model={DEMO_GRID} citySeed={7} callouts={CALLOUTS} activeCallout={active} onCalloutHover={setActive}
                      showLabels={false} autoRotate={active === null} simple />
                  </div>
                  <aside className="lx-explorer__key" aria-label={t.lab.key}>
                    <span className="lx-panel__head"><span>{t.lab.key}</span><span className="lx-dim">{t.lab.parts}</span></span>
                    {t.key.map((k, i) => (
                      <div key={i} className={active === i + 1 ? 'lx-key is-active' : 'lx-key'}
                        onMouseEnter={() => setActive(i + 1)} onMouseLeave={() => setActive(null)}>
                        <i>{i + 1}</i><div><b>{k.title}</b><span>{k.text}</span></div>
                      </div>
                    ))}
                  </aside>
                </div>
              </AppWindow>
            </Figure>
          </div>
        </div>
      </section>

      <section className="lx-section" id="investigate">
        <div className="lx-wrap lx-pillar">
          <div data-reveal>
            {pillar('02', t.investigate)}
            <FeatureList items={t.investigate.features} icons={ICONS.investigate} />
          </div>
          <div data-reveal><Figure n="02" caption={t.investigate.caption}><InvestigationMock /></Figure></div>
        </div>
      </section>

      <section className="lx-section lx-section--alt" id="review">
        <div className="lx-wrap lx-pillar lx-pillar--flip">
          <div data-reveal>
            {pillar('03', t.review)}
            <FeatureList items={t.review.features} icons={ICONS.review} />
          </div>
          <div data-reveal><Figure n="03" caption={t.review.caption}><ReviewMock /></Figure></div>
        </div>
      </section>

      <section className="lx-section" id="verify">
        <div className="lx-wrap lx-pillar">
          <div data-reveal>
            {pillar('04', t.verify)}
            <FeatureList items={t.verify.features} icons={ICONS.verify} />
          </div>
          <div data-reveal><Figure n="04" caption={t.verify.caption}><VerifyMock /></Figure></div>
        </div>
      </section>

      <section className="lx-section lx-section--alt" id="chain">
        <div className="lx-wrap">
          <div className="lx-head" data-reveal>
            <Eyebrow>{t.chain.eyebrow}</Eyebrow>
            <h2>{t.chain.title}</h2>
            <p className="lx-lead">{t.chain.lead}</p>
          </div>
          <div className="lx-chain" data-reveal><ChainDiagram copy={t.chain.diagram} /></div>
        </div>
      </section>

      <section className="lx-section" id="benefits">
        <div className="lx-wrap">
          <div className="lx-head" data-reveal>
            <Eyebrow>{t.benefits.eyebrow}</Eyebrow>
            <h2>{t.benefits.title}</h2>
          </div>
          <div className="lx-cards">
            {t.benefits.items.map((b, i) => (
              <div key={i} className="lx-card" data-reveal>
                <span className="lx-icon lx-icon--accent"><Icon name={ICONS.benefits[i]} size={18} /></span>
                <h3>{b.title}</h3><p>{b.text}</p>
              </div>
            ))}
          </div>
          <div className="lx-principles" data-reveal>
            {t.benefits.principles.map((p, i) => (
              <div key={i}><Icon name="check" size={15} /><div><b>{p.title}</b><span>{p.text}</span></div></div>
            ))}
          </div>
        </div>
      </section>

      <section className="lx-section lx-section--alt" id="scope">
        <div className="lx-wrap">
          <div className="lx-head" data-reveal>
            <Eyebrow>{t.scope.eyebrow}</Eyebrow>
            <h2>{t.scope.title}</h2>
            <p className="lx-lead">{t.scope.lead}</p>
          </div>
          <div className="lx-scope">
            <div className="lx-scope__col" data-reveal>
              <span className="lx-scope__title"><span className="lx-icon lx-icon--accent"><Icon name="check" size={16} /></span>{t.scope.inTitle}</span>
              <ul>{t.scope.inItems.map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
            <div className="lx-scope__col lx-scope__col--out" data-reveal>
              <span className="lx-scope__title"><span className="lx-icon lx-icon--violet"><Icon name="x" size={16} /></span>{t.scope.outTitle}</span>
              <ul>{t.scope.outItems.map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
          </div>
        </div>
      </section>

      <section className="lx-section" id="guide">
        <div className="lx-wrap">
          <div className="lx-head" data-reveal>
            <Eyebrow>{t.guide.eyebrow}</Eyebrow>
            <h2>{t.guide.title}</h2>
            <p className="lx-lead">{t.guide.lead}</p>
          </div>
          <ol className="lx-steps">
            {t.guide.steps.map((st, i) => (
              <li key={i} data-reveal>
                <span className="lx-steps__n">{String(i + 1).padStart(2, '0')}</span>
                <div><b>{st.title}</b>{st.soon && <span className="lx-tag lx-tag--violet">{t.guide.soon}</span>}<p>{st.text}</p></div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="lx-section lx-section--alt" id="glossary">
        <div className="lx-wrap lx-glossary">
          <div className="lx-head" data-reveal>
            <Eyebrow>{t.glossary.eyebrow}</Eyebrow>
            <h2>{t.glossary.title}</h2>
          </div>
          <div className="lx-faq" data-reveal>
            {t.glossary.items.map((g) => (
              <details key={g.title}><summary>{g.title}<i /></summary><p>{g.text}</p></details>
            ))}
          </div>
        </div>
      </section>

      <section className="lx-cta">
        <div className="lx-wrap" data-reveal>
          <Eyebrow>{t.cta.eyebrow}</Eyebrow>
          <h2>{t.cta.title}</h2>
          <p className="lx-lead">{t.cta.lead}</p>
          <div className="lx-hero__cta">
            <button className="lx-btn lx-btn--primary" onClick={enter}>{enterLabel}<Icon name="arrow" size={16} /></button>
            <a className="lx-btn lx-btn--outline" href="https://zynplex.com" target="_blank" rel="noopener noreferrer">{t.cta.about}</a>
          </div>
        </div>
      </section>

      <footer className="lx-footer">
        <div className="lx-wrap lx-footer__grid">
          <div>
            <Brand size={22} />
            <p>{t.footer.tagline}</p>
            <ByZynplex />
          </div>
          <div><b>{t.footer.platform}</b>{FOOTER_LINKS.platform.map((h, i) => <a key={h} href={h}>{t.footer.links.platform[i]}</a>)}</div>
          <div><b>{t.footer.learn}</b>{FOOTER_LINKS.learn.map((h, i) => <a key={h} href={h}>{t.footer.links.learn[i]}</a>)}</div>
          <div><b>{t.footer.hackathon}</b><span>Meta Global AI Developer Hackathon 2026</span><span>{t.footer.track}</span></div>
        </div>
        <div className="lx-wrap lx-footer__base">
          <span>© 2026 Zynplex</span>
          <span className="lx-mono">{t.footer.simOnly}</span>
        </div>
      </footer>
    </div>
  )
}
