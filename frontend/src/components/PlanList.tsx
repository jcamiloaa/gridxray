import type { InitialPlan, ObservableScenario, Truth } from '../api/client'
import { useI18n } from '../i18n'

/**
 * The initial plan as a list of drawn connections. With the real network revealed, each one is checked:
 * a drawing "with errors" or "old" shows exactly where it is wrong.
 */
export function PlanList({ plan, scenario, truth }: { plan: InitialPlan; scenario: ObservableScenario | null; truth: Truth | null }) {
  const { t } = useI18n()
  const name = (id: number) => scenario?.nodes.find((n) => n.id === id)?.name ?? scenario?.substations.find((s) => s.id === id)?.name ?? String(id)
  const real = new Set((truth?.edges ?? []).map(([a, b]) => (a < b ? `${a}-${b}` : `${b}-${a}`)))
  const ok = (c: number, p: number) => real.has(c < p ? `${c}-${p}` : `${p}-${c}`)
  const wrong = truth ? plan.edges.filter(([c, p]) => !ok(c, p)).length : 0
  const rows = [...plan.edges].sort((a, b) => name(a[0]).localeCompare(name(b[0])))
  return (
    <details className="plan-list">
      <summary>
        {t('Connections on the plan')} ({plan.edges.length})
        {truth && <b className={wrong || plan.missing.length ? 'plan-list__bad' : 'plan-list__ok'}>
          {' · '}{wrong ? `${wrong} ${t('of')} ${plan.edges.length} ${t('do not match the real network')}` : t('all match the real network')}
          {plan.missing.length ? ` · ${plan.missing.length} ${t('missing')}` : ''}</b>}
      </summary>
      <ul>
        {rows.map(([c, p]) => (
          <li key={c} className={truth ? (ok(c, p) ? 'is-ok' : 'is-bad') : ''}>
            {truth && <span>{ok(c, p) ? '✓' : '✗'}</span>}{name(c)} ← {name(p)}
          </li>
        ))}
        {plan.missing.map((m) => <li key={`m${m}`} className="is-missing">{name(m)}: {t('not on the plan')}</li>)}
      </ul>
      {!truth && <small className="muted">{t('Reveal the real network to check the plan.')}</small>}
    </details>
  )
}
