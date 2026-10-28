// Landing copy in English (default) and Spanish. Product mockups keep their English UI labels.
import type { ChainCopy } from './ChainDiagram'

export type Lang = 'en' | 'es'
export const LANGS: { id: Lang; label: string; name: string }[] = [
  { id: 'en', label: 'EN', name: 'English' },
  { id: 'es', label: 'ES', name: 'Español' },
]

type Item = { title: string; text: string }
type Pillar = { kicker: string; title: string; lead: string; features: Item[]; caption: string }

export interface Copy {
  nav: { platform: string; lab: string; investigate: string; verify: string; scope: string; guide: string; signIn: string; tryDemo: string; openWorkspace: string; menu: string; language: string }
  hero: { eyebrow: string; title: [string, string]; lead: [string, string, string, string, string]; enter: string; explore: string; scroll: string }
  stats: [string, string, string][]
  builtWith: string
  problem: { eyebrow: string; title: string; lead: string; items: Item[] }
  platform: { eyebrow: string; title: string; lead: string; loop: { title: string; sub: string }[]; repeats: string
    ground: { k: string; title: string; text: string }[]; openLab: string }
  lab: Pillar & { titleBreak: [string, string]; window: string; converged: string; key: string; parts: string }
  key: Item[]
  investigate: Pillar
  review: Pillar
  verify: Pillar
  chain: { eyebrow: string; title: string; lead: string; diagram: ChainCopy }
  benefits: { eyebrow: string; title: string; items: Item[]; principles: Item[] }
  scope: { eyebrow: string; title: string; lead: string; inTitle: string; inItems: string[]; outTitle: string; outItems: string[] }
  guide: { eyebrow: string; title: string; lead: string; soon: string; steps: (Item & { soon?: boolean })[] }
  glossary: { eyebrow: string; title: string; items: Item[] }
  cta: { eyebrow: string; title: string; lead: string; about: string }
  footer: { tagline: string; platform: string; learn: string; hackathon: string; links: { platform: string[]; learn: string[] }; track: string; simOnly: string }
}

