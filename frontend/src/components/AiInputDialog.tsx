import type { RunEvent } from '../api/client'
import { useI18n } from '../i18n'

const json = (v: unknown) => JSON.stringify(v, null, 2)

/**
 * Everything the AI received in this run, verbatim: the first data it read, its instructions, the tools
 * it could call and every tool output. The true topology appears nowhere in it.
 */
export function AiInputDialog({ events, onClose }: { events: RunEvent[]; onClose: () => void }) {
  const { t } = useI18n()
  const sealed = events.find((e) => e.kind === 'sealed')
  const outputs = events.filter((e) => e.kind === 'tool_result')
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <section className="card ai-input" role="dialog" aria-modal="true" aria-label={t('What the AI receives')} onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div><span className="eyebrow">{t('Audit')}</span><h2>{t('What the AI receives')}</h2></div>
          <button className="btn-ghost" onClick={onClose} aria-label={t('Close')}>✕</button>
        </div>
        <p className="muted">{t('ai_input.intro')}</p>
        {(() => {
          const pr = events.find((e) => e.kind === 'plan_review')
          const plan = pr?.plan as { kind: string; drawn_on: string; age_years: number; edges: unknown[] } | null | undefined
          if (!pr) return null
          return (
            <div className="ai-input__plan">
              {plan ? (
                <p><b>{t('Initial plan')}:</b> {t('plan.blind').split('{n}').join(String(plan.edges.length)).split('{date}').join(plan.drawn_on)
                  .split('{age}').join(String(plan.age_years))} <b>{t('plan.blind.kind').split('{kind}').join(t(`plan.${plan.kind}`))}</b></p>
              ) : <p>{t('No initial plan: the investigation starts from the meters alone.')}</p>}
              <details>
                <summary>{t('What the planning agent received')}</summary>
                <pre>{json(pr.planner_input)}</pre>
              </details>
            </div>
          )
        })()}
        {sealed && (
          <>
            <details open>
              <summary>{t('Initial data (get_overview)')}</summary>
              <pre>{json(sealed.ai_input)}</pre>
            </details>
            <details>
              <summary>{t('Instructions given to Muse Spark')}</summary>
              <pre>{String(sealed.instructions)}</pre>
            </details>
            <details>
              <summary>{t('Tools it can call')} · {(sealed.tools as string[]).length}</summary>
              <p>{(sealed.tools as string[]).join(', ')}</p>
            </details>
          </>
        )}
        <details>
          <summary>{t('Every tool output')} · {outputs.length}</summary>
          {outputs.map((o, i) => (
            <details key={i} className="ai-input__out">
              <summary>#{i + 1} · {String(o.tool)}</summary>
              <pre>{json(o.output)}</pre>
            </details>
          ))}
        </details>
      </section>
    </div>
  )
}
