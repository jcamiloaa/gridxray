"""Printable end-of-investigation report (HTML), in the run's language."""

import re
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
        "how": "How this was scored", "vs_real": "connections recovered out of the real ones",
        "seal": "Sealed topology", "seal_text": "Published before the AI saw anything: SHA-256(secret + true topology).",
        "seal_ok": "Verified: the real network matches the seal.", "seal_bad": "Seal could not be verified.",
        "methods": "Tools the AI used", "crews": "Field crew visits",
        "crews_text": "Photo drawn by Muse Image from what is physically at the site, segmented by SAM 3.1 and read by Muse Spark. The investigator only received the reading.", "how_text": "An independent checker with no AI compares every proposed connection with "
               "the simulator's ground truth. The AI never saw the true topology: only equipment, records, meter readings "
               "and the results of its own experiments.", "none": "None", "rejected": "rejected",
        "incidents": "Field incidents during the investigation", "incidents_none": "No incidents: the network did not change while the AI investigated.",
        "incidents_text": "Faults and switching operations applied to the real network while the AI was working. The AI was never told: it had to notice them in its own readings.",
        "inc_switch": "Switching operation", "inc_meter": "Meter fault", "inc_outage": "Outage", "outage": "left without supply (not scored: nothing can be measured there)", "restored": "Supply restored", "now": "now", "open": "open", "closed": "closed",
        "meter_off": "meter offline (stopped reporting)", "detected": "Detected by the AI", "not_detected": "Not detected by the AI",
        "at": "at", "exp_n": "on experiment {n} after the change", "set_aside": "earlier experiments set aside",
        "shifts": "Largest voltage shifts", "how_seen": {"baseline": "the baseline readings moved", "repeated experiment": "a repeated experiment answered differently"},
        "inc_score": "The result is scored against the network as it ended; the original seal still verifies the network at the start.",
        "new_seal": "New commitment published at the change", "replan": "Planning agent re-planned",
        "replan_add": "added {n} experiment(s)", "replan_none": "no extra experiments needed", "replan_crew": "recommended a field crew", "incidents_kv": "Field incidents", "detected_kv": "Detected by the AI",
        "designed": "designed network", "plan": "Initial plan and planning agent", "plan_none": "The utility had no initial plan.",
        "plan_kinds": {"current": "up to date", "old": "old", "errors": "with errors"}, "drawn": "drawn on", "today": "today",
        "age": "age", "years": "years", "plan_acc": "Plan against the real network", "ai_acc": "GridXray's result",
        "trust": "Planner's trust in the plan", "budget_by": "Budget", "auto": "decided by the planning agent (autonomous)",
        "fixed": "set by the user", "not_on_plan": "substations not on the plan",
        "blind": "The AI was not told what kind of plan this is (up to date, old or with errors): it received only the drawing, the date it was drawn and today's date, and had to judge it from the evidence.",
        "chosen": "Chosen for this test", "aside": "set aside: the network changed afterwards",
        "kinds": {"tie": "tie", "sectionalizer": "sectionalizer", "recloser": "recloser", "fuse": "fuse"},
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
        "how": "Cómo se evaluó", "vs_real": "conexiones recuperadas de las reales",
        "seal": "Topología sellada", "seal_text": "Publicado antes de que la IA viera nada: SHA-256(secreto + topología real).",
        "seal_ok": "Verificado: la red real coincide con el sello.", "seal_bad": "No se pudo verificar el sello.",
        "methods": "Herramientas que usó la IA", "crews": "Visitas de cuadrilla",
        "crews_text": "Foto generada por Muse Image a partir de lo que hay físicamente en el sitio, segmentada por SAM 3.1 y leída por Muse Spark. El investigador solo recibió la lectura.", "how_text": "Un verificador independiente, sin IA, compara cada conexión propuesta con la verdad "
               "del simulador. La IA nunca vio la topología real: solo equipos, registros, lecturas de medidores y los "
               "resultados de sus propios experimentos.", "none": "Ninguna", "rejected": "rechazado",
        "incidents": "Incidencias en campo durante la investigación", "incidents_none": "Sin incidencias: la red no cambió mientras la IA investigaba.",
        "incidents_text": "Fallas y maniobras aplicadas a la red real mientras la IA trabajaba. La IA nunca fue avisada: tuvo que notarlas en sus propias lecturas.",
        "inc_switch": "Maniobra", "inc_meter": "Falla de medidor", "inc_outage": "Apagón", "outage": "quedaron sin energía (no se califican: allí no se puede medir)", "restored": "Energía restablecida", "now": "ahora", "open": "abierto", "closed": "cerrado",
        "meter_off": "medidor fuera de servicio (dejó de reportar)", "detected": "Detectada por la IA", "not_detected": "No detectada por la IA",
        "at": "a los", "exp_n": "en el experimento {n} después del cambio", "set_aside": "experimentos anteriores descartados",
        "shifts": "Mayores cambios de tensión", "how_seen": {"baseline": "las lecturas base se movieron", "repeated experiment": "un experimento repetido respondió distinto"},
        "inc_score": "El resultado se evalúa contra la red como quedó al final; el sello original sigue verificando la red del inicio.",
        "new_seal": "Nueva huella publicada en el cambio", "replan": "El agente planificador re-planificó",
        "replan_add": "agregó {n} experimento(s)", "replan_none": "no hicieron falta experimentos extra", "replan_crew": "recomendó enviar cuadrilla", "incidents_kv": "Incidencias en campo", "detected_kv": "Detectadas por la IA",
        "designed": "red diseñada", "plan": "Plano inicial y agente planificador", "plan_none": "La empresa no tenía plano inicial.",
        "plan_kinds": {"current": "actualizado", "old": "antiguo", "errors": "con errores"}, "drawn": "dibujado el", "today": "hoy",
        "age": "antigüedad", "years": "años", "plan_acc": "Plano contra la red real", "ai_acc": "Resultado de GridXray",
        "trust": "Confianza del planificador en el plano", "budget_by": "Presupuesto", "auto": "decidido por el agente planificador (autónomo)",
        "fixed": "fijado por el usuario", "not_on_plan": "subestaciones que no están en el plano",
        "blind": "A la IA no se le dijo qué tipo de plano era (actualizado, antiguo o con errores): recibió solo el dibujo, la fecha en que se dibujó y la fecha de hoy, y tuvo que juzgarlo con la evidencia.",
        "chosen": "Elegido para esta prueba", "aside": "descartado: la red cambió después",
        "kinds": {"tie": "enlace", "sectionalizer": "seccionador", "recloser": "reconectador", "fuse": "fusible"},
    },
}

