"""Printable end-of-investigation report (HTML), in the run's language."""

from datetime import datetime
from html import escape

from gridxray.runs import make_scenario

T = {
    "en": {
        "title": "GridXray investigation report", "scenario": "Scenario", "network": "Network", "seed": "Seed",
        "budget": "Experiment budget", "models": "Models", "status": "Status", "date": "Date",
        "result": "Verified result", "method": "Method", "correct": "Correct connections", "f1": "F1",
        "experiments": "Experiments", "wrong": "Wrong", "flagged": "Wrong but flagged uncertain",
        "summary": "Agent's conclusion", "connections": "Connections proposed by GridXray", "child": "Secondary substation",
        "parent": "Fed from", "verdict": "Verdict", "ok": "correct", "bad": "wrong", "missed": "Real connections not found",
        "timeline": "Experiments run", "node": "Action", "response": "Strongest responses (mpu/MW)", "hyp": "Hypotheses",
        "conf": "Confidence", "reviews": "Muse Wonder reviews", "usage": "Usage and cost", "model": "Model",
        "tokens": "Tokens (in / out / reasoning)", "cost": "Cost (USD)", "repro": "Reproduce",
        "how": "How this was scored", "how_text": "An independent checker with no AI compares every proposed connection with "
               "the simulator's ground truth. The AI never saw the true topology: only equipment, records, meter readings "
               "and the results of its own experiments.", "none": "None", "rejected": "rejected",
        "baselines": {"geographic": "Geographic (no experiments)", "passive": "Passive 24 h (no experiments)",
                      "heuristic": "Same budget, no AI", "exhaustive": "Exhaustive (one experiment per node)"},
    },
    "es": {
        "title": "Informe de investigación GridXray", "scenario": "Escenario", "network": "Red", "seed": "Semilla",
        "budget": "Presupuesto de experimentos", "models": "Modelos", "status": "Estado", "date": "Fecha",
        "result": "Resultado verificado", "method": "Método", "correct": "Conexiones correctas", "f1": "F1",
        "experiments": "Experimentos", "wrong": "Erróneas", "flagged": "Erróneas marcadas como inciertas",
        "summary": "Conclusión del agente", "connections": "Conexiones propuestas por GridXray", "child": "Centro de transformación",
        "parent": "Alimentado desde", "verdict": "Veredicto", "ok": "correcta", "bad": "errónea", "missed": "Conexiones reales no encontradas",
        "timeline": "Experimentos realizados", "node": "Acción", "response": "Respuestas más fuertes (mpu/MW)", "hyp": "Hipótesis",
        "conf": "Confianza", "reviews": "Revisiones de Muse Wonder", "usage": "Uso y costo", "model": "Modelo",
        "tokens": "Tokens (entrada / salida / razonamiento)", "cost": "Costo (USD)", "repro": "Reproducir",
        "how": "Cómo se evaluó", "how_text": "Un verificador independiente, sin IA, compara cada conexión propuesta con la verdad "
               "del simulador. La IA nunca vio la topología real: solo equipos, registros, lecturas de medidores y los "
               "resultados de sus propios experimentos.", "none": "Ninguna", "rejected": "rechazado",
        "baselines": {"geographic": "Geográfico (sin experimentos)", "passive": "Pasivo 24 h (sin experimentos)",
                      "heuristic": "Mismo presupuesto, sin IA", "exhaustive": "Exhaustivo (un experimento por nodo)"},
    },
}

