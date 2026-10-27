import { useEffect, useState } from 'react'
import { getUsage, type UsageReport } from '../api/client'
import { LanguageToggle, useI18n } from '../i18n'

const fmt = (n: number) => n.toLocaleString()

/** Settings and usage: language, tokens per model and the cost of this session's investigations. */
export function UsageDrawer({ onClose }: { onClose: () => void }) {
  const { t } = useI18n()
  const [u, setU] = useState<UsageReport | null>(null)
  useEffect(() => {
    const load = () => getUsage().then(setU, () => {})
    load()
    const id = setInterval(load, 5000)
    return () => clearInterval(id)
  }, [])
  return (
    <div className="dialog-backdrop" style={{ placeItems: 'stretch end', padding: 0 }} onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()} aria-label={t('Usage & settings')}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>{t('Usage & settings')}</h2>
          <button className="btn-ghost" onClick={onClose} aria-label={t('Close')}>✕</button>
        </div>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <b>{t('Language')}</b><LanguageToggle />
        </div>
        <h3 style={{ fontSize: '1rem', marginTop: 8 }}>{t('Session usage')}</h3>
        <div className="stats">
          <div className="stat"><b>{u?.runs ?? '—'}</b><span>{t('Investigations')}</span></div>
          <div className="stat"><b>{u ? `$${u.cost_usd.toFixed(3)}` : '—'}</b><span>{t('Total cost')}</span></div>
          <div className="stat"><b>{u ? `${Math.round(u.tokens / 1000)}k` : '—'}</b><span>{t('Tokens')}</span></div>
          <div className="stat"><b>{u ? Object.values(u.by_model).reduce((s, m) => s + m.calls, 0) : '—'}</b><span>{t('Calls')}</span></div>
        </div>
        {u && (
          <table className="usage-table">
            <thead><tr><th>{t('Model')}</th><th>{t('Input')}</th><th>{t('Output')}</th><th>{t('Reasoning')}</th><th>{t('Cost')}</th></tr></thead>
            <tbody>
              {Object.entries(u.by_model).map(([m, v]) => (
                <tr key={m}><td>{m}</td><td>{fmt(v.input)}</td><td>{fmt(v.output)}</td><td>{fmt(v.reasoning)}</td><td>${v.cost_usd.toFixed(3)}</td></tr>
              ))}
            </tbody>
          </table>
        )}
        <h3 style={{ fontSize: '1rem', marginTop: 8 }}>{t('Prices (USD per 1M tokens, Standard mode)')}</h3>
        {u && (
          <table className="usage-table">
            <thead><tr><th>{t('Model')}</th><th>{t('Input')}</th><th>{t('Cached input')}</th><th>{t('Output')}</th></tr></thead>
            <tbody>
              {[u.models.spark, u.models.wonder].map((m) => u.prices[m] && (
                <tr key={m}><td>{m}</td><td>${u.prices[m].input}</td><td>${u.prices[m].cached_input}</td><td>${u.prices[m].output}</td></tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="explain">{t('usage.note')}</p>
      </aside>
    </div>
  )
}