const en: Copy = {
  nav: { platform: 'Platform', lab: 'Lab', investigate: 'Investigate', verify: 'Verify', scope: 'Scope', guide: 'Guide', signIn: 'Sign in', tryDemo: 'Try the demo', openWorkspace: 'Open workspace', menu: 'Menu', language: 'Language' },
  hero: {
    eyebrow: 'Physical AI for utilities',
    title: ['See inside the grid', 'you can’t see.'],
    lead: ['GridXray uses Meta’s ', 'Muse Spark', ' to discover hidden connections in electrical distribution networks. An AI investigator forms hypotheses, runs ', 'virtual experiments', ' on a physics simulator and proves what it finds.'],
    enter: 'Enter as demo user', explore: 'Explore the platform', scroll: 'Scroll down',
  },
  stats: [['2', 'Meta models', 'Spark investigates, Wonder reviews'], ['5', 'network types', '3 synthetic levels + 2 benchmarks'],
    ['100%', 'physics-based', 'pandapower power flow'], ['0', 'real grids touched', 'simulation only']],
  builtWith: 'Built with',
  problem: {
    eyebrow: 'The problem', title: 'Utilities don’t fully know their own networks.',
    lead: 'Distribution grids change every day: crews reroute lines, switches are operated during repairs, new customers connect. The official map rarely keeps up.',
    items: [
      { title: 'Records drift', text: 'GIS maps and single-line diagrams fall out of date, so studies and plans rest on a network that no longer exists.' },
      { title: 'Switch states go unrecorded', text: 'A tie switch left closed or a sectionalizer left open silently changes which customers each feeder serves.' },
      { title: 'Data is partial and noisy', text: 'Not every point is metered, readings go missing and sensors fail. Verifying the topology in the field is slow and costly.' },
    ],
  },
  platform: {
    eyebrow: 'One platform', title: 'An AI that investigates, not just analyzes.',
    lead: 'GridXray follows the scientific method on a physical system. One sealed, physics-validated virtual grid sits under every step, so each conclusion can be checked against the truth.',
    loop: [
      { title: 'Observe', sub: 'Meters, records, equipment' }, { title: 'Hypothesize', sub: 'Which kiosk feeds which?' },
      { title: 'Experiment', sub: 'Virtual load & switch tests' }, { title: 'Review', sub: 'Second opinion when stuck' },
      { title: 'Verify', sub: 'Scored against the truth' },
    ],
    repeats: 'Repeats until the topology is settled, or the evidence says it can’t be.',
    ground: [
      { k: 'Foundation', title: 'Virtual grid lab', text: 'A pandapower model of a medium-voltage network with meters, switches and daily demand.' },
      { k: 'Guarantee', title: 'Sealed ground truth', text: 'The true topology never leaves the simulator. The agents only see what a utility would.' },
      { k: 'Proof', title: 'LLM-free verifier', text: 'Every conclusion is scored against the real network, sealed before the AI starts.' },
    ],
    openLab: 'Open the lab',
  },
  lab: {
    kicker: 'Virtual grid lab', title: 'From the substation to every street.', titleBreak: ['From the substation', 'to every street.'],
    lead: 'The smallest network worth investigating: one substation, a feeder that branches to three secondary substations, and a tie switch that is supposed to be open. Here the wiring is visible; in the workspace it starts hidden, on networks of up to dozens of substations, and the AI has to discover it.',
    features: [
      { title: 'Virtual grid lab', text: 'Synthetic medium-voltage networks at three difficulty levels, plus published benchmarks (CIGRE MV, MV Oberrhein), solved with real power-flow physics.' },
      { title: 'Sealed ground truth', text: 'The true topology stays inside the simulator. The AI only sees what a utility would: devices, records and meter readings. Enforced by automated tests.' },
      { title: 'Realistic measurements', text: 'Sensor noise, missing readings, faulty meters and 24-hour load profiles, so the AI faces the messy data of a real network.' },
      { title: 'Street-routed feeders', text: 'A fictional city with feeders running along its streets to a secondary substation on every block, explorable in 3D or as a single-line diagram.' },
    ],
    caption: 'The lab explorer: hover the numbers to learn each part. Drag to rotate, scroll to zoom.',
    window: 'Demo network · 3 secondary substations', converged: 'power flow converged', key: 'Key', parts: '8 parts',
  },
  key: [
    { title: 'Transmission supply (110 kV)', text: 'Power arrives from the high-voltage grid.' },
    { title: 'Substation transformer', text: 'Steps 110 kV down to 20 kV for distribution.' },
    { title: 'Medium-voltage busbar', text: 'The hub where every feeder starts.' },
    { title: 'Feeders', text: 'Lines that carry power to neighbourhoods. Their exact routes are what GridXray discovers.' },
    { title: 'Secondary substations', text: 'Turn 20 kV into the 400 V that homes use. Each one stands for the block it supplies and is a node in the investigation.' },
    { title: 'Smart meters', text: 'Report voltage and power. Green is nominal, amber low but within limits, red outside limits, grey missing.' },
    { title: 'Tie switch', text: 'A backup link between feeders, normally open. Records about its state can be wrong.' },
    { title: 'Energy flow', text: 'The path power actually takes, inferred from measurements and experiments.' },
  ],
  investigate: {
    kicker: 'Lead investigator · Muse Spark', title: 'Hypotheses, tested by experiment.',
    lead: 'Muse Spark runs the investigation loop. It reads the meters, builds competing connectivity hypotheses and asks the simulator for the virtual experiment that best tells them apart.',
    features: [
      { title: 'Autonomous experiment design', text: 'The agent chooses the next virtual test, like a controlled load change or a switch operation, that best separates competing hypotheses.' },
      { title: 'Fewer experiments', text: 'It picks the most informative test instead of checking everything, within an explicit experiment budget.' },
      { title: 'Full investigation record', text: 'Every hypothesis, experiment, result and decision is logged and replayable, so engineers can audit how a conclusion was reached.' },
      { title: 'Fast tool calls', text: 'Muse Spark reads meters, builds connectivity hypotheses and discards impossible connections in a tight loop.' },
    ],
    caption: 'The investigation view: ranked hypotheses and the experiments that separate them. Illustrative run.',
  },
  review: {
    kicker: 'Second opinion · Muse Wonder', title: 'Depth, when it counts.',
    lead: 'When several topologies remain consistent with the data, or the investigation stalls, Muse Wonder reviews the evidence and proposes a different line of inquiry.',
    features: [
      { title: 'Triggered by ambiguity', text: 'Steps in when several topologies still fit the data or progress stalls, not on every turn.' },
      { title: 'Challenges conclusions', text: 'Re-reads the evidence, questions the assumptions behind each candidate and spots records taken on trust.' },
      { title: 'Proposes the decisive test', text: 'Designs the experiment whose predicted outcome differs most between the remaining candidates.' },
    ],
    caption: 'The review panel: competing candidates and the one experiment that settles them. Illustrative run.',
  },
  verify: {
    kicker: 'Independent verification', title: 'Measured, not claimed.',
    lead: 'An independent verifier, with no LLM involved, scores every result against the sealed real network, and reports what remains uncertain.',
    features: [
      { title: 'Independent verification', text: 'A checker with no AI involved scores the result against the truth: accuracy, experiments used and time.' },
      { title: 'Sealed before the run', text: 'A SHA-256 fingerprint of the hidden network is published before the AI starts; your browser re-checks it at the end.' },
      { title: 'Outdated-record detection', text: 'Flags switches whose real state differs from what the records say: the discrepancies that cause unsafe maneuvers.' },
      { title: 'Uncertainty made explicit', text: 'Links the evidence cannot settle are reported as uncertain, never silently guessed.' },
    ],
    caption: 'The scorecard: accuracy, experiments and record errors, against the real network. Illustrative values.',
  },
  chain: {
    eyebrow: 'Where GridXray fits', title: 'From the power plant to your home.',
    lead: 'GridXray investigates the medium-voltage distribution network: from the HV/MV substation, along the feeders, to every secondary substation. That is where utilities’ records drift the most and where switching decisions are made every day.',
    diagram: {
      scope: 'GRIDXRAY SCOPE', scopeSub: 'HV/MV substation → feeders → every secondary substation',
      stages: [['Generation', 'Power plant · 11–25 kV'], ['Step-up', '→ 110–380 kV'], ['Transmission', '110–380 kV lines'],
        ['HV/MV substation', '110/20 kV · TR-1'], ['MV feeders', '3–36 kV · 20 kV here'], ['Secondary substation', '20 kV → 400 V'],
        ['LV & customers', '400/230 V']],
      profile: 'VOLTAGE ALONG THE CHAIN · LOG SCALE',
    },
  },
  benefits: {
    eyebrow: 'Who it helps', title: 'Safer operations, fewer field visits, decisions backed by evidence.',
    items: [
      { title: 'Planning engineers', text: 'Run connection and capacity studies on a network model you can trust.' },
      { title: 'Operations & control room', text: 'Know the real configuration before switching, so maneuvers are safer.' },
      { title: 'Asset & GIS teams', text: 'Find record discrepancies before they turn into incidents or field surprises.' },
      { title: 'Leadership & regulators', text: 'Measurable, reproducible evidence of network knowledge and how it was obtained.' },
    ],
    principles: [
      { title: 'Fewer experiments', text: 'The most informative test, not every test.' }, { title: 'Measurable accuracy', text: 'Scored against the truth, uncertainty explicit.' },
      { title: 'Reproducible', text: 'Seeded scenarios: same inputs, same network.' }, { title: 'Auditable', text: 'A complete trail of hypotheses and decisions.' },
    ],
  },
  scope: {
    eyebrow: 'Scope', title: 'What GridXray is, and what it isn’t yet.',
    lead: 'A focused prototype built for the Meta Global AI Developer Hackathon, designed as the first step of a utility platform.',
    inTitle: 'In this version',
    inItems: [
      'An AI investigator for distribution network topology',
      'Initial focus on medium-voltage networks; voltage-agnostic by design',
      'Modelled from the HV/MV substation down to every secondary substation; the low-voltage streets and homes behind each one are represented by its total demand',
      'Physics-based simulation with pandapower; synthetic data only',
      'Real Meta models: no scripted answers or pre-programmed discoveries',
      'Measured results, scored against the real network',
    ],
    outTitle: 'On the roadmap',
    outItems: [
      'Connections to real grids or production SCADA, AMI or GIS',
      'Physical hardware, IoT devices or field sensors',
      'Control of real switches or installations',
      'A full grid-operations system',
      'The low-voltage network down to individual homes (next step: customer-to-transformer and phase identification)',
      'Guaranteed identification regardless of the available evidence',
    ],
  },
  guide: {
    eyebrow: 'Guide', title: 'What you can do in the workspace.', lead: 'No electrical background needed: every panel explains itself with (i) tips.', soon: 'Coming this week',
    steps: [
      { title: 'Enter with the demo account', text: 'One click, no registration.' },
      { title: 'Build a grid', text: 'Choose a difficulty (easy, medium, hard) or a published benchmark network. Its connections stay hidden.' },
      { title: 'Explore it in 3D', text: 'Rotate and zoom. Click any secondary substation to see its meter reading explained in plain language.' },
      { title: 'Launch an investigation', text: 'Watch Muse Spark form hypotheses and run experiments live, and Muse Wonder review the evidence.', soon: true },
      { title: 'Reveal and compare', text: 'Uncover the true network: correct, wrong and uncertain connections, plus the agent’s score.', soon: true },
      { title: 'Intervene live', text: 'Move a hidden connection or switch off meters mid-investigation and see how the AI adapts.', soon: true },
    ],
  },
  glossary: {
    eyebrow: 'Glossary', title: 'Grid terms in plain language.',
    items: [
      { title: 'Topology', text: 'Which equipment is connected to which: the wiring map of the network.' },
      { title: 'Medium voltage (MV)', text: 'The 1 to 36 kV level that carries power from substations to neighbourhoods (20 kV here).' },
      { title: 'Feeder', text: 'A line leaving the substation that supplies a group of secondary substations.' },
      { title: 'Secondary substation', text: 'A small kiosk that converts medium voltage into the 400 V homes use.' },
      { title: 'Tie switch', text: 'A normally open link between two feeders, closed to restore power during faults.' },
      { title: 'Sectionalizer', text: 'A normally closed switch that can isolate a section of a feeder.' },
      { title: 'Per unit (pu)', text: 'Voltage as a fraction of nominal. 1.00 is perfect; lower values mean a longer or more loaded path. MV networks are typically allowed ±10 % (0.90 to 1.10).' },
      { title: 'Model boundary', text: 'GridXray models the medium-voltage network down to each secondary substation. The homes behind a kiosk appear as its total demand.' },
      { title: 'Virtual experiment', text: 'A controlled change in the simulator, such as raising a load, used to test a hypothesis.' },
    ],
  },
  cta: { eyebrow: 'Get started', title: 'Ready to see the grid?', lead: 'Open the workspace with the demo account, build a network and explore it in 3D.', about: 'About Zynplex' },
  footer: {
    tagline: 'Physical AI for utilities. Discovering hidden connections in distribution networks with Meta’s Muse models.',
    platform: 'Platform', learn: 'Learn', hackathon: 'Hackathon',
    links: { platform: ['Virtual grid lab', 'Investigation', 'Second opinion', 'Verification'], learn: ['Where it fits', 'Scope', 'Guide', 'Glossary'] },
    track: 'Startup track · Push the Frontier', simOnly: 'Simulation only · no real grids, sensors or SCADA',
  },
}