CSS = """
body{font-family:Inter,system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#1f2a37;margin:0;background:#f6f8fa}
main{max-width:920px;margin:0 auto;padding:32px 24px;background:#fff}
h1{font-size:26px;margin:0 0 4px}h2{font-size:17px;margin:28px 0 10px;border-bottom:2px solid #0e6e8c;padding-bottom:4px}
.brand{color:#0e6e8c;font-weight:800;letter-spacing:.08em;font-size:12px;text-transform:uppercase}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #e3e8ee;vertical-align:top}
th{background:#f0f3f6;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#5d6b7a}
.kv{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.kv div{background:#f0f3f6;border-radius:8px;padding:8px 10px}
.kv b{display:block;font-size:18px}.kv span{font-size:11px;color:#5d6b7a}
.us td{font-weight:800;color:#0e6e8c}.ok{color:#0f7a53;font-weight:700}.bad{color:#c62828;font-weight:700}
.note{background:#f0f3f6;border-radius:8px;padding:10px 12px;font-size:13px}.big{font-size:40px;font-weight:800;color:#0e6e8c}
code{background:#f0f3f6;padding:2px 6px;border-radius:4px}.print{position:fixed;top:12px;right:12px}
@media print{body{background:#fff}main{padding:0}.print{display:none}}
"""