def md(text: str) -> str:
    """Minimal markdown to HTML for model output (bold, italics, code, lists, paragraphs), escaped first."""
    text = re.sub(r"\\[()\[\]]", "", text or "")
    html, items, ordered = [], [], False

    def inline(s: str) -> str:
        s = escape(s)
        s = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", s)
        s = re.sub(r"`([^`]+)`", r"<code>\1</code>", s)
        return re.sub(r"(?<!\*)\*([^*\s][^*]*)\*(?!\*)", r"<i>\1</i>", s)

    def flush() -> None:
        nonlocal items
        if items:
            tag = "ol" if ordered else "ul"
            html.append(f"<{tag}>" + "".join(f"<li>{inline(i)}</li>" for i in items) + f"</{tag}>")
            items = []

    for raw in text.split("\n"):
        line = raw.strip()
        b = re.match(r"^[-*•]\s+(.*)", line)
        n = re.match(r"^\d+[.)]\s+(.*)", line)
        if b or n:
            if items and ordered != bool(n):
                flush()
            ordered = bool(n)
            items.append((b or n).group(1))
        else:
            flush()
            if line:
                html.append(f"<p>{inline(line.lstrip('#').strip())}</p>")
    flush()
    return "".join(html)


CSS = """
body{font-family:Inter,system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#1f2a37;margin:0;background:#f6f8fa}
main{max-width:920px;margin:0 auto;padding:32px 24px;background:#fff}
h1{font-size:26px;margin:0 0 4px}h2{font-size:17px;margin:28px 0 10px;border-bottom:2px solid #0e6e8c;padding-bottom:4px}
.brand{color:#0e6e8c;font-weight:800;letter-spacing:.08em;font-size:12px;text-transform:uppercase}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #e3e8ee;vertical-align:top}
th{background:#f0f3f6;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#5d6b7a}
.kv{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.kv div{background:#f0f3f6;border-radius:8px;padding:8px 10px}
.incident{border-left:4px solid #e9a23b;background:#fffaf2;border-radius:0 8px 8px 0;padding:8px 12px;margin:10px 0}
.incident ul{margin:4px 0 6px;padding-left:18px}.tag{display:inline-block;font-size:12px;font-weight:700;color:#fff;border-radius:999px;padding:1px 8px;margin-right:4px}
.tag.sw{background:#1f6fb2}.tag.fault{background:#b03030}.small{font-size:12px;color:#5d6b7a}.photo{width:100%;max-width:560px;border-radius:8px;display:block;margin:6px 0}.crew{margin:10px 0}
.kv b{display:block;font-size:18px}.kv span{font-size:11px;color:#5d6b7a}
.us td{font-weight:800;color:#0e6e8c}.ok{color:#0f7a53;font-weight:700}.bad{color:#c62828;font-weight:700}
.note{background:#f0f3f6;border-radius:8px;padding:10px 12px;font-size:13px}.big{font-size:40px;font-weight:800;color:#0e6e8c}
code{background:#f0f3f6;padding:2px 6px;border-radius:4px}.print{position:fixed;top:12px;right:12px}
@media print{body{background:#fff}main{padding:0}.print{display:none}}
"""


