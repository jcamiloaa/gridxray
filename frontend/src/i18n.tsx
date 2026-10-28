import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

export type Lang = 'en' | 'es'

const ES: Record<string, string> = {
  // header / stepper
  'Build a grid': 'Construir la red', Investigate: 'Investigar', 'Reveal & compare': 'Revelar y comparar',
  Guide: 'Guía', 'Sign out': 'Cerrar sesión', Runs: 'Corridas', 'Usage & settings': 'Uso y ajustes',
  // build panel
  '1 · Build a grid': '1 · Construir la red', 'Synthetic networks': 'Redes sintéticas', 'Published benchmarks': 'Redes de referencia publicadas',
  Easy: 'Fácil', Medium: 'Media', Hard: 'Difícil',
  '15 substations · 1 feeder · every point metered': '15 subestaciones · 1 alimentador · todo medido',
  '30 substations · 2 feeders + tie · some readings missing': '30 subestaciones · 2 alimentadores + enlace · faltan lecturas',
  '60 substations · 4 feeders · faulty meter · outdated records': '60 subestaciones · 4 alimentadores · medidor defectuoso · registros desactualizados',
  'International reference network · 12 substations': 'Red de referencia internacional · 12 subestaciones',
  'Real-world-sized German network · 175 substations': 'Red alemana de tamaño real · 175 subestaciones',
  'Scenario seed': 'Semilla del escenario', 'Solving power flow…': 'Resolviendo flujo de carga…',
  'Generate a new grid': 'Generar otra red', 'Generate grid': 'Generar red',
  'build.info': 'Crea una red virtual de media tensión y resuelve su flujo de carga. El cableado entre subestaciones queda oculto para la IA: es justo lo que tendrá que descubrir.',
  'seed.info': 'La misma semilla siempre produce la misma red, así cualquier resultado se puede reproducir.',
  'What the AI knows': 'Lo que sabe la IA', 'Secondary substations': 'Centros de transformación', 'Smart meters': 'Medidores inteligentes',
  'Missing readings': 'Lecturas faltantes', Switches: 'Interruptores',
  'knows.info': 'El lado observable de la red: equipos, registros y lecturas de medidores en la hora pico. Nunca el cableado.',
  'missing.info': 'Medidores que no reportaron en esta lectura, como pasa en redes reales.',
  'Preview the real network': 'Ver la red real', 'Hide true network': 'Ocultar la red real', 'Reveal true network (spoiler)': 'Revelar la red real (spoiler)',
  'reveal.info': 'Muestra el cableado real que la IA debe descubrir: líneas aéreas, cables subterráneos, interruptores, reconectadores, fusibles, condensadores y plantas solares.',
  // investigate
  '2 · Investigate': '2 · Investigar', 'Build a grid first.': 'Primero construye una red.',
  'investigate.info': 'Muse Spark investiga el cableado oculto: formula hipótesis, corre experimentos virtuales en el simulador físico y reconstruye la red. Muse Wonder revisa la evidencia cuando Spark se atasca. Usa modelos reales de Meta y tarda unos minutos.',
  'Experiment budget': 'Presupuesto de experimentos', experiments: 'experimentos',
  'budget.info': 'Cuántos experimentos virtuales puede correr la IA. Sondear cada subestación requeriría uno por subestación; GridXray combina experimentos con datos pasivos para necesitar menos.',
  'Investigating…': 'Investigando…', 'Start investigation': 'Iniciar investigación', 'Run again': 'Correr de nuevo',
  Stop: 'Detener', Resume: 'Reanudar', Experiments: 'Experimentos',
  'Verified result': 'Resultado verificado', Method: 'Método', Correct: 'Correctas', 'Exp.': 'Exp.',
  'Scored by an independent checker with no AI involved.': 'Evaluado por un verificador independiente, sin IA.',
  wrong: 'erróneas', 'flagged as uncertain': 'marcadas como inciertas', steps: 'pasos', 'Wonder reviews': 'revisiones de Wonder',
  'Compared with the real network': 'Comparado con la red real',
  // stage
  'Investigation log': 'Registro de la investigación', correct: 'correcta', missed: 'faltante',
  'confirmed by experiments': 'confirmada por experimentos', inferred: 'inferida',
  running: 'en curso', done: 'terminada', failed: 'fallida', stopped: 'detenida', idle: 'inactiva',
  'True network revealed.': 'Red real revelada.', 'reveal.note': 'Líneas, cables y equipos como son en realidad. La IA nunca ve esta vista.',
  'Connections are hidden.': 'Las conexiones están ocultas.', 'hidden.note': 'Ves dónde están los equipos, no cómo están conectados: eso es lo que descubrirá la IA.',
  Lines: 'Líneas', 'Overhead line (on poles)': 'Línea aérea (en postes)', 'Underground cable': 'Cable subterráneo',
  'Open point (tie / open switch)': 'Punto abierto (enlace / interruptor abierto)', 'Meter readings': 'Lecturas de medidores',
  Nominal: 'Nominal', 'Low, within limits': 'Baja, dentro de norma', 'Outside limits': 'Fuera de norma',
  'Missing reading': 'Lectura faltante', 'No meter installed': 'Sin medidor',
  'kiosk.note': 'Cada centro de transformación representa las casas y comercios que alimenta. Haz clic en uno para ver su medidor.',
  'Hide labels': 'Ocultar etiquetas', 'Show labels': 'Mostrar etiquetas',
  'Start by building a grid': 'Empieza construyendo una red',
  'empty.text': 'Elige una red a la izquierda y presiona Generar red. La verás en 3D con la lectura de cada medidor. El cableado queda oculto: ese es el trabajo de la IA.',
  // node detail
  'Pole-mounted transformer': 'Transformador de poste', 'Ground-mounted kiosk': 'Caseta a nivel de piso',
  Voltage: 'Tensión', 'Active power': 'Potencia activa', 'Reactive power': 'Potencia reactiva', 'Customer type': 'Tipo de cliente',
  'Capacitor bank': 'Banco de condensadores', 'Solar plant': 'Planta solar',
  'meter.missing': 'Este medidor no reportó en esta lectura. La IA tiene que razonar sin ese dato.',
  'meter.none': 'Aquí no hay medidor, así que no hay lectura directa. La IA solo puede inferir sus conexiones a partir de sus vecinos y de experimentos.',
  'meter.explain': 'La tensión está al {pct}% de la nominal. Cuanto más lejos y más cargado el camino desde la subestación, más baja: una pista de dónde está este nodo en la red.',
  // timeline
  'Investigation started': 'Investigación iniciada', 'secondary substations': 'centros de transformación', budget: 'presupuesto',
  'Reads what the utility knows': 'Lee lo que sabe la utility', 'Reviews the evidence so far': 'Revisa la evidencia hasta ahora',
  'Builds a candidate topology': 'Arma una topología candidata', 'Checks a hypothesis against the physics': 'Contrasta una hipótesis con la física',
  'Looks for the experiment that separates two hypotheses': 'Busca el experimento que separa dos hipótesis',
  'Asks Muse Wonder for a second opinion': 'Pide una segunda opinión a Muse Wonder',
  'Ranks the most informative next experiments': 'Ordena los próximos experimentos más informativos',
  Experiment: 'Experimento', rejected: 'rechazado', 'Strongest response': 'Respuesta más fuerte', 'Budget left': 'Presupuesto restante',
  'operate switch': 'operar interruptor', at: 'en', Hypothesis: 'Hipótesis', Confidence: 'Confianza',
  'Muse Wonder is reviewing the evidence': 'Muse Wonder está revisando la evidencia',
  'Muse Wonder · second opinion': 'Muse Wonder · segunda opinión', 'Result submitted': 'Resultado entregado',
  'Muse Spark is thinking…': 'Muse Spark está pensando…',
  // progress
  'Progress': 'Avance', 'Reconstruction': 'Reconstrucción', confirmed: 'confirmadas', 'Latest confidence': 'Última confianza',
  'Tokens': 'Tokens', 'Cost': 'Costo', 'Experiment budget used': 'Presupuesto de experimentos usado',
  // runs drawer
  'Your investigations': 'Tus investigaciones', 'runs.empty': 'Todavía no hay investigaciones en esta sesión.',
  Open: 'Abrir', Network: 'Red', Status: 'Estado', Seed: 'Semilla',
  'runs.note': 'Las investigaciones siguen corriendo en el servidor aunque cierres el navegador, y se reanudan solas si el servicio se reinicia.',
  // usage drawer
  'Session usage': 'Uso de la sesión', Investigations: 'Investigaciones', 'Total cost': 'Costo total', Model: 'Modelo',
  Input: 'Entrada', 'Cached input': 'Entrada en caché', Output: 'Salida', Reasoning: 'Razonamiento', Calls: 'Llamadas',
  'Prices (USD per 1M tokens, Standard mode)': 'Precios (USD por millón de tokens, modo Standard)',
  Language: 'Idioma', 'usage.note': 'Costos calculados con los precios publicados de la Meta Model API. El razonamiento se cobra como salida.',
  Close: 'Cerrar', 'No reading': 'Sin lectura', geographic: 'geográfico', passive: 'pasivo', exhaustive: 'exhaustivo',
  // evidence + report
  Evidence: 'Evidencia', 'Drag to resize': 'Arrastra para cambiar el tamaño', 'correct connections': 'conexiones correctas',
  'Compare with the real network': 'Comparar con la red real', 'Show the real network': 'Ver la red real', Node: 'Nodo',
  'AI said': 'La IA dijo', Real: 'Real',
  'compare.note': 'Verde = la IA acertó el padre. Rojo = se equivocó (se muestra el padre real). "?" = la IA lo marcó como incierto. En el mapa: verde correcta, rojo errónea, gris faltante.', Home: 'Inicio', 'Open workspace': 'Abrir espacio de trabajo', 'Try the demo': 'Probar la demo', 'For the judges': 'Para los jueces', 'Download report': 'Descargar informe', Report: 'Informe',
  'Benchmark: real investigations with Muse Spark + Muse Wonder': 'Benchmark: investigaciones reales con Muse Spark + Muse Wonder',
  'bench.intro': 'Cada fila resume investigaciones reales, puntuadas contra la red real oculta en el simulador por un verificador sin IA. GridXray combina física, IA tradicional, geografía e IA de Meta.',
  'bench.honest': 'Lectura honesta: en redes pequeñas recupera el 84 % de las conexiones reales (una red completa, 15/15); en redes medianas, el 66 %. Cerca de la mitad de sus errores en redes medianas los marca como inciertos; muchos están en nodos sin medidor. Estos números se actualizan con cada benchmark.',
  runs: 'corridas', 'exp.': 'exp.', Calibration: 'Calibración', 'of wrong connections flagged as uncertain': 'de las conexiones erróneas marcadas como inciertas',
  'Every run': 'Todas las corridas', Level: 'Nivel', Reviews: 'Revisiones', Time: 'Tiempo',
  'How results are scored': 'Cómo se puntúan los resultados', 'Guarantees, each backed by a test': 'Garantías, cada una respaldada por un test',
  'Automated tests': 'Tests automáticos', passing: 'pasan', 'No test results yet.': 'Aún no hay resultados de tests.',
  'Investigations run on this server': 'Investigaciones realizadas en este servidor',
  'Same budget, no AI': 'Mismo presupuesto, sin IA', Exhaustive: 'Exhaustivo', Passive: 'Pasivo', Geographic: 'Geográfico',
  'The AI never sees the true topology': 'La IA nunca ve la topología real', 'Scores are computed without any AI': 'Los puntajes se calculan sin IA',
  'Experiments respect physics and operating limits': 'Los experimentos respetan la física y los límites de operación',
  'Real Meta models, no scripted answers': 'Modelos reales de Meta, sin respuestas guionadas', 'Investigations survive restarts': 'Las investigaciones sobreviven a reinicios',
  'Scenarios are physically consistent and reproducible': 'Los escenarios son físicamente coherentes y reproducibles',
  'Virtual lab': 'Laboratorio virtual', 'Experiments, tools and agent': 'Experimentos, herramientas y agente', 'Live investigations API': 'API de investigaciones en vivo',
  Authentication: 'Autenticación', Scoring: 'Puntuación',
  // seal + audit + hybrid method
  'Topology sealed before the AI starts': 'Topología sellada antes de que empiece la IA',
  'seal.text': 'Antes de que la IA vea nada, el servidor publica la huella SHA-256 de (secreto + topología real). Al terminar se revela el secreto y tu navegador recalcula la huella: si coincide, la red estaba fijada de antemano y la IA nunca la vio.',
  'See what the AI receives': 'Ver lo que recibe la IA', 'What the AI receives': 'Lo que recibe la IA', Audit: 'Auditoría',
  'ai_input.intro': 'Todo lo que recibió la IA en esta corrida, tal cual: los datos iniciales, sus instrucciones, las herramientas disponibles y cada salida de herramienta. La topología real no aparece en ninguna parte.',
  'Initial data (get_overview)': 'Datos iniciales (get_overview)', 'Instructions given to Muse Spark': 'Instrucciones dadas a Muse Spark',
  'Tools it can call': 'Herramientas que puede usar', 'Every tool output': 'Todas las salidas de herramientas',
  'Muse Wonder · topology inferred from the data': 'Muse Wonder · topología inferida de los datos', 'nodes answered': 'nodos respondidos',
  'flagged uncertain': 'marcados como inciertos', 'one vote in the ensemble': 'un voto en el ensamble',
  'Traditional AI: clusters 24 h meter correlations into feeders and a tree': 'IA tradicional: agrupa las correlaciones de 24 h de los medidores en alimentadores y un árbol',
  'Geography: builds a prior from GIS blocks and voltages': 'Geografía: arma una hipótesis previa con las manzanas del GIS y los voltajes',
  'Ensemble: compares physics, correlation, geography and Meta AI': 'Ensamble: compara física, correlación, geografía e IA de Meta',
  'Asks Muse Wonder to infer the topology from the raw data': 'Pide a Muse Wonder inferir la topología a partir de los datos crudos',
  'Against the real network': 'Contra la red real', 'Scored against the real network by an independent checker with no AI involved.': 'Puntuado contra la red real por un verificador independiente, sin IA.',
  'real connections recovered': 'conexiones reales recuperadas', 'Real connections recovered': 'Conexiones reales recuperadas',
  'Wrong, flagged as uncertain': 'Erróneas marcadas como inciertas', Wrong: 'Erróneas', Flagged: 'Marcadas',
  'Checking the seal…': 'Verificando el sello…', 'Seal not checked': 'Sello no verificado', 'Seal verified in your browser': 'Sello verificado en tu navegador',
  'Seal does not match': 'El sello no coincide', published: 'publicado', recomputed: 'recalculado',
  'seal.verify': 'Tu navegador recalculó SHA-256(secreto + red revelada) y lo comparó con la huella publicada antes de que la IA empezara.',
  'The sealed topology differs from the revealed one.': 'La topología sellada difiere de la revelada.',
  'This investigation predates sealing.': 'Esta investigación es anterior al sellado.',
  'This browser cannot compute SHA-256 here (needs HTTPS or localhost).': 'Este navegador no puede calcular SHA-256 aquí (requiere HTTPS o localhost).',
  'The topology is sealed before every investigation': 'La topología se sella antes de cada investigación',
  'Physics (non-AI)': 'Física (sin IA)', 'Traditional AI': 'IA tradicional', 'Geography (non-AI)': 'Geografía (sin IA)', 'Meta AI': 'IA de Meta',
  // guide
  'How to use the workspace': 'Cómo usar el área de trabajo',
}