def render(row, lang: str | None = None) -> str:
    lang = lang if lang in T else (row.language if getattr(row, "language", None) in T else "en")
    t = T[lang]
    e = escape
    events = row.events or []
    sc = row.score or {}
    g = sc.get("gridxray")
    s = make_scenario(row.source, row.seed)
    names = {n.id: n.name for n in s.observable().nodes} | {r: s.names[r] for r in s.roots}
    truth = {(min(a, b), max(a, b)) for a, b in s.true_edges}
    final = next((ev for ev in reversed(events) if ev.get("kind") == "candidate" and ev.get("why") == "final proposal"), None)
    proposed = [(c["child"], c["parent"], c.get("basis")) for c in (final or {}).get("edges", [])]
    found = {(min(c, p), max(c, p)) for c, p, _ in proposed}
    missed = sorted(truth - found)
    started = next((ev for ev in events if ev.get("kind") == "started"), {})
    result = next((ev for ev in reversed(events) if ev.get("kind") == "result"), {})
    usage = sc.get("usage") or row.usage or {}

    out = [(f"<!doctype html><html lang='{lang}'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>"
           f"<title>{e(t['title'])}</title><style>{CSS}</style></head><body>"
           "<button class='print' onclick='window.print()'>Print / PDF</button><main>"
           f"<span class='brand'>GridXray · by Zynplex</span><h1>{e(t['title'])}</h1>"
           f"<p style='color:#5d6b7a;margin:0'>{e(t['date'])}: {e(str(getattr(row, 'created_at', '') or datetime.now()))[:19]} · ID {e(row.id[:12])}</p>")]
    out.append(f"<h2>{t['scenario']}</h2><div class='kv'>"
               f"<div><b>{e(row.source)}</b><span>{t['network']}</span></div><div><b>{row.seed}</b><span>{t['seed']}</span></div>"
               f"<div><b>{row.budget}</b><span>{t['budget']}</span></div>"
               f"<div><b>{len(names) - len(s.roots)}</b><span>{t['child']}</span></div>"
               f"<div><b>{e(started.get('spark', '—'))}</b><span>{t['models']} · Spark</span></div>"
               f"<div><b>{e(started.get('wonder', '—'))}</b><span>{t['models']} · Wonder</span></div></div>")
    if g:
        out.append(f"<h2>{t['result']}</h2><p><span class='big'>{g['f1']:.2f}</span> F1 · {g['correct_edges']}/{g['total_edges']} "
                   f"{t['correct'].lower()} · {g['experiments']} {t['experiments'].lower()}</p>"
                   f"<table><tr><th>{t['method']}</th><th>{t['correct']}</th><th>{t['f1']}</th><th>{t['experiments']}</th></tr>"
                   f"<tr class='us'><td>GridXray (Muse Spark + Muse Wonder)</td><td>{g['correct_edges']}/{g['total_edges']}</td><td>{g['f1']:.2f}</td><td>{g['experiments']}</td></tr>")
        for b in sc.get("baselines", []):
            out.append(f"<tr><td>{e(t['baselines'].get(b['name'], b['name']))}</td><td>{b['correct_edges']}/{b['total_edges']}</td>"
                       f"<td>{b['f1']:.2f}</td><td>{b['experiments']}</td></tr>")
        out.append(f"</table><p class='note'>{t['wrong']}: {g['wrong_edges']} · {t['flagged']}: {g['wrong_and_flagged']}/{g['uncertain_flagged']}</p>")
    if result.get("summary"):
        out.append(f"<h2>{t['summary']}</h2><p class='note'>{e(result['summary'])}</p>")
    if proposed:
        out.append(f"<h2>{t['connections']}</h2><table><tr><th>{t['child']}</th><th>{t['parent']}</th><th>{t['verdict']}</th></tr>")
        for c, p, basis in sorted(proposed, key=lambda x: names.get(x[0], "")):
            ok = (min(c, p), max(c, p)) in truth
            flag = " · ?" if basis == "uncertain" else ""
            out.append(f"<tr><td>{e(names.get(c, str(c)))}</td><td>{e(names.get(p, str(p)))}</td>"
                       f"<td class='{'ok' if ok else 'bad'}'>{t['ok'] if ok else t['bad']}{flag}</td></tr>")
        out.append("</table>")
        out.append(f"<p><b>{t['missed']}:</b> " + (", ".join(f"{e(names.get(a, str(a)))}–{e(names.get(b, str(b)))}" for a, b in missed) or t["none"]) + "</p>")
    exps = [ev for ev in events if ev.get("kind") == "experiment"]
    if exps:
        out.append(f"<h2>{t['timeline']}</h2><table><tr><th>#</th><th>{t['node']}</th><th>{t['response']}</th></tr>")
        for ev in exps:
            a = ev.get("args", {})
            what = f"{a.get('delta_kw')} kW @ {a.get('node')}" if a.get("kind") == "perturb_load" else f"switch #{a.get('switch_id')}"
            top = ", ".join(f"{e(k)} {v * 1000:.2f}" for k, v in list((ev.get("drop_pu_per_mw") or {}).items())[:4])
            out.append(f"<tr><td>{ev.get('experiment') or '—'}</td><td>{e(what)}{'' if ev.get('accepted') else ' · ' + t['rejected']}</td>"
                       f"<td>{top or e(str(ev.get('message', '')))}</td></tr>")
        out.append("</table>")
    hyps = [ev for ev in events if ev.get("kind") == "hypothesis"]
    if hyps:
        out.append(f"<h2>{t['hyp']}</h2><table><tr><th>{t['hyp']}</th><th>{t['conf']}</th></tr>"
                   + "".join(f"<tr><td>{e(str(h.get('statement')))}</td><td>{round(float(h.get('confidence', 0)) * 100)}%</td></tr>" for h in hyps)
                   + "</table>")
    reviews = [ev for ev in events if ev.get("kind") == "review"]
    out.append(f"<h2>{t['reviews']}</h2>" + ("".join(f"<p class='note'><b>{e(str(r.get('trigger')))}</b><br>{e(str(r.get('advice')))}</p>" for r in reviews) or f"<p>{t['none']}</p>"))
    if usage.get("by_model"):
        out.append(f"<h2>{t['usage']}</h2><table><tr><th>{t['model']}</th><th>{t['tokens']}</th><th>{t['cost']}</th></tr>")
        for m, u in usage["by_model"].items():
            out.append(f"<tr><td>{e(m)}</td><td>{u['input']:,} / {u['output']:,} / {u['reasoning']:,}</td><td>${u['cost_usd']:.3f}</td></tr>")
        out.append(f"<tr class='us'><td>Total</td><td>{usage.get('tokens', 0):,}</td><td>${usage.get('cost_usd', 0):.3f}</td></tr></table>")
    out.append(f"<h2>{t['how']}</h2><p class='note'>{t['how_text']}</p>"
               f"<h2>{t['repro']}</h2><p><code>uv run gridxray investigate --level {e(row.source)} --seed {row.seed} --budget {row.budget}</code></p>"
               "</main></body></html>")
    return "".join(out)