def _clock(sec: float) -> str:
    sec = int(sec or 0)
    return f"{sec // 60}:{sec % 60:02d}"


def network_name(source: str, t: dict) -> str:
    """A designed network shows its own name, not its database id."""
    if not source.startswith("custom:"):
        return source
    from gridxray.store.db import SessionLocal
    from gridxray.store.models import CustomGrid

    with SessionLocal() as db:
        row = db.get(CustomGrid, source.split(":", 1)[1])
    return f"{row.name} ({t['designed']})" if row else t["designed"]


def incidents_html(events: list[dict], t: dict) -> tuple[str, int, int]:
    """Faults and switching operations applied during the run, and whether the AI noticed each one."""
    e = escape
    ivs = [(i, ev) for i, ev in enumerate(events) if ev.get("kind") == "intervention"]
    if not ivs:
        return f"<h2>{t['incidents']}</h2><p class='note'>{t['incidents_none']}</p>", 0, 0
    out = [f"<h2>{t['incidents']}</h2><p class='note'>{t['incidents_text']}</p>"]
    detected = 0
    for n, (i, iv) in enumerate(ivs):
        end = ivs[n + 1][0] if n + 1 < len(ivs) else len(events)
        later = events[i + 1:end]
        seen = next((ev for ev in later if ev.get("kind") == "change_detected"), None)
        items = [f"<li><span class='tag sw'>⚡ {t['inc_switch']}</span> SW-{w['id']} ({e(t['kinds'].get(w.get('kind', ''), w.get('kind', '')))}, "
                 f"{e(' – '.join(w.get('between', [])))}): {t['now']} <b>{t['closed'] if w.get('closed') else t['open']}</b></li>"
                 for w in iv.get("switches", [])]
        items += [f"<li><span class='tag fault'>🔥 {t['inc_meter']}</span> {e(m)}: {t['meter_off']}</li>" for m in iv.get("meters_off", [])]
        if iv.get("outage"):
            items.append(f"<li><span class='tag fault'>⏻ {t['inc_outage']}</span> {e(', '.join(iv['outage']))}: {t['outage']}</li>")
        if iv.get("restored"):
            items.append(f"<li><span class='tag'>{t['restored']}</span> {e(', '.join(iv['restored']))}</li>")
        out.append(f"<div class='incident'><p><b>{_clock(iv.get('t', 0))}</b></p><ul>{''.join(items)}</ul>")
        if seen:
            detected += 1
            exps = sum(1 for ev in later[:later.index(seen) + 1] if ev.get("kind") == "experiment") + 1
            shifts = ", ".join(f"{e(k)} {v * 1000:+.2f} mpu" for k, v in list((seen.get("largest_shifts_pu") or {}).items())[:5])
            off = ", ".join(e(x) for x in seen.get("meters_offline") or [])
            out.append(f"<p class='ok'>✓ {t['detected']} {t['at']} {_clock(seen.get('t', 0))}, {t['exp_n'].format(n=exps)} · "
                       f"{seen.get('experiments_set_aside', 0)} {t['set_aside']}</p>"
                       + (f"<p>{t['shifts']}: {shifts}</p>" if shifts else "") + (f"<p>{e(off)}</p>" if off else ""))
            rp = next((ev for ev in later if ev.get("kind") == "replan"), None)
            if rp:
                d = rp.get("decision") or {}
                what = t["replan_add"].format(n=d.get("extra_experiments")) if d.get("extra_experiments") else t["replan_none"]
                out.append(f"<p><b>{t['replan']}:</b> {what} · {rp.get('budget')} {t['budget'].lower()}"
                           + (f" · {t['replan_crew']}" if d.get("send_crew") else "") + "</p>"
                           + (f"<p class='small'>{e(str(d.get('reasoning', '')))}</p>" if d.get("reasoning") else ""))
        else:
            out.append(f"<p class='bad'>✗ {t['not_detected']}</p>")
        if iv.get("commitment"):
            out.append(f"<p class='small'>{t['new_seal']}: <code>{e(iv['commitment'])}</code></p>")
        out.append("</div>")
    out.append(f"<p class='note'>{t['inc_score']}</p>")
    return "".join(out), len(ivs), detected


