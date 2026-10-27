import type { User } from '../api/client'
import { Brand, ByZynplex } from '../components/Brand'
import { EvidenceView } from '../components/EvidenceView'
import { LanguageToggle, useI18n } from '../i18n'

/** Signed-in page: everything a judge needs to verify GridXray's results. */
export function EvidencePage({ user, onHome, onOpenWorkspace, onSignIn }: {
  user: User | null; onHome: () => void; onOpenWorkspace: () => void; onSignIn: () => void
}) {
  const { t } = useI18n()
  return (
    <div className="evidence-shell">
      <header className="topbar">
        <span className="row" style={{ gap: 10 }}>
          <button className="btn-ghost" onClick={onHome} aria-label="GridXray home" style={{ padding: 4 }}><Brand /></button>
          <ByZynplex />
        </span>
        <div className="topbar__actions">
          <LanguageToggle />
          <button className="btn-ghost" onClick={onHome}>{t('Home')}</button>
          <button className="btn-primary" onClick={user ? onOpenWorkspace : onSignIn}>{user ? t('Open workspace') : t('Try the demo')}</button>
        </div>
      </header>
      <EvidenceView page />
    </div>
  )
}