const es: Copy = {
  nav: { platform: 'Plataforma', lab: 'Laboratorio', investigate: 'Investigar', verify: 'Verificar', scope: 'Alcance', guide: 'Guía', signIn: 'Iniciar sesión', tryDemo: 'Probar la demo', openWorkspace: 'Abrir espacio de trabajo', menu: 'Menú', language: 'Idioma' },
  hero: {
    eyebrow: 'IA física para empresas eléctricas',
    title: ['Mira dentro de la red', 'que no puedes ver.'],
    lead: ['GridXray usa ', 'Muse Spark', ' de Meta para descubrir conexiones ocultas en redes de distribución eléctrica. Un investigador de IA formula hipótesis, ejecuta ', 'experimentos virtuales', ' en un simulador físico y demuestra lo que encuentra.'],
    enter: 'Entrar como usuario demo', explore: 'Explorar la plataforma', scroll: 'Desplazarse hacia abajo',
  },
  stats: [['2', 'modelos de Meta', 'Spark investiga, Wonder revisa'], ['5', 'tipos de red', '3 niveles sintéticos + 2 benchmarks'],
    ['100%', 'basado en física', 'flujo de carga con pandapower'], ['0', 'redes reales tocadas', 'solo simulación']],
  builtWith: 'Construido con',
  problem: {
    eyebrow: 'El problema', title: 'Las empresas eléctricas no conocen del todo sus propias redes.',
    lead: 'Las redes de distribución cambian cada día: las cuadrillas desvían líneas, se operan interruptores durante reparaciones y se conectan nuevos clientes. El plano oficial rara vez se mantiene al día.',
    items: [
      { title: 'Los registros se desactualizan', text: 'Los mapas GIS y los diagramas unifilares quedan obsoletos, así que los estudios y planes se basan en una red que ya no existe.' },
      { title: 'El estado de los interruptores no se registra', text: 'Un interruptor de enlace que quedó cerrado o un seccionador que quedó abierto cambia en silencio qué clientes alimenta cada circuito.' },
      { title: 'Los datos son parciales y ruidosos', text: 'No todos los puntos tienen medidor, faltan lecturas y los sensores fallan. Verificar la topología en campo es lento y costoso.' },
    ],
  },
  platform: {
    eyebrow: 'Una plataforma', title: 'Una IA que investiga, no solo analiza.',
    lead: 'GridXray aplica el método científico a un sistema físico. Una red virtual sellada y validada físicamente sostiene cada paso, para que cada conclusión pueda contrastarse con la verdad.',
    loop: [
      { title: 'Observar', sub: 'Medidores, registros, equipos' }, { title: 'Formular hipótesis', sub: '¿Qué kiosco alimenta a cuál?' },
      { title: 'Experimentar', sub: 'Pruebas virtuales de carga y maniobra' }, { title: 'Revisar', sub: 'Segunda opinión si se estanca' },
      { title: 'Verificar', sub: 'Evaluado contra la verdad' },
    ],
    repeats: 'Se repite hasta resolver la topología, o hasta que la evidencia diga que no es posible.',
    ground: [
      { k: 'Base', title: 'Laboratorio de red virtual', text: 'Un modelo pandapower de una red de media tensión con medidores, interruptores y demanda diaria.' },
      { k: 'Garantía', title: 'Verdad sellada', text: 'La topología real nunca sale del simulador. Los agentes solo ven lo que vería una empresa eléctrica.' },
      { k: 'Prueba', title: 'Verificador sin LLM', text: 'Cada conclusión se evalúa contra la red real, sellada antes de que empiece la IA.' },
    ],
    openLab: 'Abrir el laboratorio',
  },
  lab: {
    kicker: 'Laboratorio de red virtual', title: 'De la subestación a cada calle.', titleBreak: ['De la subestación', 'a cada calle.'],
    lead: 'La red más pequeña que vale la pena investigar: una subestación, un circuito que se ramifica hacia tres subestaciones secundarias y un interruptor de enlace que debería estar abierto. Aquí el cableado es visible; en el espacio de trabajo empieza oculto, en redes de hasta decenas de subestaciones, y la IA debe descubrirlo.',
    features: [
      { title: 'Laboratorio de red virtual', text: 'Redes sintéticas de media tensión en tres niveles de dificultad, más benchmarks publicados (CIGRE MV, MV Oberrhein), resueltas con física real de flujo de carga.' },
      { title: 'Verdad sellada', text: 'La topología real permanece dentro del simulador. La IA solo ve lo que vería una empresa eléctrica: equipos, registros y lecturas. Garantizado por pruebas automáticas.' },
      { title: 'Mediciones realistas', text: 'Ruido de sensores, lecturas faltantes, medidores defectuosos y perfiles de carga de 24 horas, para que la IA enfrente los datos imperfectos de una red real.' },
      { title: 'Circuitos por las calles', text: 'Una ciudad ficticia con circuitos que recorren sus calles hasta una subestación secundaria en cada manzana, explorable en 3D o como diagrama unifilar.' },
    ],
    caption: 'El explorador del laboratorio: pasa el cursor por los números para conocer cada parte. Arrastra para rotar, usa la rueda para hacer zoom.',
    window: 'Red demo · 3 subestaciones secundarias', converged: 'flujo de carga convergido', key: 'Leyenda', parts: '8 partes',
  },
  key: [
    { title: 'Alimentación de transmisión (110 kV)', text: 'La energía llega desde la red de alta tensión.' },
    { title: 'Transformador de subestación', text: 'Reduce de 110 kV a 20 kV para la distribución.' },
    { title: 'Barra de media tensión', text: 'El punto de donde parte cada circuito.' },
    { title: 'Circuitos alimentadores', text: 'Líneas que llevan la energía a los barrios. Sus rutas exactas son lo que GridXray descubre.' },
    { title: 'Subestaciones secundarias', text: 'Convierten 20 kV en los 400 V que usan los hogares. Cada una representa la manzana que alimenta y es un nodo de la investigación.' },
    { title: 'Medidores inteligentes', text: 'Reportan tensión y potencia. Verde es nominal, ámbar baja pero dentro de límites, rojo fuera de límites, gris sin dato.' },
    { title: 'Interruptor de enlace', text: 'Una conexión de respaldo entre circuitos, normalmente abierta. Los registros sobre su estado pueden estar equivocados.' },
    { title: 'Flujo de energía', text: 'El camino que realmente sigue la energía, inferido a partir de mediciones y experimentos.' },
  ],
  investigate: {
    kicker: 'Investigador principal · Muse Spark', title: 'Hipótesis, puestas a prueba con experimentos.',
    lead: 'Muse Spark dirige el ciclo de investigación. Lee los medidores, construye hipótesis de conectividad que compiten entre sí y pide al simulador el experimento virtual que mejor las distingue.',
    features: [
      { title: 'Diseño autónomo de experimentos', text: 'El agente elige la siguiente prueba virtual, como un cambio controlado de carga o una maniobra, que mejor separa las hipótesis en competencia.' },
      { title: 'Menos experimentos', text: 'Elige la prueba más informativa en vez de revisarlo todo, dentro de un presupuesto explícito de experimentos.' },
      { title: 'Registro completo', text: 'Cada hipótesis, experimento, resultado y decisión queda registrado y se puede reproducir, para auditar cómo se llegó a una conclusión.' },
      { title: 'Llamadas a herramientas rápidas', text: 'Muse Spark lee medidores, arma hipótesis de conectividad y descarta conexiones imposibles en un ciclo ágil.' },
    ],
    caption: 'La vista de investigación: hipótesis ordenadas y los experimentos que las separan. Ejecución ilustrativa.',
  },
  review: {
    kicker: 'Segunda opinión · Muse Wonder', title: 'Profundidad, cuando importa.',
    lead: 'Cuando varias topologías siguen siendo consistentes con los datos, o la investigación se estanca, Muse Wonder revisa la evidencia y propone otra línea de investigación.',
    features: [
      { title: 'Se activa ante la ambigüedad', text: 'Interviene cuando varias topologías aún encajan con los datos o el avance se detiene, no en cada turno.' },
      { title: 'Cuestiona las conclusiones', text: 'Relee la evidencia, cuestiona los supuestos de cada candidata y detecta registros que se dieron por ciertos.' },
      { title: 'Propone la prueba decisiva', text: 'Diseña el experimento cuyo resultado previsto difiere más entre las candidatas restantes.' },
    ],
    caption: 'El panel de revisión: candidatas en competencia y el único experimento que las resuelve. Ejecución ilustrativa.',
  },
  verify: {
    kicker: 'Verificación independiente', title: 'Medido, no afirmado.',
    lead: 'Un verificador independiente, sin LLM, evalúa cada resultado contra la red real sellada, e informa lo que sigue siendo incierto.',
    features: [
      { title: 'Verificación independiente', text: 'Un evaluador sin IA compara el resultado con la verdad: precisión, experimentos usados y tiempo.' },
      { title: 'Sellada antes de la corrida', text: 'Antes de que empiece la IA se publica la huella SHA-256 de la red oculta; al final tu navegador la vuelve a verificar.' },
      { title: 'Detección de registros desactualizados', text: 'Señala interruptores cuyo estado real difiere de lo que dicen los registros: las discrepancias que causan maniobras inseguras.' },
      { title: 'Incertidumbre explícita', text: 'Las conexiones que la evidencia no puede resolver se reportan como inciertas, nunca se adivinan en silencio.' },
    ],
    caption: 'El tablero de resultados: precisión, experimentos y errores de registro, contra la red real. Valores ilustrativos.',
  },
  chain: {
    eyebrow: 'Dónde encaja GridXray', title: 'De la central eléctrica a tu casa.',
    lead: 'GridXray investiga la red de distribución de media tensión: desde la subestación AT/MT, a lo largo de los circuitos, hasta cada subestación secundaria. Ahí es donde más se desactualizan los registros y donde se toman decisiones de maniobra cada día.',
    diagram: {
      scope: 'ALCANCE DE GRIDXRAY', scopeSub: 'Subestación AT/MT → circuitos → cada subestación secundaria',
      stages: [['Generación', 'Central · 11–25 kV'], ['Elevación', '→ 110–380 kV'], ['Transmisión', 'Líneas de 110–380 kV'],
        ['Subestación AT/MT', '110/20 kV · TR-1'], ['Circuitos MT', '3–36 kV · aquí 20 kV'], ['Subestación secundaria', '20 kV → 400 V'],
        ['BT y clientes', '400/230 V']],
      profile: 'TENSIÓN A LO LARGO DE LA CADENA · ESCALA LOG',
    },
  },
  benefits: {
    eyebrow: 'A quién ayuda', title: 'Operaciones más seguras, menos visitas a campo, decisiones con evidencia.',
    items: [
      { title: 'Ingenieros de planeación', text: 'Haz estudios de conexión y capacidad sobre un modelo de red confiable.' },
      { title: 'Operación y centro de control', text: 'Conoce la configuración real antes de maniobrar, para que las maniobras sean más seguras.' },
      { title: 'Equipos de activos y GIS', text: 'Encuentra discrepancias en los registros antes de que se conviertan en incidentes o sorpresas en campo.' },
      { title: 'Dirección y reguladores', text: 'Evidencia medible y reproducible del conocimiento de la red y de cómo se obtuvo.' },
    ],
    principles: [
      { title: 'Menos experimentos', text: 'La prueba más informativa, no todas las pruebas.' }, { title: 'Precisión medible', text: 'Evaluado contra la verdad, con incertidumbre explícita.' },
      { title: 'Reproducible', text: 'Escenarios con semilla: mismas entradas, misma red.' }, { title: 'Auditable', text: 'Un rastro completo de hipótesis y decisiones.' },
    ],
  },
  scope: {
    eyebrow: 'Alcance', title: 'Qué es GridXray, y qué no es todavía.',
    lead: 'Un prototipo enfocado, construido para el Meta Global AI Developer Hackathon, diseñado como el primer paso de una plataforma para empresas eléctricas.',
    inTitle: 'En esta versión',
    inItems: [
      'Un investigador de IA para la topología de redes de distribución',
      'Enfoque inicial en redes de media tensión; independiente del nivel de tensión por diseño',
      'Modelado desde la subestación AT/MT hasta cada subestación secundaria; las calles de baja tensión y los hogares detrás de cada una se representan por su demanda total',
      'Simulación basada en física con pandapower; solo datos sintéticos',
      'Modelos reales de Meta: sin respuestas guionizadas ni descubrimientos preprogramados',
      'Resultados medidos, evaluados contra la red real',
    ],
    outTitle: 'En la hoja de ruta',
    outItems: [
      'Conexión a redes reales o a SCADA, AMI o GIS de producción',
      'Hardware físico, dispositivos IoT o sensores de campo',
      'Control de interruptores o instalaciones reales',
      'Un sistema completo de operación de red',
      'La red de baja tensión hasta cada hogar (siguiente paso: identificación cliente-transformador y de fase)',
      'Identificación garantizada sin importar la evidencia disponible',
    ],
  },
  guide: {
    eyebrow: 'Guía', title: 'Qué puedes hacer en el espacio de trabajo.', lead: 'No necesitas conocimientos de electricidad: cada panel se explica solo con consejos (i).', soon: 'Llega esta semana',
    steps: [
      { title: 'Entra con la cuenta demo', text: 'Un clic, sin registro.' },
      { title: 'Construye una red', text: 'Elige una dificultad (fácil, media, difícil) o una red de benchmark publicada. Sus conexiones permanecen ocultas.' },
      { title: 'Explórala en 3D', text: 'Rota y haz zoom. Haz clic en cualquier subestación secundaria para ver su lectura explicada en lenguaje sencillo.' },
      { title: 'Lanza una investigación', text: 'Observa en vivo cómo Muse Spark formula hipótesis y ejecuta experimentos, y cómo Muse Wonder revisa la evidencia.', soon: true },
      { title: 'Revela y compara', text: 'Descubre la red real: conexiones correctas, erróneas e inciertas, más la puntuación del agente.', soon: true },
      { title: 'Interviene en vivo', text: 'Mueve una conexión oculta o apaga medidores en plena investigación y mira cómo se adapta la IA.', soon: true },
    ],
  },
  glossary: {
    eyebrow: 'Glosario', title: 'Términos de red en lenguaje sencillo.',
    items: [
      { title: 'Topología', text: 'Qué equipo está conectado con cuál: el mapa de cableado de la red.' },
      { title: 'Media tensión (MT)', text: 'El nivel de 1 a 36 kV que lleva la energía de las subestaciones a los barrios (aquí 20 kV).' },
      { title: 'Circuito alimentador', text: 'Una línea que sale de la subestación y alimenta a un grupo de subestaciones secundarias.' },
      { title: 'Subestación secundaria', text: 'Un pequeño kiosco que convierte la media tensión en los 400 V que usan los hogares.' },
      { title: 'Interruptor de enlace', text: 'Una conexión normalmente abierta entre dos circuitos, que se cierra para restablecer el servicio ante fallas.' },
      { title: 'Seccionador', text: 'Un interruptor normalmente cerrado que puede aislar un tramo de un circuito.' },
      { title: 'Por unidad (pu)', text: 'La tensión como fracción de la nominal. 1,00 es perfecta; valores menores indican un camino más largo o más cargado. En MT normalmente se permite ±10 % (0,90 a 1,10).' },
      { title: 'Límite del modelo', text: 'GridXray modela la red de media tensión hasta cada subestación secundaria. Los hogares detrás de un kiosco aparecen como su demanda total.' },
      { title: 'Experimento virtual', text: 'Un cambio controlado en el simulador, como aumentar una carga, que se usa para probar una hipótesis.' },
    ],
  },
  cta: { eyebrow: 'Empieza ya', title: '¿Listo para ver la red?', lead: 'Abre el espacio de trabajo con la cuenta demo, construye una red y explórala en 3D.', about: 'Sobre Zynplex' },
  footer: {
    tagline: 'IA física para empresas eléctricas. Descubrimos conexiones ocultas en redes de distribución con los modelos Muse de Meta.',
    platform: 'Plataforma', learn: 'Aprende', hackathon: 'Hackathon',
    links: { platform: ['Laboratorio de red virtual', 'Investigación', 'Segunda opinión', 'Verificación'], learn: ['Dónde encaja', 'Alcance', 'Guía', 'Glosario'] },
    track: 'Categoría Startup · Push the Frontier', simOnly: 'Solo simulación · sin redes, sensores ni SCADA reales',
  },
}

export const COPY: Record<Lang, Copy> = { en, es }