def plan_html(review: dict | None, s, g: dict | None, t: dict) -> str:
    """The utility's initial plan (kind, date, age), how right it was, and what the planning agent decided."""
    e = escape
    if review is None:
        return f"<h2>{t['plan']}</h2><p class='note'>{t['plan_none']}</p>"
    out = [f"<h2>{t['plan']}</h2>"]
    p, d = review.get("plan"), review.get("decision") or {}
    if p:
        from gridxray.agent.planner import true_parent

        truth = true_parent(s)
        correct = sum(1 for x in p["edges"] if truth.get(x["child"]) == x["parent"])
        out.append(f"<p class='note'><b>{t['blind']}</b></p>")
        out.append(f"<div class='kv'><div><b>{e(t['plan_kinds'].get(p['kind'], p['kind']))}</b><span>{t['chosen']}</span></div>"
                   f"<div><b>{e(p['drawn_on'])}</b><span>{t['drawn']} · {t['today']} {e(p['today'])}</span></div>"
                   f"<div><b>{p['age_years']} {t['years']}</b><span>{t['age']}</span></div>"
                   f"<div><b>{correct}/{len(truth)}</b><span>{t['plan_acc']}</span></div>"
                   + (f"<div><b>{g['correct_edges']}/{g['total_edges']}</b><span>{t['ai_acc']}</span></div>" if g else "")
                   + f"<div><b>{round(float(d.get('trust_in_plan', 0)) * 100)}%</b><span>{t['trust']}</span></div></div>")
        if p.get("missing"):
            out.append(f"<p>{len(p['missing'])} {t['not_on_plan']}: {e(', '.join(str(x) for x in p['missing']))}</p>")
    out.append(f"<p><b>{t['budget_by']}:</b> {review.get('budget')} · {t['auto'] if review.get('autonomous') else t['fixed']}</p>")
    if d.get("strategy") or d.get("reasoning"):
        out.append(f"<div class='note'>{md(str(d.get('reasoning', '')))}{md(str(d.get('strategy', '')))}</div>")
    return "".join(out)


