import { useEffect, useState } from 'react'
import { metaKey, type MetaKeyStatus } from '../api/client'
import { useI18n } from '../i18n'

/**
 * The Meta API key for this account. A key saved here wins over META_API_KEY in backend/.env; it is
 * checked with Meta before saving, stored encrypted, and never shown again (only its last 4 characters).
 */
export function MetaKeySettings() {
  const { t } = useI18n()
  const [s, setS] = useState<MetaKeyStatus | null>(null)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  useEffect(() => { metaKey.status().then(setS, () => {}) }, [])

  async function act(fn: () => Promise<MetaKeyStatus>, ok: string) {
    setBusy(true); setMsg(null)
    try {
      setS(await fn()); setValue(''); setMsg({ ok: true, text: t(ok) })
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? t(e.message) : String(e) })
    } finally {
      setBusy(false)
    }
  }

  const label = !s ? '…' : s.source === 'app' ? `${t('Saved in the app')} (${s.hint})` : s.source === 'env' ? t('Configured in backend/.env') : t('Not configured')
  return (
    <section className={`meta-key${s && !s.configured ? ' meta-key--missing' : ''}`}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <b>{t('Meta API key')}</b>
        <span className={`pill ${s?.configured ? 'run-pill--done' : 'run-pill--failed'}`}>{label}</span>
      </div>
      <p className="muted">{t(s && !s.configured ? 'key.missing' : s?.source === 'app' ? 'key.app' : 'key.env')}</p>
      <form className="meta-key__form" onSubmit={(e) => { e.preventDefault(); if (value.trim()) act(() => metaKey.save(value.trim()), 'Key verified and saved.') }}>
        <input type="password" autoComplete="off" spellCheck={false} placeholder={t(s?.source === 'app' ? 'Replace the key' : 'Paste your Meta API key')}
          value={value} onChange={(e) => setValue(e.target.value)} aria-label={t('Meta API key')} />
        <button className="btn-primary" disabled={busy || value.trim().length < 8}>{busy ? t('Checking…') : t('Save')}</button>
      </form>
      {s?.source === 'app' && (
        <button className="btn-ghost" disabled={busy} onClick={() => act(metaKey.remove, s.env_configured ? 'Removed: using backend/.env again.' : 'Removed.')}>
          {t('Remove saved key')}
        </button>
      )}
      {msg && <p className={msg.ok ? 'meta-key__ok' : 'error'}>{msg.text}</p>}
    </section>
  )
}