const LangContext = createContext<{ lang: Lang; setLang: (l: Lang) => void; t: (key: string, vars?: Record<string, string | number>) => string }>({
  lang: 'en', setLang: () => {}, t: (k) => EN_LONG[k] ?? k,
})

const EN_LONG: Record<string, string> = {
  'build.info': 'Creates a virtual medium-voltage network and solves its power flow. The wiring between substations is hidden from the AI, exactly what it will have to discover.',
  'seed.info': 'The same seed always produces the same network, so any result can be reproduced.',
  'knows.info': 'The observable side of the network: equipment, records and meter readings at the evening peak. Never the wiring.',
  'missing.info': 'Meters that failed to report in this snapshot, as happens in real networks.',
  'reveal.info': 'Shows the true wiring that the AI must discover: overhead lines, underground cables, switches, reclosers, fuses, capacitors and solar plants. A spoiler, useful to explore the scenario.',
  'investigate.info': 'Muse Spark investigates the hidden wiring: it forms hypotheses, runs virtual experiments on the physics simulator and reconstructs the network. Muse Wonder reviews the evidence when Spark is stuck. Each run uses real Meta models and takes a few minutes.',
  'budget.info': 'How many virtual experiments the AI may run. Probing every substation would need one per substation; GridXray combines experiments with passive data to need fewer.',
  'reveal.note': 'Lines, cables and equipment as they really are. The AI never sees this view.',
  'hidden.note': 'You see where equipment is, not how it is wired: that is what the AI will discover.',
  'kiosk.note': 'Each kiosk stands for the homes and shops it supplies. Click one to read its meter.',
  'empty.text': "Pick a network on the left and press Generate grid. You'll see it in 3D, with every meter's reading. The wiring stays hidden: that is the AI's job.",
  'meter.missing': 'This meter did not report in this snapshot. The AI has to reason around the gap.',
  'meter.none': "No smart meter here, so there is no direct reading. The AI can only infer this substation's connections from its neighbours and from experiments.",
  'meter.explain': 'Voltage is {pct}% of nominal. The further and more loaded the path from the substation, the lower it gets: a clue to where this kiosk sits in the network.',
  'runs.empty': 'No investigations in this session yet.',
  'runs.note': 'Investigations keep running on the server even if you close the browser, and resume on their own if the service restarts.',
  'usage.note': "Costs computed with the Meta Model API's published prices. Reasoning tokens are billed as output.",
  'compare.note': 'Green = the AI found the right parent. Red = it was wrong (the real parent is shown). "?" = the AI flagged it as uncertain. On the map: green correct, red wrong, grey missed.',
  'bench.intro': 'Each row summarizes real investigations, scored against the real network hidden in the simulator by a checker with no AI. GridXray combines physics, traditional AI, geography and Meta AI.',
  'bench.honest': 'Honest reading: on small networks it recovers 84% of the real connections (one network fully, 15/15); on medium networks, 66%. About half of its errors on medium networks are flagged as uncertain; many sit on unmetered nodes. These numbers update with every benchmark.',
  'seal.text': 'Before the AI sees anything, the server publishes the SHA-256 fingerprint of (secret + true topology). When the run ends the secret is revealed and your browser recomputes it: a match proves the network was fixed beforehand and the AI never saw it.',
  'ai_input.intro': 'Everything the AI received in this run, verbatim: the initial data, its instructions, the tools available and every tool output. The true topology appears nowhere in it.',
  'seal.verify': 'Your browser recomputed SHA-256(secret + revealed network) and compared it with the fingerprint published before the AI started.',
}

function read(): Lang {
  try {
    return localStorage.getItem('gridxray.lang') === 'es' ? 'es' : 'en'
  } catch {
    return 'en'
  }
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(read)
  const setLang = useCallback((l: Lang) => {
    setLangState(l)
    try { localStorage.setItem('gridxray.lang', l) } catch { /* per-viewer convenience only */ }
  }, [])
  const t = useCallback((key: string, vars?: Record<string, string | number>) => {
    let s = (lang === 'es' ? ES[key] : undefined) ?? EN_LONG[key] ?? key
    for (const [k, v] of Object.entries(vars ?? {})) s = s.replace(`{${k}}`, String(v))
    return s
  }, [lang])
  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t])
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export const useI18n = () => useContext(LangContext)

export function LanguageToggle() {
  const { lang, setLang } = useI18n()
  return (
    <div className="lang-toggle" role="group" aria-label="Language">
      {(['en', 'es'] as const).map((l) => (
        <button key={l} aria-pressed={lang === l} onClick={() => setLang(l)}>{l.toUpperCase()}</button>
      ))}
    </div>
  )
}