def render(row, lang: str | None = None) -> str:
    lang = lang if lang in T else (row.language if getattr(row, "language", None) in T else "en")
    t = T[lang]
    e = escape
    events = row.events or []
    sc = row.score or {}
    g = sc.get("gridxray")
    from gridxray.runs import apply_interventions
    from gridxray.seal import canonical

    s = make_scenario(row.source, row.seed)
    initial_canonical = canonical(s)  # the seal covers the network at the start
    apply_interventions(s, events)  # verdicts use the network as it ended
    names = {n.id: n.name for n in s.observable().nodes} | {r: s.names[r] for r in s.roots}
    truth = {(min(a, b), max(a, b)) for a, b in s.true_edges}
    inc_html, n_inc, n_det = incidents_html(events, t)
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
               f"<div><b>{e(network_name(row.source, t))}</b><span>{t['network']}</span></div><div><b>{row.seed}</b><span>{t['seed']}</span></div>"
               f"<div><b>{row.budget}</b><span>{t['budget']}</span></div>"
               f"<div><b>{len(names) - len(s.roots)}</b><span>{t['child']}</span></div>"
               f"<div><b>{e(started.get('spark', '—'))}</b><span>{t['models']} · Spark</span></div>"
               f"<div><b>{e(started.get('wonder', '—'))}</b><span>{t['models']} · Wonder</span></div></div>")
    if g:
        out.append(f"<h2>{t['result']}</h2><p><span class='big'>{g['correct_edges']}/{g['total_edges']}</span> "
                   f"{t['vs_real']} · F1 {round(g['f1'] * 100)}% · {g['experiments']} {t['experiments'].lower()}</p>"
                   f"<div class='kv'><div><b>{g['correct_edges']}</b><span>{t['correct']}</span></div>"
                   f"<div><b>{g['wrong_edges']}</b><span>{t['wrong']}</span></div>"
                   f"<div><b>{g['wrong_and_flagged']}/{g['wrong_edges']}</b><span>{t['flagged']}</span></div>"
                   f"<div><b>{n_inc}</b><span>{t['incidents_kv']}</span></div>"
                   f"<div><b>{n_det}/{n_inc}</b><span>{t['detected_kv']}</span></div></div>")
    out.append(inc_html)
    review = next((ev for ev in events if ev.get("kind") == "plan_review"), None)
    out.append(plan_html(review, s, g, t))
    if result.get("summary"):
        out.append(f"<h2>{t['summary']}</h2><div class='note'>{md(result['summary'])}</div>")
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
    # experiments before the last detected change describe the old network and stopped counting
    last_change = max((i for i, ev in enumerate(events) if ev.get("kind") == "change_detected"), default=-1)
    stale = {id(ev) for ev in events[:last_change] if ev.get("kind") == "experiment" and ev.get("accepted")}
    if exps:
        out.append(f"<h2>{t['timeline']}</h2><table><tr><th>#</th><th>{t['node']}</th><th>{t['response']}</th></tr>")
        for ev in exps:
            a = ev.get("args", {})
            what = f"{a.get('delta_kw')} kW @ {a.get('node')}" if a.get("kind") == "perturb_load" else f"switch #{a.get('switch_id')}"
            top = ", ".join(f"{e(k)} {v * 1000:.2f}" for k, v in list((ev.get("drop_pu_per_mw") or {}).items())[:4])
            aside = f" · <span class='small'>{t['aside']}</span>" if id(ev) in stale else ""
            out.append(f"<tr><td>{ev.get('experiment') or '—'}</td><td>{e(what)}{'' if ev.get('accepted') else ' · ' + t['rejected']}{aside}</td>"
                       f"<td>{top or e(str(ev.get('message', '')))}</td></tr>")
        out.append("</table>")
    hyps = [ev for ev in events if ev.get("kind") == "hypothesis"]
    if hyps:
        out.append(f"<h2>{t['hyp']}</h2><table><tr><th>{t['hyp']}</th><th>{t['conf']}</th></tr>"
                   + "".join(f"<tr><td>{md(str(h.get('statement')))}</td><td>{round(float(h.get('confidence', 0)) * 100)}%</td></tr>" for h in hyps)
                   + "</table>")
    reviews = [ev for ev in events if ev.get("kind") == "review"]
    out.append(f"<h2>{t['reviews']}</h2>" + ("".join(f"<div class='note'><b>{e(str(r.get('trigger')))}</b>{md(str(r.get('advice')))}</div>" for r in reviews) or f"<p>{t['none']}</p>"))
    if usage.get("by_model"):
        out.append(f"<h2>{t['usage']}</h2><table><tr><th>{t['model']}</th><th>{t['tokens']}</th><th>{t['cost']}</th></tr>")
        for m, u in usage["by_model"].items():
            out.append(f"<tr><td>{e(m)}</td><td>{u['input']:,} / {u['output']:,} / {u['reasoning']:,}</td><td>${u['cost_usd']:.3f}</td></tr>")
        out.append(f"<tr class='us'><td>Total</td><td>{usage.get('tokens', 0):,}</td><td>${usage.get('cost_usd', 0):.3f}</td></tr></table>")
    sealed = next((ev for ev in events if ev.get("kind") == "sealed"), None)
    if sealed:
        from gridxray.seal import commitment

        ok = getattr(row, "seal_nonce", None) and commitment(row.seal_nonce, initial_canonical) == sealed.get("commitment")
        out.append(f"<h2>{t['seal']}</h2><p class='note'>{t['seal_text']}<br><code>{e(sealed.get('commitment', ''))}</code><br>"
                   f"<b class='{'ok' if ok else 'bad'}'>{t['seal_ok'] if ok else t['seal_bad']}</b></p>")
    used = sorted({ev.get("tool") for ev in events if ev.get("kind") == "tool_call"})
    out.append(f"<h2>{t['methods']}</h2><p>{', '.join(e(str(u)) for u in used) or t['none']}</p>")
    photos = {ev.get("visit"): ev for ev in events if ev.get("kind") == "field_photo"}
    readings = [ev for ev in events if ev.get("kind") == "field_reading"]
    if readings:
        out.append(f"<h2>{t['crews']}</h2><p class='note'>{t['crews_text']}</p>")
        for r in readings:
            ph = photos.get(r.get("visit"), {})
            rd = r.get("reading") or {}
            img = f"<img class='photo' src='media/{e(str(ph['media_id']))}' alt=''>" if ph.get("media_id") else ""
            fault = f"<br><b class='bad'>🔥 {e(str(r['fault']))}</b>" if r.get("fault") else ""
            out.append(f"<div class='crew'>{img}<p><b>{e(str(r.get('node')))}</b> · {e(str(rd.get('switch_tag') or ''))} "
                       f"{e(str(rd.get('switch_state') or ''))} · {e(str(r.get('record_check') or ''))}{fault}<br>"
                       f"<span class='note'>{e(str(rd.get('notes') or ''))}</span></p></div>")
    out.append(f"<h2>{t['how']}</h2><p class='note'>{t['how_text']}</p>"
               + ("" if row.source.startswith("custom:") else
                  f"<h2>{t['repro']}</h2><p><code>uv run gridxray investigate --level {e(row.source)} --seed {row.seed} --budget {row.budget}</code></p>") +
               "</main></body></html>")
    return "".join(out)
