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
.photo{width:100%;max-width:560px;border-radius:8px;display:block;margin:6px 0}.crew{margin:10px 0}
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
        out.append(f"<h2>{t['result']}</h2><p><span class='big'>{g['correct_edges']}/{g['total_edges']}</span> "
                   f"{t['vs_real']} · F1 {g['f1']:.2f} · {g['experiments']} {t['experiments'].lower()}</p>"
                   f"<div class='kv'><div><b>{g['correct_edges']}</b><span>{t['correct']}</span></div>"
                   f"<div><b>{g['wrong_edges']}</b><span>{t['wrong']}</span></div>"
                   f"<div><b>{g['wrong_and_flagged']}/{g['wrong_edges']}</b><span>{t['flagged']}</span></div></div>")
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
        from gridxray.seal import canonical, commitment

        ok = getattr(row, "seal_nonce", None) and commitment(row.seal_nonce, canonical(s)) == sealed.get("commitment")
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
            out.append(f"<div class='crew'>{img}<p><b>{e(str(r.get('node')))}</b> · {e(str(rd.get('switch_tag') or ''))} "
                       f"{e(str(rd.get('switch_state') or ''))} · {e(str(r.get('record_check') or ''))}<br>"
                       f"<span class='note'>{e(str(rd.get('notes') or ''))}</span></p></div>")
    out.append(f"<h2>{t['how']}</h2><p class='note'>{t['how_text']}</p>"
               f"<h2>{t['repro']}</h2><p><code>uv run gridxray investigate --level {e(row.source)} --seed {row.seed} --budget {row.budget}</code></p>"
               "</main></body></html>")
    return "".join(out)
